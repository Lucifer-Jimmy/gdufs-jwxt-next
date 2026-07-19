import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../src/errors/domain-error";
import { errorResponse } from "../src/errors/http-error";
import { serializeSafeLog } from "../src/security/safe-logger";
import { Hono } from "hono";

describe("safe structured logging", () => {
  it("serializes only the fixed diagnostic allowlist", () => {
    const serialized = serializeSafeLog({
      event: "request_failed",
      requestId: "request_fixture_1",
      stage: "auth_mfa_verify",
      errorCode: "UPSTREAM_TIMEOUT",
      retryAfterSeconds: 30,
    });

    expect(JSON.parse(serialized)).toEqual({
      event: "request_failed",
      requestId: "request_fixture_1",
      stage: "auth_mfa_verify",
      errorCode: "UPSTREAM_TIMEOUT",
      retryAfterSeconds: 30,
    });
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("ticket");
  });

  it("rejects invalid request IDs and retry delays", () => {
    expect(() =>
      serializeSafeLog({
        event: "request_failed",
        requestId: "bad id",
        stage: "api",
      }),
    ).toThrow("valid request ID");
    expect(() =>
      serializeSafeLog({
        event: "request_failed",
        requestId: "request_fixture_1",
        stage: "rate_limit",
        retryAfterSeconds: 0,
      }),
    ).toThrow("positive integer retry delay");
  });

  it("logs classified 5xx errors without exception details", async () => {
    const sink = vi.fn<(serializedEntry: string) => void>();
    const app = new Hono<{ Variables: { requestId: string } }>();
    app.use("*", async (context, next) => {
      context.set("requestId", "request_fixture_1");
      await next();
    });
    app.get("/failure", () => {
      throw new Error("secret upstream response and cookie");
    });
    app.get("/limited", () => {
      throw new DomainError({
        code: "RATE_LIMITED",
        message: "请求过于频繁，请稍后重试",
        status: 429,
        retryAfterSeconds: 30,
      });
    });
    app.onError((error, context) => errorResponse(context, error, sink));

    expect((await app.request("https://example.test/failure")).status).toBe(
      500,
    );
    expect((await app.request("https://example.test/limited")).status).toBe(
      429,
    );
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sink.mock.calls[0]?.[0] ?? "")).toEqual({
      event: "request_failed",
      requestId: "request_fixture_1",
      stage: "api",
      errorCode: "INTERNAL_ERROR",
    });
    expect(sink.mock.calls[0]?.[0]).not.toContain("secret upstream response");
    expect(sink.mock.calls[0]?.[0]).not.toContain("cookie");
  });
});
