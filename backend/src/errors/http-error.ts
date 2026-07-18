import type { Context, Env } from "hono";

import { DomainError } from "./domain-error";

export function errorResponse<
  E extends Env & { Variables: { requestId: string } },
>(context: Context<E>, error: unknown): Response {
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
