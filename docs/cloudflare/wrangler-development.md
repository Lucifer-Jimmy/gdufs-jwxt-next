# Wrangler 开发、调试与部署

本文档说明 GDUFS JWXT Next 使用 Wrangler 进行 Cloudflare Workers 本地开发、远程调试、预览、部署和凭据清理的流程。命令以仓库当前固定的 Wrangler `4.112.0` 为准，执行目录默认为仓库根目录。

## 1. 安全原则

- 日常交互式开发优先使用 Wrangler OAuth，并启用操作系统 Keychain。不要把 Cloudflare API Token 写入仓库、命令参数、Shell 历史、日志或聊天记录。
- 本地 Worker secrets 只写入任意目录下的 `.dev.vars` 或 `.dev.vars.<environment>`。这些文件已被根目录 `.gitignore` 忽略；仓库只提交空值或虚构值的 `.dev.vars.example`。
- 生产 secrets 只通过 `wrangler secret put` 或 Cloudflare 控制台设置，不得写入 `wrangler.jsonc` 的 `vars`。
- `wrangler dev --remote` 会把代码上传到 Cloudflare 网络执行。只允许上传脱敏 fixture 和开发探针，不得上传真实账号、密码、验证码、Cookie、ticket、成绩或个人信息。
- `wrangler deploy` 会改变 Cloudflare 远程状态。执行前必须确认目标账号、环境、Worker 名称和待部署差异，并先完成 dry-run。
- 调试结束后先停止 `wrangler dev`，再退出认证并验证本机没有其他认证来源。只执行 `wrangler logout` 不一定能清除环境变量提供的 API Token。

## 2. 环境准备

确认本机版本和依赖：

```bash
node --version
pnpm --version
pnpm install
pnpm --filter @gdufs-jwxt/backend exec wrangler --version
```

本项目要求使用根目录锁文件和工作区内安装的 Wrangler，不使用未固定版本的全局 Wrangler 或 `npx wrangler@latest`。

常用的项目级检查：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`backend/src/worker-configuration.d.ts` 由 Wrangler 根据正式配置生成，绑定发生变化后运行：

```bash
cd backend
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler-types.log pnpm exec wrangler types \
  src/worker-configuration.d.ts \
  --env-interface Bindings \
  --include-runtime false
```

CI 或提交前可在相同命令末尾增加 `--check`，验证生成类型与 `wrangler.jsonc` 一致。不要手写 Static Assets 或 Durable Object binding 类型。

## 3. 登录 Cloudflare

### 3.1 推荐方式：OAuth + OS Keychain

执行：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler login --use-keyring
```

Wrangler 会在本地启动一次性 OAuth callback，并打开浏览器。确认浏览器中的 Cloudflare 账号和授权范围后完成授权。不要把浏览器返回的 code、token 或回调 URL 发给其他人。

检查 Keychain 设置与登录状态：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler auth keyring
pnpm --filter @gdufs-jwxt/backend exec wrangler whoami
```

`whoami` 必须显示预期 Cloudflare 账号及 Workers 权限。若账号不正确，应先按第 8 节退出和清理，再重新登录。

在 Wrangler 4.112.0 中，启用 Keychain 后，OAuth 凭据保存为本机加密文件，加密密钥由 OS Keychain 管理。若 Keychain 后端不可用，Wrangler 可能拒绝启用或提示回退；必须阅读命令输出，不能假定凭据已经安全存储。

### 3.2 不推荐方式：`CLOUDFLARE_API_TOKEN`

仅 CI 或无法完成 OAuth 的受控环境使用 API Token。Token 应使用最小权限、限定目标账号，并保存在 CI secret store 中：

```text
CLOUDFLARE_API_TOKEN=<secret>
```

禁止把 Token 写入：

- `.dev.vars.example`、`wrangler.jsonc` 或任何被 Git 跟踪的文件；
- Shell 命令参数、脚本源码、日志或截图；
- 长期共享的 `~/.zshrc`、`~/.bashrc` 等 Shell 启动文件。

环境变量认证的优先级高于本机 OAuth。此时执行 `wrangler logout` 只会提示移除环境变量，不会撤销或删除 API Token。

