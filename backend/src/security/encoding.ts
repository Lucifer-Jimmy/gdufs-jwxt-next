const textEncoder = new TextEncoder();

export function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(textEncoder.encode(value));
}

export function toBase64Url(value: ArrayBuffer): string {
  return toBase64(value)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function toBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error("Invalid base64url value");
  }

  const paddingLength = (4 - (value.length % 4)) % 4;
  const base64 =
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(paddingLength);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (toBase64Url(bytes.buffer) !== value) {
    throw new Error("Non-canonical base64url value");
  }

  return bytes;
}

export function decodeUtf8(value: ArrayBuffer): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    value,
  );
}
