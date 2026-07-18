const encoder = new TextEncoder();

export const MAX_SET_COOKIE_BYTES = 3_800;
export const TARGET_COOKIE_HEADER_BYTES = 6 * 1_024;

export function serializeStateCookie(
  name: string,
  encryptedValue: string,
  maxAgeSeconds: number,
): string {
  const serialized = `${name}=${encryptedValue}; Max-Age=${maxAgeSeconds}; Path=/api; Secure; HttpOnly; SameSite=Strict`;

  if (measureUtf8Bytes(serialized) >= MAX_SET_COOKIE_BYTES) {
    throw new Error("Encrypted state exceeds the per-cookie byte budget");
  }

  return serialized;
}

export function clearStateCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/api; Secure; HttpOnly; SameSite=Strict`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader === null) {
    return undefined;
  }

  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const candidateName = segment.slice(0, separator).trim();
    if (candidateName === name) {
      return segment.slice(separator + 1).trim();
    }
  }

  return undefined;
}

export function measureUtf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}
