# 统一认证适配

本文档说明统一认证、MFA、SSO ticket 和教务系统登录的 Worker 实现。事实依据是旧生产后端 `apps/authserver/services.py`、`apps/jwxt/services.py`、`apps/accounts/session.py` 及其测试；不参考旧前端页面或视觉实现。

## 1. 当前实现范围

阶段 2 已实现完整的生产认证顺序，入口分别位于 `backend/src/services/authserver.ts`、`backend/src/services/jwxt.ts` 和 `backend/src/routes/api.ts`。认证请求不得合并、跳过或交给自动重定向处理：

```text
GET CAS 登录页
  -> 解析 pwdEncryptSalt 和 execution
  -> 使用 CAS 兼容 AES-CBC 加密密码
  -> POST 账号密码表单，禁止自动重定向
  -> 验证 Location 进入固定 MFA 路径
  -> GET MFA 页面并解析脱敏手机号
  -> 创建 10 分钟 MFA 加密 Cookie

POST 发送 MFA 验证码
  -> 从 MFA Cookie 恢复 authserver Cookie
  -> POST 发送验证码
  -> 解析 res、returnMessage 和 codeTime
  -> 保存更新后的 authserver Cookie，并在原有效期内重封装 MFA Cookie

POST 校验 MFA 验证码
  -> 从 MFA Cookie 恢复最新 authserver Cookie
  -> POST 校验验证码
  -> 再次 GET CAS 登录 URL 获取 ticket
  -> 使用全新的 JWXT Cookie jar GET ticket URL
  -> GET /sso.jsp
  -> 校验 Location 中的 ticket1 和固定登录处理路径
  -> GET ticket1 URL，确认得到 JWXT Cookie
  -> GET 个人信息页确认教务登录有效
  -> 清除 MFA Cookie，签发正式登录 Cookie
```

成功后的 `GET /api/v1/me`、`GET /api/v1/grades`、`POST /api/v1/grades/refresh` 和 `POST /api/v1/grades/detail` 都实时访问教务系统，并且只有上游请求成功时才续期正式登录 Cookie。成绩列表字段映射已使用结构等价的真实响应逐字段核验；未确认的上游附加字段不会进入公开 API。

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

## 4. MFA 发送、校验和 ticket

`sendMfaCode()` 使用旧项目的表单字段向固定发送地址发起 POST，并对 JSON 响应进行 schema 校验。`res` 是必需的 JSON 成功标志；旧生产实现使用 Python 真值判断，因此新实现保持同一语义，不擅自收窄为布尔类型。`returnMessage` 与 `codeTime` 是非关键可选字段，分别安全归一化为提示文案和至少 1 秒的本地等待时间，无效或缺失时回退为“验证码已发送”和 60 秒。非 JSON、缺少 `res` 或假值 `res` 分别映射为上游结构变化或发送失败，不返回上游正文。

`verifyMfaCode()` 使用旧项目的 `service`、`reAuthType`、`isMultifactor`、`dynamicCode` 等字段发起 POST。只有 `code: "reAuth_success"` 才继续；其他结果统一映射为 `INVALID_MFA_CODE`。成功后必须在同一个 authserver Cookie jar 中单独再次 GET CAS 登录 URL，由 manual redirect 的 `Location` 解析并校验 JWXT `/sso.jsp?ticket=...`。

`getTicketToLogin()` 只接受 HTTPS、`jwxt.gdufs.edu.cn`、精确 `/sso.jsp` 路径和非空 `ticket` 查询参数。它不接受客户端传入 URL，也不允许跨域或路径变形。

`fetchCookiesByTicket()` 会创建全新的 `UpstreamClient`，因此 authserver Cookie 不会被带到 JWXT：

1. GET `https://jwxt.gdufs.edu.cn/sso.jsp?ticket=...`，保存响应 Cookie。ticket 仅校验存在性及固定 HTTPS 主机和路径，不附加旧生产实现没有的长度假设。
2. GET `https://jwxt.gdufs.edu.cn/sso.jsp`，manual redirect 后解析同源的 `ticket1`；ticket1 同样不附加无上游证据的长度假设。
3. 只接受 Location 指向 `https://jwxt.gdufs.edu.cn/jsxsd/xk/LoginToXk?ticket1=...`，GET 后保存最终教务 Cookie。该路径已由真实登录流程验证；根入口 `/sso.jsp` 只用于前两次 ticket 交换，不是 ticket1 落点。包括 `/jsxsd/sso.jsp` 在内的其他路径即使携带 `ticket1` 也拒绝。

