# 项目结构

本文档描述当前仓库的目录边界和逐文件职责。新增、删除、移动文件或改变模块职责时必须同步维护本页。`gdufs-jwxt-next-origin/` 只用于迁移后端业务协议，禁止从其前端资料推导新项目设计。

## 1. 总体结构

```text
gdufs-jwxt-next/
├── frontend/                 React + Vite 浏览器应用
├── backend/                  Hono + Cloudflare Workers API
├── docs/                     按长期职责分类的开发文档
├── gdufs-jwxt-next-origin/   只读旧后端迁移参考，Git 忽略
├── AGENTS.md                 最高层需求、架构与开发约束
├── PRODUCT.md                新项目产品定位和体验原则
├── DESIGN.md                 新项目种子视觉系统
└── workspace 配置            pnpm、TypeScript、ESLint、Prettier
```

生产构建保持源码边界分离，但部署为单 Worker：先由 Vite 生成 `frontend/dist/`，随后 Wrangler 把静态资源与 `backend/src/index.ts` 一起打包。`/api/*` 先进入 Hono，其余请求由 Static Assets 提供文件或 SPA fallback。

关键路由配置来自 `backend/wrangler.jsonc`：

```jsonc
"assets": {
  "directory": "../frontend/dist",
  "binding": "ASSETS",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

## 2. 根目录文件

| 文件                  | 用途                                                                         |
| --------------------- | ---------------------------------------------------------------------------- |
| `AGENTS.md`           | 本仓库开发的首要约束，记录确认需求、技术边界、安全规则、阶段门槛和文档规范。 |
| `PRODUCT.md`          | 独立于旧项目的产品目标、用户任务与体验原则。                                 |
| `DESIGN.md`           | 前端 seed 视觉系统；阶段 3 落地真实 token 后需由 `impeccable` 更新。         |
| `LICENSE`             | 项目许可证。                                                                 |
| `.gitignore`          | 排除依赖、构建产物、Wrangler 状态、凭据、本地 secret 和旧参考项目。          |
| `package.json`        | workspace 根命令、Node/pnpm 版本和共享代码质量依赖。                         |
| `pnpm-workspace.yaml` | 声明 `frontend`、`backend` 两个 workspace，并允许必要依赖执行构建脚本。      |
| `pnpm-lock.yaml`      | 唯一依赖锁文件；由 pnpm 维护，不手工编辑。                                   |
| `tsconfig.base.json`  | 前后端继承的严格 TypeScript 基线。                                           |
| `eslint.config.mjs`   | 使用类型信息检查 TypeScript/TSX，并忽略生成物和旧参考项目。                  |

根命令负责跨 workspace 编排，例如：

```json
{
  "typecheck": "pnpm -r typecheck",
  "test": "pnpm -r --if-present test",
  "build": "pnpm --filter @gdufs-jwxt/frontend build && pnpm --filter @gdufs-jwxt/backend build"
}
```

## 3. 前端目录

当前前端仍是阶段 0 的最小运行门，阶段 3 才会建立 `components/`、`features/`、`routes/`、`lib/` 和完整样式体系。

| 文件                      | 用途                                                           |
| ------------------------- | -------------------------------------------------------------- |
| `frontend/package.json`   | 定义 React、Vite、前端构建与类型检查命令。                     |
| `frontend/tsconfig.json`  | 浏览器 DOM、React JSX、Vite 类型和 composite TypeScript 配置。 |
| `frontend/vite.config.ts` | Vite 配置入口，当前只启用 React 插件。                         |
| `frontend/index.html`     | 浏览器 HTML 入口，提供 `#root` 和 `/src/main.tsx` 模块脚本。   |
| `frontend/src/main.tsx`   | React 挂载入口和当前开发门页面。                               |
| `frontend/src/styles.css` | 当前最小全局样式；不是阶段 3 的最终主题。                      |

`frontend/dist/` 和 `frontend/tsconfig.tsbuildinfo` 是本地生成物，不属于源码，也不得提交。

## 4. 后端运行入口与配置

