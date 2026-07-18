import { encodeUtf8, toBase64Url } from "./encoding";

const AES_BLOCK_BYTES = 16;
const LOGIN_RANDOM_PREFIX_BYTES = 64;

export async function encryptUpstreamPassword(
  password: string,
  salt: string,
  randomBytes: (length: number) => Uint8Array<ArrayBuffer> = secureRandomBytes,
): Promise<string> {
  const keyBytes = encodeUtf8(salt);

  if (keyBytes.byteLength !== AES_BLOCK_BYTES) {
    throw new Error("Upstream password salt must be 16 UTF-8 bytes");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const iv = randomBytes(AES_BLOCK_BYTES);
  const prefix = randomBytes(LOGIN_RANDOM_PREFIX_BYTES);
  const plaintext = new Uint8Array(
    prefix.byteLength + encodeUtf8(password).byteLength,
  );
  plaintext.set(prefix);
  plaintext.set(encodeUtf8(password), prefix.byteLength);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv },
    key,
    plaintext,
  );

  return `${toBase64Url(iv.buffer)}.${toBase64Url(ciphertext)}`;
}

export async function sealRuntimeFixture(
  fixture: unknown,
  rawKey: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = secureRandomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encodeUtf8("runtime-probe:v1") },
    key,
    encodeUtf8(JSON.stringify(fixture)),
  );

  return `v1.${toBase64Url(iv.buffer)}.${toBase64Url(ciphertext)}`;
}

function secureRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}