## 4. 本地开发

先构建前端，再启动本地 Worker：

```bash
pnpm --filter @gdufs-jwxt/frontend build
pnpm --filter @gdufs-jwxt/backend exec wrangler dev --local
```

也可以使用根目录统一命令：

```bash
pnpm dev
```

默认访问地址通常为 `http://localhost:8787`。至少验证：

```bash
curl -i http://localhost:8787/api/v1/health
curl -i http://localhost:8787/api/v1/not-found
```

预期结果：

- `/api/v1/health` 返回 JSON 和 `200`；
- 未知 `/api/*` 返回 JSON 和 `404`，不得回退成前端 HTML；
- API 响应携带请求 ID、安全响应头和 `Cache-Control: no-store, private`；
- 前端路由由 Static Assets 的 SPA fallback 处理。

本地 Durable Objects 数据位于项目的 `.wrangler/` 状态目录，该目录不得提交 Git。本地模拟数据不代表远程 Cloudflare 数据。

## 5. Cloudflare 远程调试

### 5.1 适用范围

Cloudflare 官方已将 `wrangler dev --remote` 标记为 legacy。一般开发优先使用本地运行时和支持的 remote bindings；只有必须验证 Cloudflare 网络行为时才使用完全远程模式。

本项目阶段 0 的学校上游连通性验证需要确认 Cloudflare 出口下的 HTTPS 请求、重定向、编码和 `Set-Cookie` 行为，因此属于合理的完全远程调试场景。

### 5.2 启动前检查

远程上游探针使用独立入口 `backend/src/probe.ts` 和独立配置 `backend/wrangler.probe.jsonc`。它不属于正式 Worker 的 `backend/src/index.ts`，不会被正式 `backend/wrangler.jsonc` 打包。专用配置只包含 `PROBE_ENABLED`，不继承正式 Static Assets 或 Durable Objects bindings。

探针由三部分组成：

- `backend/src/probe.ts`：提供临时 `POST /__probe/upstreams` 入口，检查 `PROBE_ENABLED` 和 Bearer token，并设置请求 ID、禁止缓存和安全响应头。
- `backend/src/services/upstream-probe.ts`：保存固定目标、执行带超时的逐跳请求、维护当前探针请求内的临时 Cookie jar，并生成脱敏摘要。
- `backend/wrangler.probe.jsonc`：只打包探针入口，确保正式 Worker bundle 不包含探针路由。

探针数据流如下：

```text
开发者本机
  -> Wrangler 本地代理
  -> Cloudflare 远程 Worker
  -> 固定学校 HTTPS 白名单
  -> 手动处理响应和重定向
  -> 丢弃正文、Cookie 值和 URL 查询参数
  -> 返回状态、host/path、编码、Cookie 属性和字段存在性摘要
```

固定目标包括统一认证登录页和教务 `sso.jsp`。客户端不能传入目标 URL。每个上游请求设置 10 秒超时，最多处理 5 次重定向；每一跳必须使用 HTTPS，且主机必须属于 `authserver.gdufs.edu.cn` 或 `jwxt.gdufs.edu.cn`。Cookie 只在单次探针请求的内存中用于模拟同一重定向流程，响应结束后不保留。

探针输出只包含：

- HTTP 状态、耗时、最终 host/path 和重定向 host/path；
- `Content-Type`、charset 和 `Content-Encoding`；
- Cookie 名称、value 字节数和 `Domain`、`Path`、`Secure`、`HttpOnly`、`SameSite` 等属性存在性；
- 登录页是否存在 `pwdEncryptSalt` 和 `execution`；
- Cloudflare colo 和不含上游异常文本的网络错误类别。

输出不包含 Cookie 值、完整 `Location`、查询参数、原始 HTML、响应正文或底层异常文本。

先验证专用配置：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler deploy --dry-run \
  --config wrangler.probe.jsonc \
  --outdir dist-probe
