import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { parseAuthLoginFields } from "../src/parsers/auth-login-page";
import {
  MAX_SET_COOKIE_BYTES,
  TARGET_COOKIE_HEADER_BYTES,
  measureUtf8Bytes,
  serializeStateCookie,
} from "../src/session/cookie-budget";
import { encryptUpstreamPassword } from "../src/security/runtime-crypto";
import { openState, sealState } from "../src/session/encrypted-state";
import { z } from "zod";
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
    const sessionKey = { version: "1", key: new Uint8Array(32).fill(7) };
    const sessionCiphertext = await sealState({
      purpose: "login",
      payload: loginSessionFixture,
      now: 1_800_000_000,
      idleTtlSeconds: 7_200,
      absoluteTtlSeconds: 28_800,
      key: sessionKey,
    });

    expect(upstreamCiphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/u);
    expect(sessionCiphertext).toMatch(
      /^v1\.1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
    );
    await expect(
      openState(
        sessionCiphertext,
        "login",
        z.object({ accountHash: z.string() }).passthrough(),
        sessionKey,
        1_800_000_001,
      ),
    ).resolves.toMatchObject({ status: "valid" });
  });

  it("keeps encrypted fixtures inside the cookie budget", async () => {
    const sessionKey = { version: "1", key: new Uint8Array(32).fill(9) };
    const mfaCookie = serializeStateCookie(
      "__Secure-jwxt_mfa",
      await sealState({
        purpose: "mfa",
        payload: mfaSessionFixture,
        now: 1_800_000_000,
        idleTtlSeconds: 600,
        absoluteTtlSeconds: 600,
        key: sessionKey,
      }),
      600,
    );
    const loginCookie = serializeStateCookie(
      "__Secure-jwxt_session",
      await sealState({
        purpose: "login",
        payload: loginSessionFixture,
        now: 1_800_000_000,
        idleTtlSeconds: 7_200,
        absoluteTtlSeconds: 28_800,
        key: sessionKey,
      }),
      7_200,
    );

    expect(measureUtf8Bytes(mfaCookie)).toBeLessThan(MAX_SET_COOKIE_BYTES);
    expect(measureUtf8Bytes(loginCookie)).toBeLessThan(MAX_SET_COOKIE_BYTES);
    expect(measureUtf8Bytes(`${mfaCookie}; ${loginCookie}`)).toBeLessThan(
      TARGET_COOKIE_HEADER_BYTES,
    );
  });

  it("rejects a state cookie that exceeds the byte budget", () => {
    expect(() =>
      serializeStateCookie("__Secure-jwxt_session", "x".repeat(3_800), 7_200),
    ).toThrow("exceeds the per-cookie byte budget");
  });

  it("reads and writes SQLite in a Durable Object", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("runtime-probe-v1");
    const decision = await stub.checkAndConsume({
      subjectHash: "a".repeat(43),
      rules: [
        {
          id: "grades_refresh_account",
          limit: 1,
          windowSeconds: 30,
          retentionSeconds: 30,
        },
      ],
      now: 1_800_000_000,
    });

    expect(decision).toEqual({ allowed: true });
  });
});