| 文件                                    | 用途                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `backend/package.json`                  | 定义 Hono、Zod、Wrangler、Workers Vitest 池和后端命令。                                 |
| `backend/tsconfig.json`                 | Workers 标准运行时 TypeScript 配置，同时包含 `src/`、`tests/` 和测试配置。              |
| `backend/wrangler.jsonc`                | 正式单 Worker 配置：入口、Static Assets、Durable Object binding、迁移和 observability。 |
| `backend/wrangler.probe.jsonc`          | 阶段 0 远程上游连通性探针的隔离配置，不属于正式 Worker。                                |
| `backend/vitest.config.ts`              | 让 Vitest 在 workerd 测试池中加载正式 Wrangler 配置。                                   |
| `backend/.dev.vars.example`             | 本地 secret 名称示例，只保留空值；真实 `.dev.vars*` 被忽略。                            |
| `backend/src/worker-configuration.d.ts` | Wrangler 根据正式配置生成的 binding 类型；配置变化后重新生成，不手写。                  |

## 5. 后端源码

### 入口与路由

| 文件                        | 用途                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `backend/src/index.ts`      | 正式 Worker 入口，组合安全 header、请求 ID、禁止缓存、Hono API、JSON 404 和静态资源 fallback，并导出 Durable Object。 |
| `backend/src/routes/api.ts` | `/api/v1` 路由树；当前实现健康检查和 API 级 404。                                                                     |
| `backend/src/probe.ts`      | 远程连通性探针入口，只由 `wrangler.probe.jsonc` 打包。                                                                |

### 契约与错误

| 文件                                    | 用途                                                      |
| --------------------------------------- | --------------------------------------------------------- |
| `backend/src/schemas/api.ts`            | `/api/v1` 请求、响应和资源的 Zod schema 及推导类型。      |
| `backend/src/errors/domain-error.ts`    | 可判别领域错误码、HTTP 状态和可选重试时间。               |
| `backend/src/errors/http-error.ts`      | 把领域错误映射为固定 JSON；未知异常隐藏内部细节。         |
| `backend/src/config/security-config.ts` | 解析单会话密钥、版本和限流 secret，并拒绝跨用途密钥复用。 |

### 安全与会话

| 文件                                     | 用途                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `backend/src/security/encoding.ts`       | UTF-8 与 base64url 编解码纯函数。                                     |
| `backend/src/security/headers.ts`        | CSP、Permissions Policy、Referrer Policy、nosniff 和 framing header。 |
| `backend/src/security/request-id.ts`     | 校验或生成 API 请求 ID，并写入响应。                                  |
| `backend/src/security/request-guards.ts` | 修改认证状态请求的 JSON Content-Type 与同源 Origin/Referer 检查。     |
| `backend/src/security/safe-logger.ts`    | 固定事件、阶段和错误码白名单的单行 JSON 安全日志。                    |
| `backend/src/security/runtime-crypto.ts` | 学校统一认证密码协议需要的 AES-CBC 加密；不用于本应用会话。           |
| `backend/src/session/encrypted-state.ts` | AES-GCM 客户端状态签发、解封、用途绑定、过期和硬轮换版本检查。        |
| `backend/src/session/cookie-budget.ts`   | 状态 Cookie 序列化、读取、清除和字节预算检查。                        |

### 上游、解析与限流

| 文件                                         | 用途                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| `backend/src/parsers/auth-login-page.ts`     | 使用 `HTMLRewriter` 提取统一认证登录页的盐和 execution 字段。 |
| `backend/src/parsers/auth-mfa-page.ts`       | 使用 `HTMLRewriter` 提取 MFA 页面脱敏手机号。                 |
| `backend/src/services/authserver.ts`         | 统一认证登录页、密码提交、MFA 重定向和脱敏手机号服务。        |
| `backend/src/services/upstream-probe.ts`     | 固定学校域名探测、逐跳重定向、临时 Cookie jar 和脱敏摘要。    |
| `backend/src/upstream/constants.ts`          | 固定学校 URL、host/path 白名单和 User-Agent。                 |
| `backend/src/upstream/cookie-jar.ts`         | 可序列化上游 Cookie 解析、scope 匹配、替换和过期。            |
| `backend/src/upstream/client.ts`             | 超时、manual redirect、白名单验证和 Cookie 携带。             |
| `backend/src/rate-limit/types.ts`            | 限流动作、规则、检查请求和判定结果类型。                      |
| `backend/src/rate-limit/rules.ts`            | 已确认阈值和业务动作的多维限流策略目录。                      |
| `backend/src/rate-limit/subject.ts`          | HMAC 主体摘要、分片版本和 16 分片映射。                       |
| `backend/src/rate-limit/rate-limit-shard.ts` | SQLite Durable Object 原子计数、过期清理和指定动作清除。      |
| `backend/src/rate-limit/rate-limiter.ts`     | Worker 侧多维策略执行、RPC 路由和 fail-closed 映射。          |

