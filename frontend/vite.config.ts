import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

import { mockApiPlugin } from "./mocks/dev-api";

// `vite --mode mock` 启用假接口：拦截 /api/v1/* 返回测试数据，
// 无需登录、无需后端即可浏览全部页面。此时不注册后端代理。
export default defineConfig(({ mode }) => {
  const useMock = mode === "mock";
  return {
    plugins: [react(), tailwindcss(), ...(useMock ? [mockApiPlugin()] : [])],
    test: {
      environment: "jsdom",
      setupFiles: "./tests/setup.ts",
      restoreMocks: true,
    },
    // mock 模式不注册后端代理；exactOptionalPropertyTypes 下用条件展开
    // 而非 server: undefined。
    ...(useMock
      ? {}
      : {
        server: {
          proxy: {
            // 后端对写接口强制同源校验（CSRF 防护），其「同源」以 worker 收到的
            // Host 头推导。拆分开发模式下浏览器 Origin 是 :5173，而代理转发到
            // wrangler 时 Host 变为目标 :8787，两者不同源会被 403 拦在登录之前。
            // 这里把出站请求的 Origin 改写为与目标 Host 一致，让校验看到真正的同源
            // 请求。仅影响开发代理，生产环境前端与 API 同源，校验逻辑不受影响。
            "/api": {
              target: "http://127.0.0.1:8787",
              changeOrigin: true,
              headers: { origin: "http://127.0.0.1:8787" },
            },
          },
        },
      }),
  };
});
