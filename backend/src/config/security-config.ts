import { fromBase64Url } from "../security/encoding";
import type { StateKey } from "../session/encrypted-state";
import { parseRateLimitHmacKey } from "../rate-limit/subject";

export interface SecuritySecretBindings {
  SESSION_AEAD_KEY: string;
  SESSION_AEAD_KEY_VERSION: string;
  RATE_LIMIT_HMAC_KEY_V1: string;
}

export interface SecurityConfig {
  sessionKey: StateKey;
  rateLimitHmacKey: Uint8Array<ArrayBuffer>;
}

export function loadSecurityConfig(
  env: SecuritySecretBindings,
): SecurityConfig {
  const sessionKey = parseSessionKey(
    env.SESSION_AEAD_KEY,
    env.SESSION_AEAD_KEY_VERSION,
  );
  const rateLimitHmacKey = parseRateLimitHmacKey(env.RATE_LIMIT_HMAC_KEY_V1);

  if (constantTimeEqual(sessionKey.key, rateLimitHmacKey)) {
    throw new Error(
      "Session AEAD and rate-limit HMAC keys must be independent",
    );
  }

  return {
    sessionKey,
    rateLimitHmacKey,
  };
}

function constantTimeEqual(
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function parseSessionKey(encodedKey: string, version: string) {
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(version)) {
    throw new Error("Session AEAD key requires a safe version");
  }
  const key = fromBase64Url(encodedKey);
  if (key.byteLength !== 32) {
    throw new Error(
      `Session AEAD key version ${version} must be 32 base64url-encoded bytes`,
    );
  }
  return { version, key };
}