```

`PROBE_TOKEN` 必须作为 secret 放在未提交的 `backend/.dev.vars.probe` 中，不得写入 `wrangler.probe.jsonc` 的 `vars`。

1. 确认 `wrangler whoami` 指向预期账号。
2. 确认探针只能访问代码内固定的学校域名白名单，客户端不能提交任意 URL。
3. 确认探针不接收账号、密码或验证码，也不返回 Cookie 值、完整 URL 查询参数、原始 HTML 或响应正文。
4. 将临时探针令牌放入 `backend/.dev.vars.probe`，不要提交该文件。
5. 使用随机高强度值，完成验证后立即作废。
6. 执行 `git status --short --ignored`，确认敏感文件显示在 ignored 区域而不是待提交区域。

启动远程调试：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler dev \
  --remote \
  --config wrangler.probe.jsonc \
  --env-file .dev.vars.probe
```

远程模式下，Worker 代码在 Cloudflare 网络执行，本机地址只负责转发开发请求。不要把该开发地址或探针令牌公开给他人。

结束时按以下顺序操作：

1. 使用 `Ctrl+C` 停止 `wrangler dev --remote`，确认本地代理端口不再响应。
2. 删除或轮换本地 `backend/.dev.vars.probe` 中的临时令牌。
3. 确认正式 Worker 入口和配置没有包含探针路由。
4. 按第 8 节退出 Wrangler，并验证所有认证来源已清理。
5. 删除临时响应文件；如果验证改变了对运行边界的认识，更新本节的稳定结论，不创建单次验证报告。

### 5.3 验收标准与已确认边界

远程连通性验证应至少连续执行三次，并满足：

- 统一认证与教务基础入口均完成 HTTPS 请求并返回可处理的 HTTP 响应；
- 统一认证登录页能通过 HTMLRewriter 检测到 `pwdEncryptSalt` 和 `execution`；
- 响应 charset 可识别，当前基础入口均为 UTF-8 HTML；
- 多个 `Set-Cookie` 可通过 `Headers.getSetCookie()` 分别读取并脱敏；
- 重定向只允许在固定 HTTPS 白名单内逐跳进行，外域跳转必须拒绝；
- 任何输出中都不存在 Cookie 值、完整查询参数或原始响应正文；
- 远程会话停止后本地代理不可访问，临时响应文件已清理；
- 正式 Worker dry-run 产物中不存在 `__probe`、`PROBE_ENABLED` 或 `PROBE_TOKEN`。

当前已确认 Cloudflare Worker 能稳定访问两个学校基础入口，完成运行所需的 DNS 解析和 TLS 握手，读取 UTF-8 HTML 和多个 `Set-Cookie`，并解析统一认证登录字段。两个无凭据基础入口当前直接返回 `200`，没有观察到实际重定向链；远程探针不携带真实凭据，因此不能用它验证登录后的 MFA、SSO ticket 或教务 Cookie 变化。完整认证顺序已经在 `authserver.test.ts`、`jwxt.test.ts` 和 `auth-api.test.ts` 的 Workers 运行时脱敏 mock 中逐跳验证，正式上游适配必须继续遵守 [统一认证适配](../authentication/authserver.md) 的顺序和白名单约束。

Workers 标准 `fetch` 不暴露独立 DNS 查询结果、解析地址、TLS 版本、密码套件或证书链。因此 HTTPS 请求成功只能证明所需 DNS/TLS 路径可用，不能据此记录具体 DNS 或 TLS 细节；请求失败时也未必能可靠区分 DNS 与 TLS 阶段。

上游 Cookie 当前不一定带 `Secure` 或 `SameSite`。这只是学校响应行为，不得继承到本应用 Cookie；本项目签发的 MFA 和正式会话 Cookie 仍必须遵循 `AGENTS.md` 的 AEAD、`Secure`、`HttpOnly`、`SameSite` 和最小 `Path` 要求。

## 6. Secrets 和配置

本地开发使用未提交的：

```text
backend/.dev.vars
backend/.dev.vars.probe
```

生产环境使用交互式命令写入 secret，避免值进入 Shell 历史：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler secret put SESSION_AEAD_KEY
pnpm --filter @gdufs-jwxt/backend exec wrangler secret put SESSION_AEAD_KEY_VERSION
pnpm --filter @gdufs-jwxt/backend exec wrangler secret put RATE_LIMIT_HMAC_KEY_V1
```

查看或删除远程 secret 名称：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler secret list
pnpm --filter @gdufs-jwxt/backend exec wrangler secret delete <SECRET_NAME>
```

