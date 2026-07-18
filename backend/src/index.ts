import { Hono } from "hono";

import type { Bindings } from "./env";
import { RateLimitShard } from "./rate-limit/rate-limit-shard";
import { api } from "./routes/api";
import { securityHeaders } from "./security/headers";
import { requestId } from "./security/request-id";

const app = new Hono<{
  Bindings: Bindings;
  Variables: { requestId: string };
}>();

app.use("*", securityHeaders);
app.use("/api/*", requestId);
app.use("/api/*", async (context, next) => {
  await next();
  context.header("Cache-Control", "no-store, private");
});
app.route("/api", api);
app.all("/api/*", (context) =>
  context.json(
    {
      error: {
        code: "API_ROUTE_NOT_FOUND",
        message: "请求的 API 不存在",
        requestId: context.get("requestId"),
      },
    },
    404,
  ),
);

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export { RateLimitShard };
export default app;
