# API v1 契约

本文档说明同源 Worker 暴露的 `/api/v1` HTTP 契约、边界校验和当前实现状态。API schema 的可执行定义位于 `backend/src/schemas/api.ts`，前后端都不得直接依赖学校上游字段名。

## 1. 通用约定

- 成功响应直接返回有名资源，不额外包装 `data`。
- 错误响应固定为 `{ "error": { "code", "message", "requestId", "retryAfterSeconds?" } }`。
- 所有 API 响应携带 `X-Request-Id`；只有符合 `[A-Za-z0-9_-]{8,64}` 的客户端请求 ID 才会被沿用。
- `/api/v1/health` 之外的响应使用 `Cache-Control: no-store, private`。
- `429` 同时返回整数秒 `Retry-After` header 和 `retryAfterSeconds` 字段。
- 修改认证状态的 `POST` 必须使用 `application/json`，并通过同源 `Origin` 校验；没有 `Origin` 时仅接受同源 `Referer`。
- 未知 `/api/*` 始终返回 JSON `404`，不能进入 React SPA fallback。

## 2. 路由资源

首版固定路由及认证要求以根目录 `AGENTS.md` 第 6.3 节为准。当前 Worker 已实现健康检查、统一错误、请求 ID、安全 header、API 404，以及完整认证和个人信息路由：

| 方法   | 路径                      | 当前状态 | 说明                                                                 |
| ------ | ------------------------- | -------- | -------------------------------------------------------------------- |
| `GET`  | `/api/v1/health`          | 已实现   | 不访问学校上游的健康检查。                                           |
| `POST` | `/api/v1/auth/login`      | 已实现   | 严格执行 CAS 登录页、密码提交和 MFA 页面准备，签发 MFA 临时 Cookie。 |
| `GET`  | `/api/v1/auth/mfa`        | 已实现   | 返回脱敏手机号、验证码发送状态、冷却时间和状态到期时间。             |
| `POST` | `/api/v1/auth/mfa/send`   | 已实现   | 恢复 authserver Cookie，发送验证码并遵守 `codeTime`。                |
| `POST` | `/api/v1/auth/mfa/verify` | 已实现   | 校验验证码，执行 ticket 到 JWXT Cookie 的三跳，并验证个人信息。      |
| `POST` | `/api/v1/auth/logout`     | 已实现   | 幂等清除 MFA 和正式登录 Cookie。                                     |
| `GET`  | `/api/v1/me`              | 已实现   | 从教务系统实时获取学号、姓名、学院和专业，成功后续期登录态。         |
| `GET`  | `/api/v1/grades`          | 已实现   | 全量成绩实时查询，达到 300 条时返回边界标记并记录安全告警。          |
| `POST` | `/api/v1/grades/refresh`  | 已实现   | 账号级 30 秒严格限流的实时成绩查询。                                 |
| `POST` | `/api/v1/grades/detail`   | 已实现   | 使用同一成绩记录的四个标识实时查询单科成绩组成。                     |

已定义的 schema 覆盖：

- 登录账号密码、MFA 状态、发送与校验、退出；
- `PersonalInfo`：`studentId`、`name`、`college`、`major`；
- `Grade`：标准化课程、学期、学分、总评、绩点、考核方式、课程属性与通识类别；
- `GradeDetailKey`：同一条成绩记录提供的四个详情标识；
- `GradeDetail`：旧生产实现从详情脚本解析出的单个 JSON 对象；后端保留对象的上游字段名、字段值与嵌套结构，不重组为展示组件。

请求 schema 使用 `.strict()` 拒绝未声明字段。以下片段来自 `backend/src/schemas/api.ts`，体现账号密码边界；密码只检查传输格式，不在 schema 层修改原值：

```ts
export const loginRequestSchema = z
  .object({
    username: boundedText(64),
    password: z.string().min(1).max(256),
  })
  .strict();
```

## 3. 成绩边界

`Grade.detailKey` 把详情请求所需的四个标识组合为一个不可拆散的值。前端只能从当前成绩记录读取并原样提交该对象，不能自行拼接标识。请求使用 `POST /api/v1/grades/detail`，避免标识进入 URL、浏览器历史和常规代理日志。

对应的标准化边界位于 `backend/src/schemas/api.ts`：

```ts
export const gradeDetailKeySchema = z.object({
  studentKey: boundedText(128),
  teachingClassKey: boundedText(128),
  gradeRecordKey: boundedText(128),
  totalScore: boundedText(64),
});

export const gradeDetailRequestSchema = gradeDetailKeySchema.strict();
```

这些属性名是本项目稳定契约，不是上游原始字段名。成绩适配器接入时必须把同一条上游成绩记录中的四个原始标识一次性映射到该对象。

`grades` 最多包含 300 条记录，并显式返回 `reachedPageLimit`。达到上游单页限制时，后端仍返回已取得的数据，但必须记录不含用户数据的结构化告警。

成绩列表映射已根据结构等价的真实响应核验：`kch`、`kc_mc`、`xnxqid`、`xf`、`zcjstr`、`zcj`、`jd`、`ksfs`、`kcsx` 和可选 `txklb` 分别映射到稳定公开字段；`xs0101id`、`jx0404id`、`cj0708id` 与 `zcjstr` 只从同一记录组合为详情键。真实边界中的 `xf`、`zcj`、`jd` 均为 number，适配器不会接受字符串数值或自行猜测类型；缺少必填字段时返回 `UPSTREAM_CHANGED`。未进入公开契约的顶层统计字段和记录附加字段不会透传。

成绩详情是已确认的例外边界：旧生产实现从 `let arr = [{...}];` 中解析并直接返回单个对象，因此 v1 响应原样保留该 JSON 对象。后端只验证外层确实是单个、键数量受控的 JSON 对象，不要求固定字段集合，不丢弃额外字段，不改名、不转换数值或百分比，也不添加中文标签。

## 4. 验证

运行：

```bash
pnpm --filter @gdufs-jwxt/backend test
```

`backend/tests/api-schema.test.ts` 验证资源成功样例和账号、验证码、详情标识的长度/格式边界；`backend/tests/request-security.test.ts` 验证 JSON、同源、统一错误和限流响应语义；`backend/tests/app.test.ts` 验证实际 Worker 路由、安全 header 与 SPA 隔离；`backend/tests/auth-api.test.ts` 验证认证 API 的完整请求顺序、Cookie 转换和 `/me` 续期；`backend/tests/grade-parsers.test.ts`、`backend/tests/jwxt.test.ts` 与 `backend/tests/grades-api.test.ts` 验证成绩字段边界、上游请求顺序、会话续期和刷新限流。
