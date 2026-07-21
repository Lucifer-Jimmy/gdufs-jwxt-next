# 单元测试

本文档说明项目测试分层、Workers Vitest 环境、单元测试写法、fixture 安全和调试方式。当前前端尚未进入功能开发阶段，因此已有自动化测试集中在后端；阶段 3 起应按 `AGENTS.md` 引入 Testing Library 与 Playwright。

## 1. 当前测试栈

- 测试运行器：Vitest。
- Worker 运行时：`@cloudflare/vitest-pool-workers`，测试实际运行在 workerd。
- API 和边界校验：Zod。
- Worker 集成请求：`cloudflare:test` 的 `SELF`。
- Durable Objects：`cloudflare:test` 的 `env` namespace binding。

`backend/vitest.config.ts` 直接读取正式 Wrangler 配置，保证 binding、迁移和入口一致：

```ts
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
```

正式 Wrangler 配置声明了 required secrets。测试配置在加载 Wrangler 前通过 `globalThis.process.env` 注入仅用于测试的合成 base64url 值，保证测试不会读取真实 secret，也不会因为 required secret 缺失而改变正式 binding。该注入只存在于 Vitest 进程，不得复制到 `.dev.vars` 或生产配置。

## 2. 运行测试

运行全部 workspace 测试：

```bash
pnpm test
```

只运行后端：

```bash
pnpm --filter @gdufs-jwxt/backend test
```

直接把参数传给 Vitest，运行单个文件或按名称过滤：

```bash
pnpm --filter @gdufs-jwxt/backend exec vitest run tests/encrypted-state.test.ts
pnpm --filter @gdufs-jwxt/backend exec vitest run -t "rejects tampering"
```

本地调试时使用 watch 模式：

```bash
pnpm --filter @gdufs-jwxt/backend exec vitest
```

Workers 测试池需要启动本地 workerd；受限沙箱若报 `listen EPERM`，应允许该测试命令启动本地监听，而不是改成 Node 环境绕过 Worker 兼容性验证。

## 3. 测试分层

### 纯函数单元测试

适用于 schema、编码、解析、时间计算和错误映射。输入应固定，避免网络和系统时间。加密测试把 `now` 和 keyring 显式传入，例如：

```ts
const opened = await openState(token, "mfa", payloadSchema, keyring, now + 30);

expect(opened).toMatchObject({
  status: "valid",
});
```

时间边界应分别测试到期前一秒和到期时刻，不能只测“明显未过期”的普通值。

### Worker 请求集成测试

通过 `SELF.fetch` 调用正式 Worker 入口，验证中间件、路由、header 和 Static Assets 边界：

```ts
const response = await SELF.fetch("https://example.test/api/v1/health");

expect(response.status).toBe(200);
expect(response.headers.get("Cache-Control")).toBe("no-store, private");
expect(response.headers.get("X-Request-Id")).toBeTruthy();
```

API 404 必须额外断言 `Content-Type` 是 JSON，防止请求错误落入 SPA fallback。

### Durable Object 测试

通过测试环境的 namespace 取得确定性实例：

```ts
const stub = env.RATE_LIMIT_SHARD.getByName("rate-limit-test");
const decision = await stub.checkAndConsume({
  subjectHash: "a".repeat(43),
  rules: [RATE_LIMIT_RULES.gradesRefreshAccount],
  now: 1_800_000_000,
});
```

正式限流测试覆盖同主体并发原子性、不同主体隔离、16 分片稳定映射、窗口边界、过期清理和默认拒绝故障语义。

### 上游服务契约测试

不得在常规测试中请求学校系统。使用 mock `fetch` 和脱敏 fixture 验证 URL 白名单、方法、header、表单字段、手动重定向、Cookie 变化和解析错误。测试断言不能输出完整请求凭据或上游正文。

