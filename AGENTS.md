# GDUFS JWXT Next 开发指南

本文档是仓库开发的最高层约束。实现前必须阅读；需求、架构、上游协议、接口或部署边界变化时，必须在同一变更中更新本文档和相关 `docs/`。

> 仅在实际修改或审查前端界面、交互、样式、响应式、可访问性或视觉表现时使用 `impeccable` skill。文档、后端、API、安全、部署、上游适配和纯工程任务不得加载。

## 1. 产品与范围

- 面向广东外语外贸大学学生，默认语言为简体中文。
- 产品在学校统一认证和教务系统之上提供只读查询与学业分析，不代表学校，也不替代官方成绩单。
- 首版包括：账号密码登录、短信 MFA、SSO、个人信息、全量成绩、单科详情、学业概览、GPA/学分、学期趋势、筛选、毕业与通识进度、浏览器端 Excel/CSV 导出。
- 不提供选课、评教、考试安排修改或其他会改变学校数据的功能。
- 正确处理认证过期、限流、上游超时、非预期响应、页面结构变化和解析失败。

## 2. 不可变架构

- 所有业务源码使用严格 TypeScript；前端为 React + Vite，后端为 Hono + Cloudflare Workers。
- 根目录保持 `frontend/` 与 `backend/` 分离。共享契约使用无运行时副作用的 workspace 包或生成类型；前端不得导入后端实现。
- 使用 `pnpm` workspace，只提交根目录 `pnpm-lock.yaml`。Node.js 版本在仓库中固定并与 CI、Cloudflare 构建一致。
- 生产环境为单 Worker 同源部署：Hono 处理 `/api/*`，Workers Static Assets 提供前端；前端只调用相对路径。
- 后端仅使用 Workers 支持的 Web API，不依赖 Node.js 专属 API、原生扩展、本地文件系统、常驻进程或进程内 Session。
- 构建与部署必须排除 `gdufs-jwxt-next-origin/`。

目录职责：

```text
frontend/src/components/   通用组件与 shadcn/ui
frontend/src/features/     业务功能
frontend/src/routes/       路由入口
frontend/src/lib/          API、计算与工具
frontend/tests/            前端测试
backend/src/routes/        HTTP 适配
backend/src/services/      上游业务服务
backend/src/parsers/       上游响应解析
backend/src/session/       加密客户端状态
backend/src/schemas/       运行时 schema
backend/src/errors/        领域错误与 HTTP 映射
backend/src/security/      加密、脱敏与安全响应头
backend/tests/             后端测试
docs/                      长期实现与运维文档
```

## 3. 上游迁移规则

- 登录、MFA、SSO、个人信息、成绩和详情以 `gdufs-jwxt-next-origin/` 的生产实现与测试为事实依据，重点参考：
  - `apps/authserver/services.py`
  - `apps/jwxt/services.py`
  - `apps/accounts/session.py`
  - `apps/accounts/views.py`、`apps/jwxt/views.py`
  - `tests/`
- 不得使用旧项目的 `PRODUCT.md`、`DESIGN.md`、`prototypes/`、模板、CSS、JS、品牌、信息架构或视觉实现设计新前端。
- 迁移前先确认请求顺序、字段、Cookie 变化、重定向、解析规则和错误语义；不得逐行翻译 Python。
- 上游参数、字段和值必须由生产实现和结构等价的脱敏真实 fixture 证明。不得猜测别名、默认值、转换或语义；未确认字段保持未映射或停止接入。
- HTML 使用 Workers 兼容的结构化解析器，不以正则解析一般 HTML。嵌入脚本中的固定片段须隔离解析并测试。
- 后端请求仅允许白名单学校域名；重定向逐步验证协议、主机和路径，绝不接受客户端提供任意上游 URL。

## 4. 数据、会话与隐私