`secret list` 只应用于确认名称和环境，不应期望读回 secret 值。key 使用 32 字节随机值的无 padding base64url 编码；会话 AEAD 与限流 HMAC 必须独立，运行时配置解析器会拒绝复用。会话硬轮换时必须在同一次部署中更新 key 与版本，旧 Cookie 立即失效；完整边界见 [安全配置与结构化日志](../security/configuration-and-logging.md)。

修改 `backend/wrangler.jsonc` 的 bindings 或 vars 后，应重新生成或检查 Worker 类型。当前仓库以 `backend/src/worker-configuration.d.ts` 为唯一 binding 类型来源，不得手写平行的 `Env` 或 `Bindings`：

```bash
cd backend
WRANGLER_LOG_PATH=/tmp/gdufs-wrangler-types.log pnpm exec wrangler types \
  src/worker-configuration.d.ts \
  --env-interface Bindings \
  --include-runtime false
```

## 7. 预览检查与部署

### 7.1 不部署的构建检查

```bash
pnpm check
pnpm --filter @gdufs-jwxt/backend exec wrangler deploy --dry-run
```

dry-run 只验证打包和配置，不创建正式部署。检查输出中的 Worker 名称、Static Assets、Durable Object 和其他 bindings 是否符合预期。

### 7.2 部署环境

正式部署前必须在 `backend/wrangler.jsonc` 中定义明确的 staging/production 环境和不同 Worker 名称。当前配置尚未建立完整生产环境，所以不得直接把下面命令视为已获准部署：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler deploy --env staging
pnpm --filter @gdufs-jwxt/backend exec wrangler deploy --env production
```

部署前检查：

1. `git status --short` 中没有凭据、本地配置、真实 fixture 或调试输出。
2. `pnpm check` 全部通过。
3. `wrangler deploy --dry-run --env <environment>` 通过。
4. `wrangler whoami` 显示正确账号。
5. 目标环境名称、Worker 名称、bindings、migrations 和 secrets 已人工核对。
6. 远程探针、调试开关和临时令牌未进入生产配置。
7. 部署属于当前任务明确授权的操作。

部署后使用独立终端查看脱敏实时日志：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler tail --env <environment>
```

日志中不得输出账号、密码、验证码、ticket、Cookie、个人信息、成绩或完整上游响应。

## 8. 安全退出与清空登录凭据

### 8.1 日常 OAuth 退出

先停止所有正在运行的 `wrangler dev`、`tail` 和部署命令，然后执行：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler logout
```

Wrangler OAuth 登录时，该命令会请求撤销 refresh token，并清除默认 profile 的本机凭据。随后验证：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler whoami --json
```

未认证时命令应以非零状态退出。若仍显示账号，继续执行下面的完整清理，不要认为已经退出。

### 8.2 清理环境变量认证

当前 Shell 中至少清理：

```bash
unset CLOUDFLARE_API_TOKEN
unset CLOUDFLARE_API_KEY
unset CLOUDFLARE_EMAIL
unset CF_API_TOKEN
unset CF_API_KEY
unset CF_API_EMAIL
```

如果 Token 来自 IDE、终端配置、密码管理器注入、CI secret 或 Shell 启动文件，也必须从来源处删除并重启对应终端/IDE。检查配置文件时只搜索变量名，不要把包含真实值的整行打印到日志或聊天中。

仅 `unset` 会停止本机继续使用 API Token，但不会让已泄露或仍有效的 Token 在 Cloudflare 端失效。对于不再使用、疑似泄露或权限过大的 Token，必须进入 Cloudflare Dashboard 的 API Tokens 页面执行 Roll/Revoke/Delete，然后从所有 CI 和密码管理器中删除旧值。

### 8.3 清理命名 profile

