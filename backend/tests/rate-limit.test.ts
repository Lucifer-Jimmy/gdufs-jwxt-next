import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { RateLimitShard } from "../src/rate-limit/rate-limit-shard";
import { enforceRateLimits } from "../src/rate-limit/rate-limiter";
import { RATE_LIMIT_POLICIES, RATE_LIMIT_RULES } from "../src/rate-limit/rules";
import {
  deriveRateLimitSubject,
  parseRateLimitHmacKey,
  RATE_LIMIT_SHARD_COUNT,
  RATE_LIMIT_SHARD_VERSION,
} from "../src/rate-limit/subject";

const now = 1_800_000_000;
const subjectHash = "a".repeat(43);
const hmacKey = new Uint8Array(32).fill(11);

describe("rate-limit subject derivation", () => {
  it("derives stable, versioned shards without exposing the subject", async () => {
    const first = await deriveRateLimitSubject(
      "account",
      "fixture-account",
      hmacKey,
    );
    const second = await deriveRateLimitSubject(
      "account",
      "fixture-account",
      hmacKey,
    );
    const ip = await deriveRateLimitSubject("ip", "fixture-account", hmacKey);

    expect(first).toEqual(second);
    expect(first.hash).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(first.hash).not.toContain("fixture-account");
    expect(first.shardName).toMatch(
      new RegExp(`^${RATE_LIMIT_SHARD_VERSION}-shard-\\d+$`, "u"),
    );
    const shardIndex = Number(first.shardName.split("-").at(-1));
    expect(shardIndex).toBeGreaterThanOrEqual(0);
    expect(shardIndex).toBeLessThan(RATE_LIMIT_SHARD_COUNT);
    expect(ip.hash).not.toBe(first.hash);
  });

  it("requires an exact 32-byte base64url HMAC key", () => {
    const encoded = btoa(String.fromCharCode(...hmacKey))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");

    expect(parseRateLimitHmacKey(encoded)).toEqual(hmacKey);
    expect(() => parseRateLimitHmacKey("c2hvcnQ")).toThrow(
      "32 base64url-encoded bytes",
    );
  });
});

describe("SQLite rate-limit shard", () => {
  it("uses fixed windows and returns the exact remaining wait", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("fixed-window");
    const check = {
      subjectHash,
      rules: [RATE_LIMIT_RULES.gradesRefreshAccount],
    };

    await expect(stub.checkAndConsume({ ...check, now })).resolves.toEqual({
      allowed: true,
    });
    await expect(
      stub.checkAndConsume({ ...check, now: now + 1 }),
    ).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 29,
      limitedBy: "grades_refresh_account",
    });
    await expect(
      stub.checkAndConsume({ ...check, now: now + 30 }),
    ).resolves.toEqual({
      allowed: true,
    });
  });

  it("checks and consumes multiple rules atomically", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("multiple-rules");
    const rules = [
      { ...RATE_LIMIT_RULES.mfaSendAccountShort, limit: 1 },
      { ...RATE_LIMIT_RULES.mfaSendAccountDaily, limit: 2 },
    ];

    await expect(
      stub.checkAndConsume({ subjectHash, rules, now }),
    ).resolves.toEqual({
      allowed: true,
    });
    await expect(
      stub.checkAndConsume({ subjectHash, rules, now: now + 1 }),
    ).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 599,
      limitedBy: "mfa_send_account_short",
    });

    await runInDurableObject(stub, (_instance: RateLimitShard, state) => {
      const rows = state.storage.sql
        .exec<{ action: string; count: number }>(
          "SELECT action, count FROM rate_limit_counters ORDER BY action",
        )
        .toArray();
      expect(rows).toEqual([
        { action: "mfa_send_account_daily", count: 1 },
        { action: "mfa_send_account_short", count: 1 },
      ]);
    });
  });

  it("reports when an accepted consume reaches the requested limit", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("exhaustion-report");
    const rule = { ...RATE_LIMIT_RULES.mfaVerifyFlow, limit: 2 };

    await expect(
      stub.checkAndConsume({
        subjectHash,
        rules: [rule],
        now,
        returnExhaustedAfterConsume: true,
      }),
    ).resolves.toEqual({ allowed: true });
    await expect(
      stub.checkAndConsume({
        subjectHash,
        rules: [rule],
        now: now + 1,
        returnExhaustedAfterConsume: true,
      }),
    ).resolves.toEqual({ allowed: true, exhaustedAfterConsume: true });
  });

  it("serializes concurrent attempts for the same subject", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("concurrent");
    const rule = { ...RATE_LIMIT_RULES.authLoginAccount, limit: 2 };
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () =>
        stub.checkAndConsume({ subjectHash, rules: [rule], now }),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(2);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(8);
  });

  it("isolates subjects and clears only selected actions", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("isolation-clear");
    const rules = [RATE_LIMIT_RULES.authLoginAccount];
    const otherHash = "b".repeat(43);

    for (let index = 0; index < 5; index += 1) {
      await stub.checkAndConsume({ subjectHash, rules, now });
    }
    await expect(
      stub.checkAndConsume({ subjectHash, rules, now }),
    ).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      stub.checkAndConsume({ subjectHash: otherHash, rules, now }),
    ).resolves.toEqual({
      allowed: true,
    });

    await stub.clear(subjectHash, ["auth_login_account"]);
    await expect(
      stub.checkAndConsume({ subjectHash, rules, now }),
    ).resolves.toEqual({
      allowed: true,
    });
  });

  it("removes expired metadata during the next check", async () => {
    const stub = env.RATE_LIMIT_SHARD.getByName("expiry-cleanup");
    await stub.checkAndConsume({
      subjectHash,
      rules: [RATE_LIMIT_RULES.gradesRefreshAccount],
      now,
    });
    await stub.checkAndConsume({
      subjectHash: "b".repeat(43),
      rules: [RATE_LIMIT_RULES.gradesRefreshAccount],
      now: now + 30,
    });

    await runInDurableObject(stub, (_instance: RateLimitShard, state) => {
      const count = state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM rate_limit_counters",
        )
        .one().count;
      expect(count).toBe(1);
    });
  });
});

describe("rate-limit enforcement", () => {
  it("routes dimensions through HMAC shards and throws a recoverable 429", async () => {
    const options = {
      namespace: env.RATE_LIMIT_SHARD,
      hmacKey,
      dimensions: [
        {
          kind: "account" as const,
          subject: "fixture-account",
          rules: RATE_LIMIT_POLICIES.gradesRefresh.account,
        },
      ],
      now,
    };

    await expect(enforceRateLimits(options)).resolves.toBeUndefined();
    await expect(
      enforceRateLimits({ ...options, now: now + 1 }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryAfterSeconds: 29,
    });
  });

  it("fails closed when the security check is unavailable", async () => {
    await expect(
      enforceRateLimits({
        namespace: env.RATE_LIMIT_SHARD,
        hmacKey: new Uint8Array(31),
        dimensions: [
          {
            kind: "account",
            subject: "fixture-account",
            rules: RATE_LIMIT_POLICIES.authLogin.account,
          },
        ],
        now,
      }),
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "安全检查暂时不可用，请稍后重试",
    });
  });
});