- 不持久化用户业务数据、认证状态或上游响应。禁止使用 D1、KV、R2、Queues、数据库、外部存储或 Durable Objects 保存这些内容。
- 唯一持久化例外是第 7 节定义的匿名限流元数据。
- 密码、验证码、ticket、完整 Cookie、个人信息和成绩不得进入日志、分析、错误上下文、缓存或测试 fixture；fixture 必须彻底脱敏。
- 请求期间可在内存中短暂持有必要数据；个人信息、成绩和派生数据仅保留在当前页面内存。禁止使用 `localStorage`、`sessionStorage`、IndexedDB 或 Cache API。
- MFA 和正式登录状态分别封装为用途绑定、加密且完整性受保护的 `Secure`、`HttpOnly` Cookie，Worker 不保存副本。应用会话使用 Web Crypto AEAD；AES-CBC 仅用于兼容上游密码协议。
- MFA 状态有效期 10 分钟，不滑动续期。正式登录状态无操作 2 小时过期、首次签发后最多 8 小时；仅成功的已认证 API 请求可滑动续期，且不得超过上游或绝对过期时间。
- 完成 MFA 立即清除临时 Cookie；退出、认证失效、状态损坏或上游 Cookie 过期时清除对应整组 Cookie。
- Cookie 载荷只保留恢复上游会话的最小字段，包含版本、签发时间、最后活动时间、绝对过期时间和用途。单个完整 `Set-Cookie` 小于 3,800 字节，应用 Cookie 请求头总量目标小于 6 KiB。
- 超限时先精简字段，再按固定编号拆分少量 Cookie；不得改用服务端或浏览器存储。分片缺失、乱序、版本不符或解密失败时清除整组，不做部分恢复。
- 会话 AEAD 密钥与限流 HMAC 密钥必须独立，仅通过 Cloudflare Secrets 注入。本地凭据放在被忽略的 `.dev.vars*`；只允许提交无真实值的示例。
- 会话仅保留一把有效密钥及独立版本号；轮换为硬切换，旧 Cookie 立即失效，回滚不得恢复已作废密钥。
- `/health` 之外响应使用 `Cache-Control: no-store, private`。不得加载接触个人数据的第三方分析、广告或会话回放脚本。

## 5. 认证与教务协议

认证顺序必须保持：

1. 请求统一认证登录页，解析 `pwdEncryptSalt` 与 `execution`。
2. 按上游 AES-CBC 规则加密密码并提交账号密码。
3. 确认进入 MFA 流程，获取脱敏手机号与临时认证 Cookie。
4. 发送验证码并遵守上游 `codeTime`。
5. 校验验证码，获取 SSO ticket。
6. 使用 ticket 换取教务 Cookie，并立即调用个人信息接口验证登录有效。
7. 返回最小化的加密客户端登录状态。

ticket1 的 Location 只接受 HTTPS `jwxt.gdufs.edu.cn` 上已由真实登录验证的 `/jsxsd/xk/LoginToXk`，并要求非空 `ticket1`；不得放宽为 `/jsxsd/*` 或接受其他候选路径。

教务查询要求：

- 每次直接请求上游，不保存结果。
- 全量成绩单页上限集中配置为 `300`；达到上限时记录不含个人数据的告警。
- 成绩详情四个标识必须来自同一成绩记录，并校验存在性、长度和格式。
- 区分上游 Cookie 过期、非 JSON/登录页 HTML、字段缺失和页面结构变化。
- 后端只做协议适配和明确的数据映射；GPA、统计、筛选、排序、趋势和导出由前端基于当前响应完成。

## 6. API 契约

首版固定使用 `/api/v1`。破坏性变更发布新版本，不得在原路径静默改变语义。

| 方法   | 路径                      | 用途与认证                              |
| ------ | ------------------------- | --------------------------------------- |
| `GET`  | `/api/v1/health`          | 健康检查，无认证，不访问上游            |
| `POST` | `/api/v1/auth/login`      | 账号密码登录，无认证，严格限流          |
| `GET`  | `/api/v1/auth/mfa`        | MFA 状态，临时 Cookie                   |
| `POST` | `/api/v1/auth/mfa/send`   | 发送验证码，临时 Cookie，严格限流       |
| `POST` | `/api/v1/auth/mfa/verify` | 校验验证码并登录，临时 Cookie，严格限流 |
| `POST` | `/api/v1/auth/logout`     | 幂等清除登录状态                        |
| `GET`  | `/api/v1/me`              | 实时个人信息，正式 Cookie               |
| `GET`  | `/api/v1/grades`          | 实时全量成绩，正式 Cookie               |
| `POST` | `/api/v1/grades/refresh`  | 手动刷新，正式 Cookie，账号级 30 秒限流 |
| `POST` | `/api/v1/grades/detail`   | 实时成绩详情，正式 Cookie               |