Wrangler 4.112.0 的 `logout` 只处理默认 profile。检查并删除命名 profile：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler auth list
pnpm --filter @gdufs-jwxt/backend exec wrangler auth deactivate
pnpm --filter @gdufs-jwxt/backend exec wrangler auth delete <PROFILE_NAME>
```

对每个不再需要的 profile 执行 `auth delete`。命名 profile 功能当前标记为 experimental，升级 Wrangler 后应重新检查命令帮助。

### 8.4 Keychain 和本地凭据文件的应急清理

正常情况下优先使用 `wrangler logout` 和 `wrangler auth delete`，让 Wrangler 同时处理远程撤销和本地清理。只有命令失败、Keychain 后端不可达或凭据残留时，才执行应急清理。

先查看 Keychain 状态：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler auth keyring
```

下面的命令会禁用 Keychain 偏好，并尝试清理所有加密 profile 的凭据；它不是日常退出命令：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler auth keyring disable
```

在 macOS 上，如果 Wrangler 明确警告 Keychain 条目未清除，可打开“钥匙串访问”，搜索服务名 `wrangler`，核对后只删除 Wrangler 对应条目。不要删除整个登录钥匙串或其他 Cloudflare 应用的凭据。

Wrangler 的凭据目录取决于平台、`XDG_CONFIG_HOME` 和历史版本。在本项目使用的 macOS 环境中，常见位置包括：

```text
~/Library/Preferences/.wrangler/
~/.wrangler/                 # 仅旧目录存在时可能继续使用
```

可能包含认证状态的路径通常位于上述目录的 `config/`、`profiles/` 或旧版用户配置文件中。手动操作前必须先退出 Wrangler、备份非敏感配置清单并确认精确文件；只删除已确认属于 Wrangler OAuth/profile 的凭据文件。禁止对 `~`、`~/Library`、整个 Keychain 或不明确目录执行递归删除。

项目目录中的 `.wrangler/` 是构建和本地状态目录，不等同于全局 OAuth 凭据目录。清理项目状态不会替代 `wrangler logout`，删除全局凭据也不会自动删除项目的本地 Durable Object 数据。

### 8.5 完整退出验收

以下条件全部满足才算安全退出：

- 所有 `wrangler dev`、`tail` 和部署进程已停止；
- 默认 OAuth profile 已执行 `wrangler logout`；
- 不需要的命名 profile 已删除，目录绑定已停用；
- 当前 Shell、IDE、CI 和启动文件不再注入 Cloudflare API Token；
- 不再使用的 API Token 已在 Cloudflare Dashboard 撤销或删除；
- Wrangler 未报告无法清理的 Keychain 条目；
- `wrangler whoami --json` 在无环境变量的全新终端中返回未认证；
- 本地 `.dev.vars*`、调试日志和临时令牌已删除或确认仍有明确用途；
- `git status --short --ignored` 确认敏感文件没有进入待提交或暂存区域。

## 9. 常见问题

### `wrangler logout` 后仍然是登录状态

通常是 `CLOUDFLARE_API_TOKEN` 或旧版 `CF_API_TOKEN` 仍在环境中，或者当前目录绑定了命名 profile。依次检查环境变量来源、`wrangler auth list` 和 `wrangler auth deactivate`。

### 登录时 callback 端口被占用

默认 callback 端口为 `8976`。可以指定另一个仅绑定本机的端口：

```bash
pnpm --filter @gdufs-jwxt/backend exec wrangler login --use-keyring --callback-port 8977
```

### Keychain 无法使用

不要忽略 Wrangler 的回退警告。优先修复 OS Keychain 后端，再重新执行 `wrangler login --use-keyring`。临时使用文件凭据会降低本地静态凭据的保护级别，使用后必须执行退出和残留检查。

### 远程调试无法访问学校上游

记录脱敏的错误类别、请求耗时、目标主机和请求 ID。不要记录响应正文、Cookie 或完整重定向 URL。Cloudflare Worker `fetch` 失败通常不能可靠区分 DNS 和 TLS 的具体失败阶段，因此文档结论只能写“Cloudflare HTTPS 请求成功/失败”，不能虚构证书链或 DNS 诊断细节。

## 10. 官方资料

- [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Wrangler system environment variables](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
- [Workers local development](https://developers.cloudflare.com/workers/local-development/)
- [Cloudflare API Tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)

最后核对日期：2026-07-18。升级 Wrangler、修改环境配置或改变部署方式时，必须同步复核并更新本文档。
