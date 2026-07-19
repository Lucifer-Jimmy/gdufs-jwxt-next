import { describe, expect, it } from "vitest";

import { loadSecurityConfig } from "../src/config/security-config";
import { toBase64Url } from "../src/security/encoding";

const sessionKey = new Uint8Array(32).fill(3);
const rateLimitKey = new Uint8Array(32).fill(5);

describe("security configuration", () => {
  it("loads independent current session and rate-limit keys", () => {
    const config = loadSecurityConfig({
      SESSION_AEAD_KEY: toBase64Url(sessionKey.buffer),
      SESSION_AEAD_KEY_VERSION: "2026-01",
      RATE_LIMIT_HMAC_KEY_V1: toBase64Url(rateLimitKey.buffer),
    });

    expect(config.sessionKey).toEqual({
      version: "2026-01",
      key: sessionKey,
    });
    expect(config.rateLimitHmacKey).toEqual(rateLimitKey);
  });

  it("rejects missing, malformed and wrong-length security configuration", () => {
    expect(() =>
      loadSecurityConfig({
        SESSION_AEAD_KEY: "",
        SESSION_AEAD_KEY_VERSION: "1",
        RATE_LIMIT_HMAC_KEY_V1: toBase64Url(rateLimitKey.buffer),
      }),
    ).toThrow("Session AEAD key version 1");
    expect(() =>
      loadSecurityConfig({
        SESSION_AEAD_KEY: toBase64Url(sessionKey.buffer),
        SESSION_AEAD_KEY_VERSION: "1",
        RATE_LIMIT_HMAC_KEY_V1: "c2hvcnQ",
      }),
    ).toThrow("Rate-limit HMAC key");
    expect(() =>
      loadSecurityConfig({
        SESSION_AEAD_KEY: "***",
        SESSION_AEAD_KEY_VERSION: "1",
        RATE_LIMIT_HMAC_KEY_V1: toBase64Url(rateLimitKey.buffer),
      }),
    ).toThrow("Invalid base64url value");
    expect(() =>
      loadSecurityConfig({
        SESSION_AEAD_KEY: toBase64Url(sessionKey.buffer),
        SESSION_AEAD_KEY_VERSION: "bad version",
        RATE_LIMIT_HMAC_KEY_V1: toBase64Url(rateLimitKey.buffer),
      }),
    ).toThrow("safe version");
  });

  it("rejects key reuse across independent security purposes", () => {
    expect(() =>
      loadSecurityConfig({
        SESSION_AEAD_KEY: toBase64Url(sessionKey.buffer),
        SESSION_AEAD_KEY_VERSION: "1",
        RATE_LIMIT_HMAC_KEY_V1: toBase64Url(sessionKey.buffer),
      }),
    ).toThrow("must be independent");
  });
});
