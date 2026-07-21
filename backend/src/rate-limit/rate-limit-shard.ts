import { DurableObject } from "cloudflare:workers";

import type {
  RateLimitAction,
  RateLimitCheck,
  RateLimitDecision,
} from "./types";

type StoredCounter = {
  count: number;
  window_started_at: number;
  expires_at: number;
} & Record<string, SqlStorageValue>;

export class RateLimitShard extends DurableObject<Bindings> {
  constructor(state: DurableObjectState, env: Bindings) {
    super(state, env);
    void this.ctx.blockConcurrencyWhile(() => Promise.resolve(this.migrate()));
  }

  checkAndConsume(check: RateLimitCheck): RateLimitDecision {
    validateCheck(check);

    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM rate_limit_counters WHERE expires_at <= ?",
        check.now,
      );

      const pending = check.rules.map((rule) => {
        const existing = this.readCounter(check.subjectHash, rule.id);
        const active =
          existing !== undefined &&
          check.now < existing.window_started_at + rule.windowSeconds;
        const count = active ? existing.count : 0;
        const windowStartedAt = active ? existing.window_started_at : check.now;

        return { rule, count, windowStartedAt };
      });

      const denied = pending
        .filter(({ rule, count }) => count >= rule.limit)
        .map(({ rule, windowStartedAt }) => ({
          limitedBy: rule.id,
          retryAfterSeconds: Math.max(
            1,
            windowStartedAt + rule.windowSeconds - check.now,
          ),
        }))
        .sort(
          (left, right) => right.retryAfterSeconds - left.retryAfterSeconds,
        )[0];

      if (denied !== undefined) {
        return { allowed: false, ...denied };
      }

      for (const { rule, count, windowStartedAt } of pending) {
        const expiresAt = windowStartedAt + rule.retentionSeconds;
        this.ctx.storage.sql.exec(
          `INSERT INTO rate_limit_counters
             (subject_hash, action, count, window_started_at, expires_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(subject_hash, action) DO UPDATE SET
             count = excluded.count,
             window_started_at = excluded.window_started_at,
             expires_at = excluded.expires_at`,
          check.subjectHash,
          rule.id,
          count + 1,
          windowStartedAt,
          expiresAt,
        );
      }

      const exhaustedAfterConsume =
        check.returnExhaustedAfterConsume === true &&
        pending.some(({ rule, count }) => count + 1 >= rule.limit);

      return exhaustedAfterConsume
        ? { allowed: true, exhaustedAfterConsume: true }
        : { allowed: true };
    });
  }

  clear(subjectHash: string, actions: RateLimitAction[]): void {
    validateSubjectHash(subjectHash);
    for (const action of actions) {
      this.ctx.storage.sql.exec(
        "DELETE FROM rate_limit_counters WHERE subject_hash = ? AND action = ?",
        subjectHash,
        action,
      );
    }
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limit_counters (
        subject_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        count INTEGER NOT NULL CHECK (count > 0),
        window_started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (subject_hash, action)
      );
      CREATE INDEX IF NOT EXISTS rate_limit_counters_expiry
        ON rate_limit_counters (expires_at);
      INSERT OR IGNORE INTO _sql_schema_migrations (id, applied_at)
        VALUES (1, 0);
    `);
  }

  private readCounter(
    subjectHash: string,
    action: RateLimitAction,
  ): StoredCounter | undefined {
    return this.ctx.storage.sql
      .exec<StoredCounter>(
        `SELECT count, window_started_at, expires_at
           FROM rate_limit_counters
          WHERE subject_hash = ? AND action = ?`,
        subjectHash,
        action,
      )
      .toArray()[0];
  }
}

function validateCheck(check: RateLimitCheck): void {
  validateSubjectHash(check.subjectHash);
  if (
    !Number.isSafeInteger(check.now) ||
    check.now < 0 ||
    check.rules.length === 0 ||
    (check.returnExhaustedAfterConsume !== undefined &&
      typeof check.returnExhaustedAfterConsume !== "boolean")
  ) {
    throw new Error("Invalid rate-limit check");
  }

  const actionIds = new Set<RateLimitAction>();
  for (const rule of check.rules) {
    if (
      actionIds.has(rule.id) ||
      !Number.isSafeInteger(rule.limit) ||
      rule.limit <= 0 ||
      !Number.isSafeInteger(rule.windowSeconds) ||
      rule.windowSeconds <= 0 ||
      !Number.isSafeInteger(rule.retentionSeconds) ||
      rule.retentionSeconds < rule.windowSeconds ||
      rule.retentionSeconds > 86_400
    ) {
      throw new Error("Invalid rate-limit rule");
    }
    actionIds.add(rule.id);
  }
}

function validateSubjectHash(subjectHash: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(subjectHash)) {
    throw new Error("Invalid rate-limit subject hash");
  }
}
