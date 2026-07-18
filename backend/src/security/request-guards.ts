import type { MiddlewareHandler } from "hono";

import { DomainError } from "../errors/domain-error";

export const requireJsonContentType: MiddlewareHandler = async (
  context,
  next,
) => {
  const contentType = context.req.header("Content-Type");
  if (contentType === undefined || !isJsonMediaType(contentType)) {
    throw new DomainError({
      code: "INVALID_CONTENT_TYPE",
      message: "请求必须使用 application/json",
      status: 400,
    });
  }

  await next();
};

export const requireSameOrigin: MiddlewareHandler = async (context, next) => {
  const requestOrigin = new URL(context.req.url).origin;
  const origin = context.req.header("Origin");

  if (origin !== undefined) {
    if (!sameOrigin(origin, requestOrigin)) {
      throw invalidOrigin();
    }
    await next();
    return;
  }

  const referer = context.req.header("Referer");
  if (referer === undefined || !sameOrigin(referer, requestOrigin)) {
    throw invalidOrigin();
  }

  await next();
};

function isJsonMediaType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function sameOrigin(candidate: string, expected: string): boolean {
  try {
    return new URL(candidate).origin === expected;
  } catch {
    return false;
  }
}

function invalidOrigin(): DomainError {
  return new DomainError({
    code: "INVALID_ORIGIN",
    message: "请求来源无效，请刷新页面后重试",
    status: 403,
  });
}
