const encoder = new TextEncoder();

export const MAX_SET_COOKIE_BYTES = 3_800;
export const TARGET_COOKIE_HEADER_BYTES = 6 * 1_024;

export function serializeStateCookie(
  name: string,
  encryptedValue: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${encryptedValue}; Max-Age=${maxAgeSeconds}; Path=/api; Secure; HttpOnly; SameSite=Strict`;
}

export function measureUtf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
