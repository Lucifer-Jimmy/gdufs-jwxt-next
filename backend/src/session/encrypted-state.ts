import { z } from "zod";

import {
  decodeUtf8,
  encodeUtf8,
  fromBase64Url,
  toBase64Url,
} from "../security/encoding";

const FORMAT_VERSION = "v1";
const IV_BYTES = 12;

export type StatePurpose = "mfa" | "login";

export interface StateKey {
  version: string;
  key: Uint8Array<ArrayBuffer>;
}

export interface StateKeyring {
  current: StateKey;
  previous?: StateKey;
}

export interface SessionClaims<T> {
  version: 1;
  purpose: StatePurpose;
  issuedAt: number;
  lastActivityAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  payload: T;
}

export type OpenStateResult<T> =
  | { status: "valid"; claims: SessionClaims<T>; needsRotation: boolean }
  | { status: "expired" }
  | { status: "invalid" };

interface SealStateOptions<T> {
  purpose: StatePurpose;
  payload: T;
  now: number;
  idleTtlSeconds: number;
  absoluteTtlSeconds: number;
  keyring: StateKeyring;
}

const claimsSchema = z.object({
  version: z.literal(1),
  purpose: z.enum(["mfa", "login"]),
  issuedAt: z.number().int().nonnegative(),
  lastActivityAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  absoluteExpiresAt: z.number().int().positive(),
  payload: z.unknown(),
});

export async function sealState<T>(
  options: SealStateOptions<T>,
): Promise<string> {
  validateKeyring(options.keyring);
  const idleExpiresAt = options.now + options.idleTtlSeconds;
  const absoluteExpiresAt = options.now + options.absoluteTtlSeconds;
  const claims: SessionClaims<T> = {
    version: 1,
    purpose: options.purpose,
    issuedAt: options.now,
    lastActivityAt: options.now,
    expiresAt: Math.min(idleExpiresAt, absoluteExpiresAt),
    absoluteExpiresAt,
    payload: options.payload,
  };

  return encryptClaims(claims, options.keyring.current);
}

export async function openState<T>(
  token: string,
  purpose: StatePurpose,
  payloadSchema: z.ZodType<T>,
  keyring: StateKeyring,
  now: number,
): Promise<OpenStateResult<T>> {
  try {
    validateKeyring(keyring);
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      return { status: "invalid" };
    }

    const keyVersion = parts[1];
    const ivPart = parts[2];
    const ciphertextPart = parts[3];
    if (
      keyVersion === undefined ||
      ivPart === undefined ||
      ciphertextPart === undefined
    ) {
      return { status: "invalid" };
    }

    const key = selectKey(keyring, keyVersion);
    if (key === undefined) {
      return { status: "invalid" };
    }

    const iv = fromBase64Url(ivPart);
    if (iv.byteLength !== IV_BYTES) {
      return { status: "invalid" };
    }

    const cryptoKey = await importAeadKey(key.key, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: additionalData(purpose, key.version),
      },
      cryptoKey,
      fromBase64Url(ciphertextPart),
    );
    const rawClaims: unknown = JSON.parse(decodeUtf8(plaintext));
    const baseClaims = claimsSchema.safeParse(rawClaims);
    if (!baseClaims.success || baseClaims.data.purpose !== purpose) {
      return { status: "invalid" };
    }

    const payload = payloadSchema.safeParse(baseClaims.data.payload);
    if (!payload.success || !validTimeline(baseClaims.data)) {
      return { status: "invalid" };
    }

    if (
      now >= baseClaims.data.expiresAt ||
      now >= baseClaims.data.absoluteExpiresAt
    ) {
      return { status: "expired" };
    }

    return {
      status: "valid",
      claims: { ...baseClaims.data, payload: payload.data },
      needsRotation: key.version !== keyring.current.version,
    };
  } catch {
    return { status: "invalid" };
  }
}

export async function renewLoginState<T>(
  claims: SessionClaims<T>,
  idleTtlSeconds: number,
  keyring: StateKeyring,
  now: number,
): Promise<string | undefined> {
  if (claims.purpose !== "login" || now >= claims.absoluteExpiresAt) {
    return undefined;
  }

  const renewedClaims: SessionClaims<T> = {
    ...claims,
    lastActivityAt: now,
    expiresAt: Math.min(now + idleTtlSeconds, claims.absoluteExpiresAt),
  };
  return encryptClaims(renewedClaims, keyring.current);
}

async function encryptClaims<T>(
  claims: SessionClaims<T>,
  key: StateKey,
): Promise<string> {
  validateKey(key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cryptoKey = await importAeadKey(key.key, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: additionalData(claims.purpose, key.version),
    },
    cryptoKey,
    encodeUtf8(JSON.stringify(claims)),
  );

  return `${FORMAT_VERSION}.${key.version}.${toBase64Url(iv.buffer)}.${toBase64Url(ciphertext)}`;
}

function selectKey(
  keyring: StateKeyring,
  version: string,
): StateKey | undefined {
  if (keyring.current.version === version) {
    return keyring.current;
  }
  if (keyring.previous?.version === version) {
    return keyring.previous;
  }
  return undefined;
}

async function importAeadKey(
  rawKey: Uint8Array<ArrayBuffer>,
  usages: ("decrypt" | "encrypt")[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    usages,
  );
}

function additionalData(
  purpose: StatePurpose,
  keyVersion: string,
): Uint8Array<ArrayBuffer> {
  return encodeUtf8(
    `gdufs-jwxt-state:${FORMAT_VERSION}:${purpose}:${keyVersion}`,
  );
}

function validateKeyring(keyring: StateKeyring): void {
  validateKey(keyring.current);
  if (keyring.previous !== undefined) {
    validateKey(keyring.previous);
    if (keyring.previous.version === keyring.current.version) {
      throw new Error("State key versions must be unique");
    }
  }
}

function validateKey(key: StateKey): void {
  if (
    !/^[A-Za-z0-9_-]{1,32}$/u.test(key.version) ||
    key.key.byteLength !== 32
  ) {
    throw new Error("State keys require a safe version and exactly 32 bytes");
  }
}

function validTimeline(claims: z.infer<typeof claimsSchema>): boolean {
  return (
    claims.issuedAt <= claims.lastActivityAt &&
    claims.lastActivityAt < claims.expiresAt &&
    claims.expiresAt <= claims.absoluteExpiresAt
  );
}
