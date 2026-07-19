import { DomainError } from "../errors/domain-error";
import type { RateLimitRule } from "./types";
import { deriveRateLimitSubject } from "./subject";

interface RateLimitDimension {
  kind: "account" | "flow" | "ip";
  subject: string;
  rules: readonly RateLimitRule[];
}

interface EnforceRateLimitsOptions {
  namespace: DurableObjectNamespace<import("../index").RateLimitShard>;
  hmacKey: Uint8Array<ArrayBuffer>;
  dimensions: RateLimitDimension[];
  now: number;
}

export async function enforceRateLimits(
  options: EnforceRateLimitsOptions,
): Promise<void> {
  for (const dimension of options.dimensions) {
    try {
      const subject = await deriveRateLimitSubject(
        dimension.kind,
        dimension.subject,
        options.hmacKey,
      );
      const decision = await options.namespace
        .getByName(subject.shardName)
        .checkAndConsume({
          subjectHash: subject.hash,
          rules: [...dimension.rules],
          now: options.now,
        });

      if (!decision.allowed) {
        throw new DomainError({
          code: "RATE_LIMITED",
          message: "请求过于频繁，请稍后重试",
          status: 429,
          retryAfterSeconds: decision.retryAfterSeconds,
        });
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError({
        code: "INTERNAL_ERROR",
        message: "安全检查暂时不可用，请稍后重试",
        status: 500,
      });
    }
  }
}