三次请求必须逐次执行。缺少任一可信 Location、ticket 参数或最终 JWXT Cookie 时，认证不能成功。随后 `getPersonalInfo()` 请求固定个人信息页；页面被识别为登录页时映射为 `SESSION_EXPIRED`，缺少预期字段时映射为 `UPSTREAM_CHANGED`。

## 5. 正式上游客户端

`backend/src/upstream/client.ts` 提供正式认证/教务请求基础：每次请求使用 manual redirect；固定超时由 `AbortController` 实施；只允许 HTTPS 学校 host 和固定 path；自动捕获、匹配并携带 Cookie；302/303 从 POST 跳转时切换为 GET 并移除 body；超时映射 `UPSTREAM_TIMEOUT/504`，网络或重定向异常映射 `UPSTREAM_FAILURE/502`。

URL 白名单位于 `backend/src/upstream/constants.ts`：

```ts
if (url.hostname === "authserver.gdufs.edu.cn") {
  return url.pathname.startsWith("/authserver/");
}
return (
  url.pathname === "/sso.jsp" ||
  url.pathname === "/jsxsd/xk/LoginToXk" ||
  url.pathname === "/jsxsd/framework/xsMainV_new.htmlx" ||
  url.pathname === "/jsxsd/kscj/cjcx_list" ||
  url.pathname === "/jsxsd/kscj/pscj_list.do"
);
```

客户端不接受浏览器提交的任意上游 URL。业务服务必须引用代码内固定 URL 常量。

## 6. Cookie jar

`backend/src/upstream/cookie-jar.ts` 保存结构化、可序列化 Cookie：名称、值、domain、path、host-only、secure 和可选过期时间。它拒绝响应 host 之外的 `Domain`，实现 domain/path/secure/过期匹配、同键替换和 `Max-Age <= 0` 删除。

Cookie jar 只在当前请求内存或加密 `HttpOnly` 状态 payload 中存在，不得写日志、KV、数据库或 Durable Objects。登录页开始阶段的 authserver Cookie 会进入 MFA Cookie，以便跨越验证码发送和校验请求恢复；MFA 成功后只把 JWXT Cookie 写入正式 Cookie。上游 Cookie 属性不决定本应用 Cookie 属性。

## 7. 页面解析与错误

- `backend/src/parsers/auth-login-page.ts` 使用 `HTMLRewriter` 解析 salt 与 execution。
- `backend/src/parsers/auth-mfa-page.ts` 使用 `HTMLRewriter` 解析 `input#username` 的脱敏手机号。
- 缺失、空值或超长值映射为 `UPSTREAM_CHANGED/502`。
- 页面原文、底层异常和字段值不得进入响应或日志。

密码只在 `beginMfaLogin()` 当前调用栈中存在；服务返回值不包含账号、密码或密文密码。

## 8. API 与会话转换

认证 API 的 HTTP 适配位于 `backend/src/routes/api.ts`：

- `POST /api/v1/auth/login` 校验账号密码、执行登录限流并签发 MFA 临时 Cookie。
- `GET /api/v1/auth/mfa` 读取 MFA 状态，返回脱敏手机号、发送状态和剩余有效期。
- `POST /api/v1/auth/mfa/send` 执行本地限流、学校 `codeTime` 冷却和上游发送，并保存更新后的 authserver Cookie。
- `POST /api/v1/auth/mfa/verify` 执行 MFA 尝试限流、ticket 三跳和个人信息验证，成功后立即清除 MFA Cookie 并签发正式 Cookie。
- `POST /api/v1/auth/logout` 幂等清除两组状态 Cookie。
- `GET /api/v1/me` 实时查询个人信息，成功后才续期正式 Cookie。

账号、密码、验证码、ticket、完整上游 Cookie 和个人信息不会进入错误消息或日志。认证失败、上游过期和状态 Cookie 解封失败都使用统一领域错误映射。

## 9. 验证

```bash
pnpm --filter @gdufs-jwxt/backend typecheck
pnpm --filter @gdufs-jwxt/backend test
```

`backend/tests/authserver.test.ts` 覆盖确定性 AES-CBC 标准 Base64 向量、登录表单、MFA JSON 结果、Cookie 链和认证错误分类。`backend/tests/jwxt.test.ts` 覆盖 ticket、`/sso.jsp`、ticket1、JWXT Cookie 和个人信息页面边界。`backend/tests/auth-api.test.ts` 通过真实 Worker 请求验证完整请求顺序、authserver/JWXT Cookie 域隔离、MFA 到正式会话转换、`/me` 成功续期和第五次 MFA 无效校验清理临时 Cookie。`backend/tests/upstream-client.test.ts` 覆盖 Cookie scope、过期、非法 Domain、白名单重定向、同 host 非法 path、manual redirect 和同名 Cookie 原位更新。
