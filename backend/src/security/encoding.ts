const textEncoder = new TextEncoder();

export function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(textEncoder.encode(value));
}

export function toBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
