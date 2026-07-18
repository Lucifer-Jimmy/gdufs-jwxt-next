import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { DomainError } from "../src/errors/domain-error";
import { errorResponse } from "../src/errors/http-error";
import {
  requireJsonContentType,
  requireSameOrigin,
} from "../src/security/request-guards";

function createTestApp(): Hono<{ Variables: { requestId: string } }> {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use("*", async (context, next) => {
    context.set("requestId", "request_fixture_1");
    await next();
  });
  app.post("/protected", requireJsonContentType, requireSameOrigin, (context) =>
    context.json({ accepted: true }),
  );
  app.get("/failure", () => {
    throw new Error("sensitive upstream exception");
  });
  app.get("/limited", () => {
    throw new DomainError({
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试",
      status: 429,
      retryAfterSeconds: 30,
    });
  });
  app.onError((error, context) => errorResponse(context, error));
  return app;
}

describe("request security guards", () => {
  it("accepts same-origin JSON requests", async () => {
    const response = await createTestApp().request(
      "https://example.test/protected",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Origin: "https://example.test",
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(200);
  });

  it("rejects missing JSON content type and cross-origin requests", async () => {
    const missingJson = await createTestApp().request(
      "https://example.test/protected",
      {
        method: "POST",
        headers: { Origin: "https://example.test" },
      },
    );
    const crossOrigin = await createTestApp().request(
      "https://example.test/protected",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.test",
        },
        body: "{}",
      },
    );

    await expect(missingJson.json()).resolves.toMatchObject({
      error: { code: "INVALID_CONTENT_TYPE", requestId: "request_fixture_1" },
    });
    await expect(crossOrigin.json()).resolves.toMatchObject({
      error: { code: "INVALID_ORIGIN", requestId: "request_fixture_1" },
    });
  });

  it("allows a same-origin Referer fallback when Origin is absent", async () => {
    const response = await createTestApp().request(
      "https://example.test/protected",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Referer: "https://example.test/login",
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(200);
  });

  it("maps rate limits and hides unknown exception details", async () => {
    const limited = await createTestApp().request(
      "https://example.test/limited",
    );
    const failure = await createTestApp().request(
      "https://example.test/failure",
    );
    const failureText = await failure.text();

    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED", retryAfterSeconds: 30 },
    });
    expect(failure.status).toBe(500);
    expect(failureText).not.toContain("sensitive upstream exception");
    expect(JSON.parse(failureText)).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });
});
