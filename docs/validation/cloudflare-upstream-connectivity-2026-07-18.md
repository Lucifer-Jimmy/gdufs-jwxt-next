# Cloudflare 上游连通性验证记录（2026-07-18）

## 1. 目的与范围

验证 GDUFS JWXT Next 的 Cloudflare Workers 运行环境能否从 Cloudflare 出口访问学校统一认证和教务系统基础入口，并确认无凭据请求下的 HTTPS、重定向、响应编码和 `Set-Cookie` 行为。

本次不使用真实账号、密码、验证码、ticket、教务 Cookie、个人信息或成绩。结论仅覆盖阶段 0 的基础连通性，不代表登录后的 MFA、SSO ticket 交换和教务会话链已经完成验证；这些行为属于阶段 2 的认证迁移与脱敏契约测试范围。

## 2. 验证环境

- 日期：2026-07-18
- 执行方式：Wrangler `4.112.0`，`wrangler dev --remote`
- Worker 入口：`backend/src/probe.ts`
- Wrangler 配置：`backend/wrangler.probe.jsonc`
- Cloudflare colo：`NRT`
- 连续执行次数：3
- 上游白名单：`authserver.gdufs.edu.cn`、`jwxt.gdufs.edu.cn`
- 请求超时：每跳 10 秒
- 最大重定向：5 跳

探针只接受固定目标，不允许客户端提交 URL。所有重定向逐跳使用 `redirect: "manual"` 处理，只允许 HTTPS 和上述白名单主机。探针响应不包含 Cookie 值、完整 `Location` 查询参数、原始 HTML 或响应正文。

## 3. 验证目标

### 统一认证登录页

目标：

```text
https://authserver.gdufs.edu.cn/authserver/login
```

请求携带固定的教务 `service` 参数，但验证记录不保存完整查询字符串。

三次结果一致：

- HTTPS 请求成功，HTTP 状态为 `200`。
- 最终主机为 `authserver.gdufs.edu.cn`，路径为 `/authserver/login`。
- `Content-Type` 为 `text/html;charset=UTF-8`，解析到 charset `utf-8`。
- 响应未暴露 `Content-Encoding` header。
- 无凭据入口本次没有发生 HTTP 重定向。
- HTMLRewriter 成功检测到 `pwdEncryptSalt` 与 `execution`。
- 可读取两个 `Set-Cookie`：`route`、`JSESSIONID`。
- `JSESSIONID` 带 `HttpOnly`；本次两个 Cookie 均未观察到 `Secure` 或 `SameSite` 属性。
- 首次请求耗时约 2571 ms，后续两次约 369 ms 和 368 ms。

### 教务 SSO 入口

目标：

```text
https://jwxt.gdufs.edu.cn/sso.jsp
```

三次结果一致：

- HTTPS 请求成功，HTTP 状态为 `200`。
- 最终主机为 `jwxt.gdufs.edu.cn`，路径为 `/sso.jsp`。
- `Content-Type` 为 `text/html;charset=UTF-8`，解析到 charset `utf-8`。
- 响应未暴露 `Content-Encoding` header。
- 无 ticket 的入口本次没有发生 HTTP 重定向。
- 可读取两个 `Set-Cookie`：`bzb_njw`、`SERVERID_gld`。
- `bzb_njw` 带 `HttpOnly`；本次两个 Cookie 均未观察到 `Secure` 或 `SameSite` 属性。
- 三次请求耗时约 1872 ms、1065 ms 和 121 ms。

## 4. DNS 与 TLS 结论边界

Cloudflare Worker 的标准 `fetch` 没有提供独立的 DNS 查询详情、解析地址、TLS 版本、密码套件或证书链。本次两个 HTTPS 请求都从 Cloudflare colo 成功获得上游 HTTP 响应，因此可以确认 Cloudflare 运行环境能够完成访问这些主机所需的 DNS 解析和 TLS 握手。

不能仅凭本探针声明具体 DNS 解析结果、TLS 协议版本或证书链细节。后续若 `fetch` 失败，Worker 通常也只能报告网络请求失败，未必能可靠区分 DNS 与 TLS 阶段。

## 5. 重定向结论

两个无凭据基础入口在三次远程执行中都直接返回 `200`，因此没有观察到实际重定向链。探针已实现：

- `redirect: "manual"`；
- 最多 5 跳；
- 仅允许 HTTPS；
- 仅允许两个学校白名单主机；
- 结果只记录目标 host 和 path，不记录查询字符串；
- 非白名单重定向立即拒绝。

外域重定向拒绝和查询参数脱敏已由自动化测试覆盖。登录后的 SSO ticket 重定向链尚未执行真实账号验证，后续必须继续使用固定白名单和脱敏 fixture 验证。

## 6. `Set-Cookie` 结论

Cloudflare Worker 可通过 `Headers.getSetCookie()` 分别读取上游多个 `Set-Cookie`。本次记录仅保存 Cookie 名称、属性存在性和 value 字节数，不保存值。

观察到的四个 Cookie 都可正常读取。部分 Cookie 没有 `Secure` 或 `SameSite`，这是学校上游响应的当前行为；本应用不得照搬该安全属性。本项目签发的 MFA 和正式登录 Cookie 仍必须遵守 `AGENTS.md` 定义的 `Secure`、`HttpOnly`、`SameSite`、最小 `Path` 和 AEAD 保护要求。

## 7. 安全与清理

- 探针使用独立 Worker 入口和独立 Wrangler 配置，不属于正式 Worker bundle。
- 探针通过临时 Bearer token 保护，token 来自被 `.gitignore` 忽略的 `.dev.vars.probe`。
- Wrangler 命令和输出没有打印 token。
- 三次验证完成后已停止远程开发会话，并确认本地代理端口不再响应。
- `/tmp` 下的探针响应文件已删除。
- 文档中没有记录 Cookie 值、账号、个人信息或完整上游响应。

本地 `.dev.vars.probe` 的 secret 应在不再需要复测时由开发者删除或轮换。Cloudflare OAuth 登录状态按 `docs/cloudflare/wrangler-development.md` 管理，不因停止远程调试自动退出。

## 8. 验收结论

阶段 0 的 Cloudflare 远程上游基础连通性门槛通过：

- Cloudflare 出口可以稳定访问统一认证与教务基础入口；
- HTTPS 请求能够完成，可推断运行所需 DNS 与 TLS 路径可用；
- UTF-8 HTML 响应和登录页关键字段可解析；
- 多个 `Set-Cookie` 可分别读取并进行脱敏处理；
- 重定向处理具备固定白名单和逐跳拒绝机制；
- 无凭据探针未发现阻断后续阶段 1 与阶段 2 开发的问题。

剩余工作不是阶段 0 阻塞项：阶段 1 继续实现正式安全基础；阶段 2 使用脱敏 fixture 和明确授权的认证流程验证 MFA、ticket、登录后 Cookie 变化及教务页面解析。
