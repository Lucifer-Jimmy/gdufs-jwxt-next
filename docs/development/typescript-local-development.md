# TypeScript 本地开发与调试

本文档说明前后端 TypeScript 的本地开发循环、联调和调试方式。Cloudflare 登录、远程预览和部署操作见 [Wrangler 开发、调试与部署](../cloudflare/wrangler-development.md)。

## 1. 环境准备

仓库要求 Node.js `>=24.0.0` 和 pnpm `11.1.2`。在根目录执行：

```bash
node --version
pnpm --version
pnpm install
pnpm typecheck
```

只使用根目录 `pnpm-lock.yaml`。不要在 `frontend/` 或 `backend/` 内运行 npm/yarn 生成额外锁文件。

## 2. TypeScript 严格模式

前后端继承 `tsconfig.base.json`。关键约束如下：

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "allowJs": false,
  },
}
```

因此开发时应遵循：

- 网络、Cookie、HTML 和 JSON 都是边界数据，先用 Zod 或解析器校验，再进入业务层；
- 数组索引和对象查找可能得到 `undefined`，必须显式处理；
- 可选属性与 `T | undefined` 语义不同，不用类型断言掩盖问题；
- `catch` 中先判断错误类型，不直接读取未知值属性；
- 业务源码只新增 `.ts` 或 `.tsx`。

持续检查全部 workspace：

```bash
pnpm typecheck
```

只检查一个 workspace：

```bash
pnpm --filter @gdufs-jwxt/frontend typecheck
pnpm --filter @gdufs-jwxt/backend typecheck
```

## 3. 前端开发

阶段 3 以后，日常只开发浏览器界面时启动 Vite：

```bash
pnpm --filter @gdufs-jwxt/frontend dev
```

Vite 会输出本地 URL并提供 React Fast Refresh。浏览器 DevTools 用于：

- `Sources`：查看带 sourcemap 的 `.tsx`，设置断点和检查调用栈；
- `Network`：确认前端只请求相对路径 `/api/v1/...`，检查状态码、请求 ID和 `Cache-Control`；
- `Application`：确认没有使用 Local Storage、Session Storage、IndexedDB 或 Cache API 保存个人数据；
- `Console`：定位 React 错误，但不得打印账号、验证码、个人信息或成绩。

目前 Vite 配置不代理 API。需要真实同源 API 与 Cookie 行为时，使用下一节的单 Worker方式。

## 4. 单 Worker 联调

根命令会先构建前端，再由 Wrangler 启动 Worker：

```bash
pnpm dev
```

等价命令为：

```bash
pnpm --filter @gdufs-jwxt/frontend build
pnpm --filter @gdufs-jwxt/backend dev
```

Wrangler 默认通常监听 `http://localhost:8787`。该模式最接近生产拓扑：

```text
浏览器
  -> 同一 localhost origin
  -> /api/* 进入 Hono
  -> 其他路径进入 Workers Static Assets
```

验证入口：

```bash
curl -i http://localhost:8787/api/v1/health
curl -i http://localhost:8787/api/v1/not-found
```

修改前端源码后，当前根命令不会自动重建 `frontend/dist/`。前端频繁迭代使用 Vite；需要验证同源 Cookie、SPA fallback 或 Worker 集成时重新构建前端并重启 Wrangler。

## 5. 后端调试

Worker 代码运行在 workerd，不应使用 Node.js 专属 `fs`、`net`、`tls` 或进程全局会话。后端调试优先使用以下方式：

1. 将协议解析、加密、schema 和错误映射写成小函数，通过 Vitest 快速复现。
2. 使用 `pnpm --filter @gdufs-jwxt/backend dev` 启动本地 Worker。
3. 用 `curl` 或浏览器 Network 面板发送请求并检查 `X-Request-Id`。
4. 必要日志使用结构化、脱敏字段，只记录请求 ID、阶段和错误类别。

允许的诊断日志形状示例：

```ts
console.error(
  JSON.stringify({
    message: "upstream request failed",
    requestId,
    stage: "auth-login-page",
    errorCode: "UPSTREAM_TIMEOUT",
  }),
);
```

禁止记录 `password`、MFA code、ticket、完整 Cookie、原始上游 HTML、姓名、学号或成绩。未知异常返回客户端前必须经过统一错误映射。

## 6. Binding 类型与配置调试

`backend/src/worker-configuration.d.ts` 由 Wrangler 生成。修改 `backend/wrangler.jsonc` 的 binding 后执行：

```bash
cd backend
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler-types.log pnpm exec wrangler types \
  src/worker-configuration.d.ts \
  --env-interface Bindings \
  --include-runtime false
```

检查生成文件是否最新：

```bash
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler-types-check.log \
  pnpm --filter @gdufs-jwxt/backend types:bindings:check
```

不要新建手写 `Env`/`Bindings` 接口。配置与生成类型不一致时，应修正 `wrangler.jsonc` 或重新生成，而不是使用双重类型断言。

## 7. 常见问题

### 类型检查通过但 Worker 运行失败

确认相关逻辑在 Workers 测试池中执行过，而不只是 Node.js 类型检查。平台 API 和 Durable Objects 应在 `backend/tests/` 中通过 `cloudflare:test` 验证。

### Wrangler 无法写用户级日志

受限环境可把日志写到临时目录：

```bash
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler.log pnpm --filter @gdufs-jwxt/backend dev
```

### 本地 secret 缺失

复制变量名到不提交的 `backend/.dev.vars` 并填入本地测试值。不要修改 `.dev.vars.example` 写入真实值。认证密钥必须满足对应解析器要求，且会话 AEAD 与限流 HMAC 密钥不能复用。

### API 返回 HTML 而不是 JSON

确认请求路径以 `/api/` 开头，并检查 `backend/src/index.ts` 的 API 404 是否仍位于 Static Assets fallback 之前。正式配置通过 `run_worker_first: ["/api/*"]` 保证 API 先进入 Worker。

## 8. 提交前开发检查

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler-build.log pnpm build
git diff --check
git status --short --ignored
```

`pnpm check` 可执行类型、lint、测试和构建，但仍需单独执行格式检查、diff 检查与敏感文件审计。