业务服务不得依赖 Hono `Context`。未来认证和教务请求放在 `services/`，HTML/脚本解析放在 `parsers/`，路由只负责 HTTP 适配。

## 6. 后端测试

| 文件                                     | 用途                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `backend/tests/app.test.ts`              | 正式 Worker 路由、header、Workers crypto、Cookie 预算和 SQLite DO 运行时测试。 |
| `backend/tests/api-schema.test.ts`       | API schema 成功样例、格式和长度边界。                                          |
| `backend/tests/encrypted-state.test.ts`  | AEAD 篡改、用途、硬轮换、闲置/绝对过期和续期测试。                             |
| `backend/tests/request-security.test.ts` | Content-Type、同源、统一错误和 `Retry-After` 测试。                            |
| `backend/tests/rate-limit.test.ts`       | HMAC 分片、固定窗口、SQLite 原子计数、并发和清理测试。                         |
| `backend/tests/security-config.test.ts`  | Secret 格式、版本、硬轮换配置和跨用途密钥独立性测试。                          |
| `backend/tests/safe-logger.test.ts`      | 结构化日志白名单、5xx 记录和敏感异常隔离测试。                                 |
| `backend/tests/authserver.test.ts`       | CAS 密码向量、登录表单、Cookie 链和认证错误分类测试。                          |
| `backend/tests/upstream-client.test.ts`  | URL 白名单、重定向和 Cookie jar scope/过期测试。                               |
| `backend/tests/upstream-probe.test.ts`   | 上游探针重定向、Cookie 脱敏、超时和白名单测试。                                |
| `backend/tests/fixtures/session.ts`      | 结构等价且完全脱敏的 MFA/登录状态 fixture。                                    |
| `backend/tests/env.d.ts`                 | 将 Wrangler 生成的 `Bindings` 合并进 Workers 测试环境。                        |

测试的具体写法和运行方式见 [单元测试](../testing/unit-testing.md)。

## 7. 文档与本地生成物

`architecture/`、`development/`、`testing/`、`api/`、`security/`、`cloudflare/` 分别承担单一长期职责，不能按阶段复制同一内容。

| 文件                                               | 用途                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| `docs/README.md`                                   | 开发文档入口、分类说明和当前文档索引。                  |
| `docs/architecture/project-structure.md`           | 当前仓库目录、逐文件职责、模块边界和生成物说明。        |
| `docs/development/typescript-local-development.md` | TypeScript 环境、类型检查、前后端启动、联调和调试。     |
| `docs/testing/unit-testing.md`                     | 测试分层、Workers Vitest、fixture、单元测试写法和排错。 |
| `docs/api/v1-contract.md`                          | `/api/v1` 通用约定、资源 schema 和成绩详情边界。        |
| `docs/authentication/authserver.md`                | 统一认证登录页、CAS 密码、Cookie jar 和 MFA 准备流程。  |
| `docs/security/client-state.md`                    | AES-GCM 客户端状态、Cookie 预算、硬轮换和请求安全。     |
| `docs/security/rate-limiting.md`                   | HMAC 16 分片、SQLite DO 原子限流、规则和故障语义。      |
| `docs/security/configuration-and-logging.md`       | Secret 解析、密钥硬轮换和结构化日志白名单。             |
| `docs/cloudflare/wrangler-development.md`          | Wrangler 登录、本地/远程运行、探针、secret 和部署。     |

以下目录只用于本地运行，不属于项目源文件：

- `node_modules/`、`frontend/node_modules/`、`backend/node_modules/`：pnpm 依赖链接；
- `frontend/dist/`、`backend/dist/`、`backend/dist-probe/`：构建或 dry-run 产物；
- `backend/.wrangler/`：本地 Workers 与 Durable Objects 状态；
- `.pnpm-store/`：本地 pnpm store；
- `coverage/`、`test-results/`、`playwright-report/`：测试产物；
- `.dev.vars*`：本地 secret，只有 `.dev.vars.example` 可提交。
