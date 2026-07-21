import { DomainError } from "../errors/domain-error";
import type {
  RateLimitAction,
  RateLimitDecision,
  RateLimitRule,
} from "./types";
import { deriveRateLimitSubject } from "./subject";

export interface RateLimitDimension {
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

interface ConsumeRateLimitOptions {
  namespace: DurableObjectNamespace<import("../index").RateLimitShard>;
  hmacKey: Uint8Array<ArrayBuffer>;
  dimension: RateLimitDimension;
  now: number;
  returnExhaustedAfterConsume?: boolean;
}

interface ClearRateLimitOptions {
  namespace: DurableObjectNamespace<import("../index").RateLimitShard>;
  hmacKey: Uint8Array<ArrayBuffer>;
  dimension: Pick<RateLimitDimension, "kind" | "subject">;
  actions: RateLimitAction[];
}

export async function enforceRateLimits(
  options: EnforceRateLimitsOptions,
): Promise<void> {
  for (const dimension of options.dimensions) {
    const decision = await consumeRateLimit({
      namespace: options.namespace,
      hmacKey: options.hmacKey,
      dimension,
      now: options.now,
    });
    if (!decision.allowed) {
      throw rateLimited(decision.retryAfterSeconds);
    }
  }
}

export async function consumeRateLimit(
  options: ConsumeRateLimitOptions,
): Promise<RateLimitDecision> {
  try {
    const subject = await deriveRateLimitSubject(
      options.dimension.kind,
      options.dimension.subject,
      options.hmacKey,
    );
    return await options.namespace
      .getByName(subject.shardName)
      .checkAndConsume({
        subjectHash: subject.hash,
        rules: [...options.dimension.rules],
        now: options.now,
        ...(options.returnExhaustedAfterConsume === true
          ? { returnExhaustedAfterConsume: true }
          : {}),
      });
  } catch {
    throw new DomainError({
      code: "INTERNAL_ERROR",
      message: "安全检查暂时不可用，请稍后重试",
      status: 500,
    });
  }
}

export async function clearRateLimitActions(
  options: ClearRateLimitOptions,
): Promise<void> {
  try {
    const subject = await deriveRateLimitSubject(
      options.dimension.kind,
      options.dimension.subject,
      options.hmacKey,
    );
    await options.namespace
      .getByName(subject.shardName)
      .clear(subject.hash, options.actions);
  } catch {
    throw new DomainError({
      code: "INTERNAL_ERROR",
      message: "安全检查暂时不可用，请稍后重试",
      status: 500,
    });
  }
}

function rateLimited(retryAfterSeconds: number): DomainError {
  return new DomainError({
    code: "RATE_LIMITED",
    message: "请求过于频繁，请稍后重试",
    status: 429,
    retryAfterSeconds,
  });
}
