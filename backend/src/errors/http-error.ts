import type { Context, Env } from "hono";

import { logError } from "../security/safe-logger";
import { DomainError } from "./domain-error";

export function errorResponse<
  E extends Env & { Variables: { requestId: string } },
>(
  context: Context<E>,
  error: unknown,
  logSink?: (serializedEntry: string) => void,
): Response {
  const domainError =
    error instanceof DomainError
      ? error
      : new DomainError({
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用，请稍后重试",
          status: 500,
        });

  if (domainError.retryAfterSeconds !== undefined) {
    context.header("Retry-After", String(domainError.retryAfterSeconds));
  }

  if (domainError.status >= 500) {
    const entry = {
      event: "request_failed" as const,
      requestId: context.get("requestId"),
      stage: "api" as const,
      errorCode: domainError.code,
    };
    if (logSink === undefined) {
      logError(entry);
    } else {
      logError(entry, logSink);
    }
  }

  const retryAfter =
    domainError.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: domainError.retryAfterSeconds };

  return context.json(
    {
      error: {
        code: domainError.code,
        message: domainError.message,
        requestId: context.get("requestId"),
        ...retryAfter,
      },
    },
    domainError.status,
  );
}
