# 统一认证适配

本文档说明统一认证登录页、账号密码提交和 MFA 页面准备阶段的 Worker 实现。事实依据是旧生产后端 `apps/authserver/services.py` 及其测试；不参考旧前端页面或视觉实现。

## 1. 当前实现范围

`backend/src/services/authserver.ts` 当前实现 `beginMfaLogin()`：

```text
GET 统一认证登录页
  -> 解析 pwdEncryptSalt 和 execution
  -> 使用 CAS 兼容 AES-CBC 加密密码
  -> POST 账号密码表单并禁止自动重定向
  -> 验证重定向进入固定 MFA 路径
  -> GET MFA 页面并解析脱敏手机号
  -> 返回脱敏手机号与可序列化上游 Cookie
```

验证码发送、验证码校验、SSO ticket 和教务 Cookie 尚未实现，不得把当前切片描述为完整登录能力。

## 2. 密码加密协议

学校 CAS 协议使用 AES-128-CBC：key 是登录页 `pwdEncryptSalt` 的 16 个 UTF-8 字节；IV 是 16 个安全随机字节；明文是 64 个安全随机字节加用户密码；Web Crypto 自动执行 PKCS#7 padding；提交字段只包含密文的标准 Base64，不包含 IV。

关键实现位于 `backend/src/security/runtime-crypto.ts`：

```ts
const ciphertext = await crypto.subtle.encrypt(
  { name: "AES-CBC", iv },
  key,
  plaintext,
);

return toBase64(ciphertext);
```

IV 不单独提交是上游既有协议行为。64 字节随机前缀使第一块明文随机化；不得将本项目会话 AEAD 设计套用到该兼容步骤，也不得恢复阶段 0 使用过的 `base64url(iv).base64url(ciphertext)` 探针格式。

## 3. 登录表单

账号密码 POST 使用 `application/x-www-form-urlencoded`，字段与旧生产实现一致：

```ts
new URLSearchParams({
  username,
  password: encryptedPassword,
  captcha: "",
  _eventId: "submit",
  cllt: "userNameLogin",
  dllt: "generalLogin",
  lt: "",
  execution,
});
```

该请求使用 `requestManual()`。只有 HTTPS、`authserver.gdufs.edu.cn` 且 path 精确为 `/authserver/reAuthCheck/reAuthLoginView.do` 的 Location 才表示进入 MFA；缺失或其他地址统一映射为 `INVALID_CREDENTIALS`，不记录账号和响应正文。

## 4. 正式上游客户端

`backend/src/upstream/client.ts` 提供正式认证/教务请求基础：每次请求使用 manual redirect；固定超时由 `AbortController` 实施；只允许 HTTPS 学校 host 和固定 path；自动捕获、匹配并携带 Cookie；302/303 从 POST 跳转时切换为 GET 并移除 body；超时映射 `UPSTREAM_TIMEOUT/504`，网络或重定向异常映射 `UPSTREAM_FAILURE/502`。

URL 白名单位于 `backend/src/upstream/constants.ts`：

```ts
if (url.hostname === "authserver.gdufs.edu.cn") {
  return url.pathname.startsWith("/authserver/");
}
return url.pathname === "/sso.jsp" || url.pathname.startsWith("/jsxsd/");
```

客户端不接受浏览器提交的任意上游 URL。业务服务必须引用代码内固定 URL 常量。

## 5. Cookie jar

`backend/src/upstream/cookie-jar.ts` 保存结构化、可序列化 Cookie：名称、值、domain、path、host-only、secure 和可选过期时间。它拒绝响应 host 之外的 `Domain`，实现 domain/path/secure/过期匹配、同键替换和 `Max-Age <= 0` 删除。

Cookie jar 只在当前请求内存或加密 `HttpOnly` 状态 payload 中存在，不得写日志、KV、数据库或 Durable Objects。上游 Cookie 属性不决定本应用 Cookie 属性。

## 6. 页面解析与错误

- `backend/src/parsers/auth-login-page.ts` 使用 `HTMLRewriter` 解析 salt 与 execution。
- `backend/src/parsers/auth-mfa-page.ts` 使用 `HTMLRewriter` 解析 `input#username` 的脱敏手机号。
- 缺失、空值或超长值映射为 `UPSTREAM_CHANGED/502`。
- 页面原文、底层异常和字段值不得进入响应或日志。

密码只在 `beginMfaLogin()` 当前调用栈中存在；服务返回值不包含账号、密码或密文密码。

## 7. 验证

```bash
pnpm --filter @gdufs-jwxt/backend typecheck
pnpm --filter @gdufs-jwxt/backend test
```

`backend/tests/authserver.test.ts` 覆盖确定性 AES-CBC 标准 Base64 向量、请求顺序、表单字段、密码非明文、Cookie 复用、脱敏手机号和错误分类。`backend/tests/upstream-client.test.ts` 覆盖 Cookie scope、过期、非法 Domain、白名单重定向、同 host 非法 path 和 manual redirect。

下一切片应实现 MFA 发送 JSON schema、上游 `codeTime`、验证码校验和 ticket Location 验证，并把 Cookie jar 放入 10 分钟 MFA 加密状态。