认证 API 契约测试必须逐项断言旧项目生产顺序：CAS 登录页、密码 POST、MFA 页面、发送验证码、校验验证码、重新获取 ticket、JWXT ticket、`/sso.jsp`、`/jsxsd/xk/LoginToXk?ticket1=...`、个人信息验证。必须断言包括 `/jsxsd/sso.jsp` 在内的其他路径不能借 ticket1 绕过白名单。还必须断言 authserver Cookie 不进入全新的 JWXT client、MFA Cookie 在发送后保存更新后的 authserver Cookie、成功后清 MFA Cookie并签发正式 Cookie，以及 `/me` 仅在成功后返回续期 Cookie。

会话 fixture 必须匹配当前 `auth-state.ts` 的 schema：claims 元数据位于外层，payload 只包含用途字段；账号 HMAC 使用合法 43 字符 base64url，流程 ID 使用合法 UUID，上游 Cookie 包含 `hostOnly` 和 `secure`。表单 body 断言使用 `arrayBuffer()` 解码，避免 workerd 对测试中的不匹配文本解码产生警告。

## 4. 编写测试

测试文件放在对应 workspace 的 `tests/`，命名为 `<subject>.test.ts` 或 `<component>.test.tsx`。推荐结构：

```ts
describe("encrypted client state", () => {
  it("rejects a purpose mismatch", async () => {
    // Arrange: only synthetic keys and fixtures.
    // Act: call the public function or Worker boundary.
    // Assert: verify behavior, not private implementation details.
  });
});
```

注释只用于解释协议或安全原因，不必机械写出 Arrange/Act/Assert。测试名称应描述可观察行为和边界。

每个功能至少考虑：

- 正常成功；
- 输入缺失、格式错误和最大长度；
- 过期、边界时刻和重试等待；
- 上游超时、非 JSON、字段缺失和结构变化；
- 未认证、用途错配和密文篡改；
- 响应不含内部异常或敏感值。

## 5. Fixture 安全

fixture 必须完全合成或彻底脱敏。允许结构等价，不允许包含真实：

- 账号、密码、姓名、学号和手机号；
- 成绩、Cookie、ticket、验证码和密钥；
- 原始上游 HTML/JSON 响应或带查询参数的完整跳转 URL。

推荐使用明显的测试值：

```ts
const keyring = {
  current: {
    version: "1",
    key: new Uint8Array(32).fill(7),
  },
};
```

固定填充值只能用于测试，不能进入 `.dev.vars.example` 或生产配置。真实响应若用于建立 fixture，应先离线最小化和脱敏，再人工检查 Git diff。

## 6. 调试失败测试

1. 用文件路径或 `-t` 缩小范围。
2. 检查测试是否运行在 workerd，而不是 Node.js。
3. 对时间逻辑传入固定 `now`，不要依赖 `Date.now()`。
4. 对随机加密只断言格式、可解封和篡改行为，不断言密文全文。
5. 对 Worker 响应先检查状态、Content-Type 和 request ID，再解析 JSON。
6. 只打印合成值；完成排查后移除临时日志。

Vitest 可输出更详细的测试信息：

```bash
pnpm --filter @gdufs-jwxt/backend exec vitest run \
  tests/request-security.test.ts \
  --reporter=verbose
```

## 7. 前端测试接入要求

前端已使用 Vitest jsdom 与 Testing Library 建立测试入口。当前 `frontend/tests/login-page.test.tsx` 覆盖空字段校验、真实请求结构、MFA 跳转和 API 错误上下文；`frontend/tests/api.test.ts` 覆盖成功响应仍必须通过 Zod 运行时契约。后续功能继续使用：

- Testing Library 测表单语义、键盘行为、加载/空/错误状态；
- `fetch` 边界 mock 或 MSW 模拟 `/api/v1`，响应仍需经过前端 Zod 校验；
- Playwright 测登录 mock 流程、概览、成绩、详情、导出和手机/桌面视觉；
- 图表同时断言可访问文本/表格替代，不能只做截图测试。

不得使用真实学校账号运行自动化端到端测试。

## 8. 完成检查

测试通过不等于功能完成。提交前至少执行：

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler-build.log pnpm build
```

涉及前端时还必须完成 Playwright 手机/桌面截图、键盘、焦点、reduced motion 和溢出检查；涉及上游或 Cloudflare 行为时按对应长期文档执行专项验证。
