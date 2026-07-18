import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { parseAuthLoginFields } from "../src/parsers/auth-login-page";
import {
  MAX_SET_COOKIE_BYTES,
  TARGET_COOKIE_HEADER_BYTES,
  measureUtf8Bytes,
  serializeStateCookie,
} from "../src/session/cookie-budget";
import {
  encryptUpstreamPassword,
  sealRuntimeFixture,
} from "../src/security/runtime-crypto";
import { apiErrorSchema, healthResponseSchema } from "../src/schemas/api";
import { loginSessionFixture, mfaSessionFixture } from "./fixtures/session";

describe("Worker runtime feasibility", () => {
  it("serves the fixed health contract without caching", async () => {
    const response = await SELF.fetch("https://example.test/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      status: "ok",
    });
  });

  it("keeps unknown API routes out of the SPA fallback", async () => {
    const response = await SELF.fetch("https://example.test/api/v1/missing");

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe(
      "API_ROUTE_NOT_FOUND",
    );
  });

  it("supports structured HTML parsing in workerd", async () => {
    const response = new Response(`<!doctype html><form>
      <input id="pwdEncryptSalt" value="0123456789abcdef">
      <input id="execution" value="fixture-execution">
    </form>`);

    await expect(parseAuthLoginFields(response)).resolves.toEqual({
      execution: "fixture-execution",
      passwordEncryptSalt: "0123456789abcdef",
    });
  });

  it("supports upstream AES-CBC and session AES-GCM primitives", async () => {
    const deterministicRandom = (length: number) =>
      new Uint8Array(Array.from({ length }, (_, index) => index % 251));
    const upstreamCiphertext = await encryptUpstreamPassword(
      "fixture-password",
      "0123456789abcdef",
      deterministicRandom,
    );
    const sessionCiphertext = await sealRuntimeFixture(
      loginSessionFixture,
      new Uint8Array(32).fill(7),
    );

    expect(upstreamCiphertext.split(".")).toHaveLength(2);
    expect(sessionCiphertext).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
  });

  it("keeps encrypted fixtures inside the cookie budget", async () => {
    const key = new Uint8Array(32).fill(9);
    const mfaCookie = serializeStateCookie(
      "__Host-jwxt_mfa",
      await sealRuntimeFixture(mfaSessionFixture, key),
      600,
    );
    const loginCookie = serializeStateCookie(
      "__Host-jwxt_session",
      await sealRuntimeFixture(loginSessionFixture, key),
      7_200,
    );

    expect(measureUtf8Bytes(mfaCookie)).toBeLessThan(MAX_SET_COOKIE_BYTES);
    expect(measureUtf8Bytes(loginCookie)).toBeLessThan(MAX_SET_COOKIE_BYTES);
    expect(measureUtf8Bytes(`${mfaCookie}; ${loginCookie}`)).toBeLessThan(
      TARGET_COOKIE_HEADER_BYTES,
    );
  });

  it("reads and writes SQLite in a Durable Object", async () => {
    const id = env.RATE_LIMIT_SHARD.idFromName("runtime-probe-v1");
    const stub = env.RATE_LIMIT_SHARD.get(id);
    const response = await stub.fetch("https://rate-limit/__runtime-probe", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sqlite: true });
  });
});
