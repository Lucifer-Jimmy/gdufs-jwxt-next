# 安全配置与结构化日志

本文档说明 Cloudflare secrets 的运行时解析、单密钥硬轮换边界和结构化日志白名单。配置错误必须拒绝受保护功能，日志不得接收任意对象、原始异常或用户业务数据。

## 1. Secret 契约

`backend/src/config/security-config.ts` 定义最小 secret binding：

```ts
export interface SecuritySecretBindings {
  SESSION_AEAD_KEY: string;
  SESSION_AEAD_KEY_VERSION: string;
  RATE_LIMIT_HMAC_KEY_V1: string;
}
```

- `SESSION_AEAD_KEY`：唯一有效的会话 AES-256-GCM 密钥。
- `SESSION_AEAD_KEY_VERSION`：写入 token 的当前密钥版本。
- `RATE_LIMIT_HMAC_KEY_V1`：限流主体 HMAC-SHA256 密钥。

两个 key 值都是 32 字节随机值的无 padding base64url 编码，版本是 1–32 字符的安全标识。它们只通过 Cloudflare secrets 或本地未提交的 `.dev.vars` 注入，不写入 `wrangler.jsonc`、源码或生成的 binding 文件。

## 2. 解析与独立性

`loadSecurityConfig()` 完成规范 base64url 解码、长度和版本检查，以及限流密钥解析：

```ts
const sessionKey = parseSessionKey(
  env.SESSION_AEAD_KEY,
  env.SESSION_AEAD_KEY_VERSION,
);
const rateLimitHmacKey = parseRateLimitHmacKey(env.RATE_LIMIT_HMAC_KEY_V1);
```

会话与限流密钥必须密码学独立。解析器以固定循环比较两把密钥，复用会被拒绝：

```ts
if (constantTimeEqual(sessionKey.key, rateLimitHmacKey)) {
  throw new Error("Session AEAD and rate-limit HMAC keys must be independent");
}
```

不要捕获该错误后使用默认密钥或降级放行。阶段 2 路由应在进入会话或限流逻辑前加载配置，并把失败映射为不含 secret 名称和值的通用 `500`。

## 3. 轮换流程

会话密钥不做定期自动轮换。需要硬轮换时：

1. 生成独立的新 32 字节随机值。
2. 将 `SESSION_AEAD_KEY_VERSION` 增加到从未使用过的新版本。
3. 在同一次部署中更新 `SESSION_AEAD_KEY` 和版本。
4. 验证旧 Cookie 返回未认证并被清除，新登录使用新版本。
5. 保留旧密钥的安全审计记录但不得保留可恢复的明文值。

硬切换会立即注销全部现有会话，这是预期安全行为。若轮换源于泄露，不得接受旧密钥；代码回滚也不得回滚 secrets。

限流 HMAC 密钥与 16 分片映射直接相关，不能随意轮换。更换会让所有主体获得新的摘要和额度，必须先设计版本化兼容迁移并更新 [限流文档](rate-limiting.md)。

## 4. 日志字段白名单

`backend/src/security/safe-logger.ts` 不接受 `Record<string, unknown>`、`Error` 或任意 message，只允许固定字段：

```ts
export interface SafeLogEntry {
  event: LogEvent;
  requestId: string;
  stage: LogStage;
  errorCode?: DomainErrorCode;
  retryAfterSeconds?: number;
}
```

`event`、`stage` 和 `errorCode` 都是封闭联合类型。`requestId` 必须满足 API 的安全格式，等待时间必须是正整数。序列化结果是一行 JSON：

```json
{
  "event": "request_failed",
  "requestId": "request_fixture_1",
  "stage": "api",
  "errorCode": "UPSTREAM_TIMEOUT"
}
```

禁止加入账号、学号、姓名、手机号、密码、验证码、ticket、Cookie、课程、成绩、原始 URL 查询参数、上游 HTML/JSON、异常 message 或 stack。

## 5. 错误日志策略

统一 HTTP 错误层只自动记录 `5xx` 分类错误。普通输入错误、认证失效和 `429` 属于预期控制流，不自动写 error 日志：

```ts
if (domainError.status >= 500) {
  logError({
    event: "request_failed",
    requestId: context.get("requestId"),
    stage: "api",
    errorCode: domainError.code,
  });
}
```

上游服务识别出更具体阶段时可直接使用 `logError()`，但仍只能传白名单字段。成绩达到单页上限使用 `upstream_page_limit_reached`，不记录条目内容或学生标识。

## 6. 验证

```bash
pnpm --filter @gdufs-jwxt/backend typecheck
pnpm --filter @gdufs-jwxt/backend test
```

`backend/tests/security-config.test.ts` 覆盖单密钥与版本、错误长度、非法编码、非法版本和跨用途密钥复用。`backend/tests/safe-logger.test.ts` 覆盖字段白名单、请求 ID、等待时间、5xx 自动日志、429 不记录，以及未知异常文本不进入日志。
