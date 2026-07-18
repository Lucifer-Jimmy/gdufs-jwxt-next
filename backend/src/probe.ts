import { Hono } from "hono";

import { securityHeaders } from "./security/headers";
import { requestId } from "./security/request-id";
import { runUpstreamProbe } from "./services/upstream-probe";

interface ProbeBindings {
  PROBE_ENABLED?: string;
  PROBE_TOKEN?: string;
}

const app = new Hono<{
  Bindings: ProbeBindings;
  Variables: { requestId: string };
}>();

app.use("*", securityHeaders);
app.use("*", requestId);
app.use("*", async (context, next) => {
  await next();
  context.header("Cache-Control", "no-store, private");
});

app.post("/__probe/upstreams", async (context) => {
  if (context.env.PROBE_ENABLED !== "true") {
    return context.notFound();
  }

  const expectedToken = context.env.PROBE_TOKEN;
  const providedToken = bearerToken(context.req.header("Authorization"));
  if (
    expectedToken === undefined ||
    providedToken === null ||
    !constantTimeEqual(providedToken, expectedToken)
  ) {
    return context.json(
      {
        error: {
          code: "PROBE_UNAUTHORIZED",
          message: "探针授权失败",
          requestId: context.get("requestId"),
        },
      },
      401,
    );
  }

  const result = await runUpstreamProbe();
  return context.json({
    ...result,
    runtime: {
      colo: readColo(context.req.raw),
    },
  });
});

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "PROBE_NOT_FOUND",
        message: "探针不可用",
        requestId: context.get("requestId"),
      },
    },
    404,
  ),
);

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length);
  return token.length > 0 ? token : null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < leftBytes.byteLength; index++) {
    const leftByte = leftBytes.at(index) ?? 0;
    const rightByte = rightBytes.at(index) ?? 0;
    difference |= leftByte ^ rightByte;
  }
  return difference === 0;
}

function readColo(request: Request): string | null {
  const cf = request.cf;
  return typeof cf?.colo === "string" ? cf.colo : null;
}

export default app;
