import { encodeUtf8, toBase64 } from "./encoding";

const AES_BLOCK_BYTES = 16;
const LOGIN_RANDOM_PREFIX_BYTES = 64;
const LOGIN_RANDOM_CHARACTERS =
  "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

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
  const iv = encodeUtf8(randomUpstreamString(AES_BLOCK_BYTES, randomBytes));
  const prefix = encodeUtf8(
    randomUpstreamString(LOGIN_RANDOM_PREFIX_BYTES, randomBytes),
  );
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

  return toBase64(ciphertext);
}

function secureRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function randomUpstreamString(
  length: number,
  randomBytes: (length: number) => Uint8Array<ArrayBuffer>,
): string {
  const bytes = randomBytes(length);
  return Array.from(
    bytes,
    (byte) => LOGIN_RANDOM_CHARACTERS[byte % LOGIN_RANDOM_CHARACTERS.length],
  ).join("");
}
