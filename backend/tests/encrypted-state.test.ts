import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  openState,
  renewLoginState,
  sealState,
  type StateKeyring,
} from "../src/session/encrypted-state";

const payloadSchema = z.object({
  flowId: z.string(),
  upstreamCookies: z.array(z.string()),
});

const currentKey = { version: "2", key: new Uint8Array(32).fill(2) };
const previousKey = { version: "1", key: new Uint8Array(32).fill(1) };
const keyring: StateKeyring = { current: currentKey, previous: previousKey };
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
      keyring,
    });

    const opened = await openState(
      token,
      "mfa",
      payloadSchema,
      keyring,
      now + 30,
    );

    expect(opened).toMatchObject({
      status: "valid",
      needsRotation: false,
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
      keyring,
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    await expect(
      openState(tampered, "mfa", payloadSchema, keyring, now),
    ).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      openState(token, "login", payloadSchema, keyring, now),
    ).resolves.toEqual({
      status: "invalid",
    });
    await expect(
      openState(token, "mfa", z.object({ flowId: z.number() }), keyring, now),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("accepts only the previous key for rotation", async () => {
    const token = await sealState({
      purpose: "login",
      payload: { flowId: "fixture-flow", upstreamCookies: [] },
      now,
      idleTtlSeconds: 7_200,
      absoluteTtlSeconds: 28_800,
      keyring: { current: previousKey },
    });

    await expect(
      openState(token, "login", payloadSchema, keyring, now + 1),
    ).resolves.toMatchObject({
      status: "valid",
      needsRotation: true,
    });
    await expect(
      openState(
        token,
        "login",
        payloadSchema,
        { current: currentKey },
        now + 1,
      ),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("expires at idle and absolute boundaries", async () => {
    const token = await sealState({
      purpose: "login",
      payload: { flowId: "fixture-flow", upstreamCookies: [] },
      now,
      idleTtlSeconds: 100,
      absoluteTtlSeconds: 500,
      keyring,
    });

    await expect(
      openState(token, "login", payloadSchema, keyring, now + 99),
    ).resolves.toMatchObject({
      status: "valid",
    });
    await expect(
      openState(token, "login", payloadSchema, keyring, now + 100),
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
      keyring,
    });
    const opened = await openState(
      token,
      "login",
      payloadSchema,
      keyring,
      now + 50,
    );
    expect(opened.status).toBe("valid");
    if (opened.status !== "valid") {
      throw new Error("Expected valid fixture state");
    }

    const renewed = await renewLoginState(
      opened.claims,
      600,
      keyring,
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
      keyring,
      now + 499,
    );

    expect(reopened).toMatchObject({
      status: "valid",
      claims: { lastActivityAt: now + 50, expiresAt: now + 500 },
    });
    await expect(
      openState(renewed, "login", payloadSchema, keyring, now + 500),
    ).resolves.toEqual({
      status: "expired",
    });
  });
});