- 请求、响应和上游数据均须显式 TypeScript 类型与 Zod schema；前端必须运行时校验响应。
- 成功响应直接返回有名资源。错误固定为 `{ "error": { "code": string, "message": string, "requestId": string, "retryAfterSeconds"?: number } }`。
- 输入错误、未认证、限流、上游失败和超时分别使用 `400`、`401`、`429`、`502`、`504`。所有 `429` 同时返回 `Retry-After`。
- 不返回原始 HTML、堆栈、内部 URL、Cookie 或上游异常文本。所有响应携带不含敏感信息的请求 ID。
- 改变认证状态的 `POST` 必须要求 `application/json` 并校验同源 `Origin`/`Referer`；默认不启用 CORS。
- 成绩详情使用 JSON body，避免内部标识进入 URL、历史或代理日志。

## 7. 严格限流

- 使用 SQLite-backed Durable Objects，仅保存 `subject_hash`、`action`、窗口/最后请求时间、计数和过期时间，最长保留 24 小时。
- 使用服务端 HMAC 生成不可逆主体摘要，并按版本化算法映射到 16 个固定分片。不同主体按 `subject_hash + action` 独立计数。
- 检查和登记在同一 Durable Object 内原子完成；慢速上游请求必须在返回 Worker 后执行。
- 被 Worker 接受的尝试立即计数，上游失败不返还额度。限流状态不可用时默认拒绝受保护动作。
- 任一账号或 IP 维度触发即拒绝。成功登录仅清理该账号连续失败计数，不清理 IP 窗口。

| 动作         | 主体         | 限制                        | 保留         |
| ------------ | ------------ | --------------------------- | ------------ |
| 登录提交     | 账号 HMAC    | 10 分钟 5 次                | 10 分钟      |
| 登录提交     | IP HMAC      | 10 分钟 30 次               | 10 分钟      |
| MFA 发送     | 账号 HMAC    | 10 分钟 3 次；24 小时 10 次 | 最长 24 小时 |
| MFA 发送     | IP HMAC      | 10 分钟 20 次               | 10 分钟      |
| MFA 校验失败 | 流程 ID HMAC | 每流程 5 次                 | MFA 状态过期 |
| 成绩手动刷新 | 账号 HMAC    | 30 秒 1 次                  | 30 秒        |

MFA 发送同时遵守本地限制与上游 `codeTime`，取更严格者；校验失败达到 5 次时清除 MFA Cookie。分片数、映射算法、阈值和保留期不得擅自修改，扩容需兼容迁移方案。

## 8. 前端基线

- shadcn/ui + Tailwind CSS 是主要 UI 体系；优先组合和扩展 shadcn/ui token、variant 与组件源码，不引入重叠的综合 UI 库。图标优先 Lucide。
- React Router 管理路由；TanStack Query 仅使用内存缓存；Recharts 用于图表；SheetJS 用于 Excel；CSV 使用项目内纯函数。
- 产品是查询工具，不做营销落地页。首屏直接提供登录或应用界面；新设计只依据本项目 `PRODUCT.md` 与 `DESIGN.md`。
- UI 使用克制的 OKLCH token、清晰层级、固定字号和等宽数字。卡片仅用于独立内容且圆角不超过 8px；禁止嵌套卡片、玻璃拟态、装饰网格、光球、渐变文字和模板化大卡片阵列。
- 所有交互覆盖默认、hover、focus-visible、active、disabled、loading 和 error；加载使用稳定布局的 Skeleton；错误保留上下文与恢复操作。
- 动效仅解释状态变化，通常 `150–250ms` ease-out，并支持 `prefers-reduced-motion`。
- 支持键盘、正确语义/标签/焦点、WCAG 2.1 AA、图表等价文本或表格，以及手机与桌面的结构化响应式布局。不得出现文字溢出、遮挡或无意义布局位移。
- 支持最新版及前两个主要版本的 Chrome、Edge、Firefox、Safari，以及受支持的 iOS Safari 与 Android Chrome。微信内置浏览器尽力兼容，不得为兼容降低安全要求。

