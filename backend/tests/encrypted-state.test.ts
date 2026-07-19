import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fromBase64Url } from "../src/security/encoding";
import {
  openState,
  renewLoginState,
  sealState,
} from "../src/session/encrypted-state";

const payloadSchema = z.object({
  flowId: z.string(),
  upstreamCookies: z.array(z.string()),
});

const currentKey = { version: "2", key: new Uint8Array(32).fill(2) };
const oldKey = { version: "1", key: new Uint8Array(32).fill(1) };
const now = 1_800_000_000;

describe("encrypted client state", () => {
  it("round-trips valid purpose-bound state", async () => {
    const token = await sealState({
      purpose: "mfa",
      payload: {
        flowId: "fixture-flow",
        upstreamCookies: ["cookie-name=value"],
      },
      now,
      idleTtlSeconds: 600,
      absoluteTtlSeconds: 600,
      key: currentKey,
    });

    const opened = await openState(
      token,
      "mfa",
      payloadSchema,
      currentKey,
      now + 30,
    );

    expect(opened).toMatchObject({
      status: "valid",
      claims: {
        purpose: "mfa",
        issuedAt: now,
        expiresAt: now + 600,
        absoluteExpiresAt: now + 600,
        payload: { flowId: "fixture-flow" },
      },
    });
  });

  it("rejects tampering, purpose mismatch and malformed payloads", async () => {
    const token = await sealState({
      purpose: "mfa",
      payload: { flowId: "fixture-flow", upstreamCookies: [] },
      now,
      idleTtlSeconds: 600,
      absoluteTtlSeconds: 600,
      key: currentKey,
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(
      openState(tampered, "mfa", payloadSchema, currentKey, now),
    ).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      openState(token, "login", payloadSchema, currentKey, now),
    ).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      openState(
        token,
        "mfa",
        z.object({ flowId: z.number() }),
        currentKey,
        now,
      ),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("rejects non-canonical base64url encodings", () => {
    expect(fromBase64Url("Zg")).toEqual(new Uint8Array([102]));
    expect(() => fromBase64Url("Zh")).toThrow("Non-canonical base64url value");
  });

  it("invalidates old cookies after a hard key rotation", async () => {
    const token = await sealState({
      purpose: "login",
      payload: { flowId: "fixture-flow", upstreamCookies: [] },
      now,
      idleTtlSeconds: 7_200,
      absoluteTtlSeconds: 28_800,
      key: oldKey,
    });

    await expect(
      openState(token, "login", payloadSchema, currentKey, now + 1),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("expires at idle and absolute boundaries", async () => {
    const token = await sealState({
      purpose: "login",
      payload: { flowId: "fixture-flow", upstreamCookies: [] },
      now,
      idleTtlSeconds: 100,
      absoluteTtlSeconds: 500,
      key: currentKey,
    });

    await expect(
      openState(token, "login", payloadSchema, currentKey, now + 99),
    ).resolves.toMatchObject({
      status: "valid",
    });
    await expect(
      openState(token, "login", payloadSchema, currentKey, now + 100),
    ).resolves.toEqual({
      status: "expired",
    });
  });

  it("renews login activity without crossing the absolute deadline", async () => {
    const token = await sealState({
      purpose: "login",
      payload: { flowId: "fixture-flow", upstreamCookies: [] },
      now,
      idleTtlSeconds: 100,
      absoluteTtlSeconds: 500,
      key: currentKey,
    });
    const opened = await openState(
      token,
      "login",
      payloadSchema,
      currentKey,
      now + 50,
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      throw new Error("Expected valid fixture state");
    }

    const renewed = await renewLoginState(
      opened.claims,
      600,
      currentKey,
      now + 50,
    );
    expect(renewed).toBeDefined();
    if (renewed === undefined) {
      throw new Error("Expected renewed state");
    }
    const reopened = await openState(
      renewed,
      "login",
      payloadSchema,
      currentKey,
      now + 499,
    );

    expect(reopened).toMatchObject({
      status: "valid",
      claims: { lastActivityAt: now + 50, expiresAt: now + 500 },
    });
    await expect(
      openState(renewed, "login", payloadSchema, currentKey, now + 500),
    ).resolves.toEqual({
      status: "expired",
    });
  });
});
