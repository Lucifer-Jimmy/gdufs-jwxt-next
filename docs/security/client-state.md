# 加密客户端状态与请求安全

本文档说明 MFA 临时状态和正式登录状态的客户端 Cookie 封装、安全请求边界与密钥轮换方式。Worker 不保存认证状态副本，Durable Objects 也不得用于会话。

## 1. 状态格式

`backend/src/session/encrypted-state.ts` 使用 Web Crypto AES-256-GCM，密文格式为：

```text
v1.<key-version>.<base64url-iv>.<base64url-ciphertext-and-tag>
```

AEAD additional data 绑定格式版本、状态用途和密钥版本。MFA 与正式登录分别使用 `mfa`、`login` 用途；用途不一致的密文无法解封，避免跨流程重放。

以下关键片段来自 `backend/src/session/encrypted-state.ts`。用途和密钥版本进入 additional data，因此即使密文主体未变，也不能在另一用途或密钥版本下解密：

```ts
function additionalData(
  purpose: StatePurpose,
  keyVersion: string,
): Uint8Array<ArrayBuffer> {
  return encodeUtf8(
    `gdufs-jwxt-state:${FORMAT_VERSION}:${purpose}:${keyVersion}`,
  );
}
```

明文 claims 固定包含：

- `version`、`purpose`；
- `issuedAt`、`lastActivityAt`；
- `expiresAt`、`absoluteExpiresAt`；
- 完成对应上游请求所需的最小 `payload`。

时间使用整数 Unix 秒。解封时先验证 AEAD，再用 Zod 验证 claims 和用途专属 payload。格式错误、未知密钥、密文篡改、用途错配、payload 不匹配或时间线异常统一返回无细节的 `invalid`；到达闲置或绝对期限返回 `expired`。

## 2. 有效期与续期

- MFA 状态默认闲置和绝对有效期均为 10 分钟，不滑动续期。
- 登录状态默认闲置有效期为 2 小时，绝对有效期为 8 小时。
- 只有成功完成已认证 API 请求后，路由层才可调用 `renewLoginState`；新 `expiresAt` 取“当前时间 + 2 小时”和原 `absoluteExpiresAt` 的较早者。
- 静态资源、未认证请求、失败请求和上游认证失效不得续期。

绝对期限由 `Math.min` 强制执行，调用方不能通过连续活动突破首次签发的上限：

```ts
const renewedClaims: SessionClaims<T> = {
  ...claims,
  lastActivityAt: now,
  expiresAt: Math.min(now + idleTtlSeconds, claims.absoluteExpiresAt),
};
```

路由层接入会话后，`invalid` 或 `expired` 都必须清除对应整组 Cookie，并返回统一 `401`，不能把解密失败原因暴露给客户端。

## 3. Cookie 预算

`backend/src/session/cookie-budget.ts` 统一序列化 `Secure; HttpOnly; SameSite=Strict; Path=/api`。完整单条 `Set-Cookie` 必须小于 3,800 UTF-8 字节；MFA 与登录 Cookie 合计目标小于 6 KiB。序列化函数会拒绝超预算值，不能静默截断。

当前结构等价脱敏 fixture 在 Workers 测试运行时内加密后满足预算。若真实上游 Cookie 超限，应先最小化字段，再按 `AGENTS.md` 第 8.1 节设计完整性受保护的固定编号分片；不得转存到 Web Storage、KV、数据库或 Durable Objects。

## 4. 密钥轮换

keyring 最多接收当前和上一版本密钥：

- 签发和续期只使用当前版本；
- 解封可接受当前或上一版本；
- 使用上一版本解封成功时返回 `needsRotation: true`，路由可在成功响应时重新签发；
- 版本必须唯一且只含安全短字符，每把 AES 密钥必须正好 32 字节；
- 轮换窗口结束后删除上一版本 secret。

生产密钥通过 `SESSION_AEAD_KEY_V<n>` Cloudflare secret 注入。解析 secret 到 32 字节 keyring 的配置适配器将在认证路由接入时实现，并必须拒绝缺失、重复版本或错误长度。

## 5. 请求与错误边界

`backend/src/security/request-guards.ts` 提供 JSON content type 和同源检查。认证状态变更路由必须组合使用两者。`backend/src/errors/http-error.ts` 只向客户端返回分类后的领域错误；未知异常固定映射为通用 `500`，不得返回异常文本、堆栈、上游 URL、Cookie 或响应正文。

同源检查优先使用 `Origin`；仅在浏览器未发送 `Origin` 时回退到 `Referer`。关键控制流如下，源码位于 `backend/src/security/request-guards.ts`：

```ts
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
```

安全 header 由 Worker 顶层统一设置，包括 CSP、`Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、`Permissions-Policy` 和 framing 限制。

## 6. 验证

```bash
pnpm --filter @gdufs-jwxt/backend typecheck
pnpm --filter @gdufs-jwxt/backend test
```

会话测试覆盖有效往返、篡改、用途错配、payload 校验、旧密钥轮换、闲置边界、绝对边界和续期上限；Worker 运行时测试同时验证 AES-CBC 上游兼容逻辑、正式 AES-GCM 解封以及 Cookie 字节预算。