### 专业学分规则

- 规则是随前端发布的版本化只读静态表，不使用运行时存储。
- 每条规则包含稳定 ID、标准化专业匹配值、版本、生效范围、毕业总学分、通识要求、课程分类条件、来源和核对日期，并预留年级/培养方案维度。
- 默认同专业跨年级使用同一方案；仅凭学校资料或用户明确确认细分。名称可做明确、可测试的规范化和别名映射，不做模糊匹配。
- 未配置、冲突、字段缺失或版本不确定时停止显示毕业/通识比例，提示“该专业规则暂未配置或无法准确匹配”；仍可显示 GPA 和已修学分。不得使用全校默认值、相近专业或旧前端结果。
- 规则变更必须记录版本和覆盖范围，并测试匹配、边界学分、分类及安全降级。

## 9. 工程与测试

- 前后端分别启用严格 `tsconfig`，优先开启 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes`。边界先校验后收窄，禁止无说明的 `any`、断言和非空断言。
- 路由负责 HTTP 适配，服务负责协议与领域行为。解析、加密、脱敏、错误映射和计算应可独立测试；领域错误不得依赖字符串匹配控制流程。
- 单元与集成测试使用 Vitest，组件测试使用 Testing Library，端到端与视觉测试使用 Playwright。新增依赖须说明用途并检查 Workers 兼容性、包体积、维护状态和许可证。
- 后端覆盖认证各阶段、请求方法/header/body、Cookie 与重定向传递、错误分类、限流并发、状态篡改/过期/用途/轮换、Cookie 容量和 API 安全响应。
- 前端覆盖计算、筛选、导出、运行时校验、表单、加载/空/错状态、认证失效、倒计时、键盘、主流程端到端、手机/桌面视觉与无障碍。
- 不在常规自动化中访问真实学校系统。生产可行性须在 Cloudflare 非生产环境验证上游连通、响应编码、多个 `Set-Cookie`、运行时加密/解析、Durable Objects 和单 Worker 路由。

完成定义：相关类型检查、lint、测试、构建和 Workers 验证通过；敏感信息、缓存、日志及 Cookie 边界已检查；行为和长期文档与实现一致。涉及前端体验时还须按本文件开头规则使用 `impeccable` 并完成手机/桌面视觉验收。

## 10. 开发与文档流程

1. 阅读本文件、相关实现和必要的旧项目生产代码；保留用户已有改动。
2. 先固定边界 schema、协议和可测试行为，再实现路由或界面。
3. 保持改动聚焦；实现、接口、配置、数据流、安全边界、部署或已知限制变化时，同步更新对应 `docs/`。
4. `docs/` 按长期职责组织，如 `api/`、`authentication/`、`security/`、`cloudflare/`、`frontend/`、`testing/`、`architecture/`；优先更新现有主题，不写进度日志、日期报告或命令输出流水账。
5. 文档使用简体中文和脱敏示例，记录可复现方法、稳定结论、源码位置及必要的最小协议/代码片段；未完成或未验证内容必须明确标注。
6. 提交前检查工作树、忽略规则和差异，确保无凭据、用户数据、真实响应、日志或构建产物。

实施阶段依次为：可行性验证；契约与安全；认证与上游适配；前端基础；用户功能；生产加固。当前阶段 0–4 已完成，阶段 5 进行中；`MAJOR_RULES` 当前为空，所有专业安全降级。历史细节以代码、测试和 `docs/` 为准，不在本文件维护进度流水账。

## 11. 变更确认边界

以下内容未经用户明确确认不得修改，并须同步更新本文件：

- 技术栈、`frontend/`/`backend/` 边界、单 Worker 同源部署或 `/api/v1` 契约。
- 只读产品范围、上游协议语义或首版功能。
- 无业务数据持久化原则、加密 `HttpOnly Cookie` 会话、有效期或硬轮换策略。
- Durable Objects 限流用途、分片/映射、阈值、保留期或故障默认拒绝策略。
- 专业培养方案假设、规则来源门槛或无法匹配时的安全降级。
- shadcn/ui 主体系、`impeccable` 使用边界或浏览器支持范围。
