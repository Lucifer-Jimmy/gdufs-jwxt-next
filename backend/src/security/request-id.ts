import type { MiddlewareHandler } from "hono";

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId: MiddlewareHandler = async (context, next) => {
  const providedRequestId = context.req.header("X-Request-Id");
  const currentRequestId =
    providedRequestId !== undefined && SAFE_REQUEST_ID.test(providedRequestId)
      ? providedRequestId
      : crypto.randomUUID();

  context.set("requestId", currentRequestId);
  await next();
  context.header("X-Request-Id", currentRequestId);
};
