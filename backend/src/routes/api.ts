import { Hono } from "hono";

interface ApiVariables {
  requestId: string;
}

export const api = new Hono<{
  Bindings: Bindings;
  Variables: ApiVariables;
}>();

api.get("/v1/health", (context) => context.json({ status: "ok" as const }));

api.notFound((context) =>
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
