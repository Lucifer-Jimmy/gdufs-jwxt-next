import type { MiddlewareHandler } from "hono";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

export const securityHeaders: MiddlewareHandler = async (context, next) => {
  await next();

  context.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  context.header(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=()",
  );
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
};
