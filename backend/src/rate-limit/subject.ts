import { encodeUtf8, fromBase64Url, toBase64Url } from "../security/encoding";

export const RATE_LIMIT_SHARD_VERSION = "v1";
export const RATE_LIMIT_SHARD_COUNT = 16;

export interface RateLimitSubject {
  hash: string;
  shardName: string;
}

export function parseRateLimitHmacKey(
  encodedKey: string,
): Uint8Array<ArrayBuffer> {
  const key = fromBase64Url(encodedKey);
  if (key.byteLength !== 32) {
    throw new Error("Rate-limit HMAC key must be 32 base64url-encoded bytes");
  }
  return key;
}

export async function deriveRateLimitSubject(
  subjectKind: "account" | "flow" | "ip",
  subject: string,
  rawKey: Uint8Array<ArrayBuffer>,
): Promise<RateLimitSubject> {
  if (subject.length === 0 || rawKey.byteLength !== 32) {
    throw new Error("Rate-limit subject and 32-byte HMAC key are required");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encodeUtf8(
      `gdufs-jwxt-rate-limit:${RATE_LIMIT_SHARD_VERSION}:${subjectKind}:${subject}`,
    ),
  );
  const bytes = new Uint8Array(digest);
  const shardIndex = bytes[0];
  if (shardIndex === undefined) {
    throw new Error("Rate-limit HMAC produced an empty digest");
  }

  return {
    hash: toBase64Url(digest),
    shardName: `${RATE_LIMIT_SHARD_VERSION}-shard-${shardIndex % RATE_LIMIT_SHARD_COUNT}`,
  };
}
