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

首版固定路由及认证要求以根目录 `AGENTS.md` 第 6.3 节为准。当前 Worker 已实现健康检查、统一错误、请求 ID、安全 header 和 API 404；认证、个人信息和成绩路由将在上游服务迁移后接入。

已定义的 schema 覆盖：

- 登录账号密码、MFA 状态、发送与校验、退出；
- `PersonalInfo`：`studentId`、`name`、`college`、`major`；
- `Grade`：标准化课程、学期、学分、成绩、绩点、课程性质与属性；
- `GradeDetailKey`：同一条成绩记录提供的四个详情标识；
- `GradeDetail`：总评成绩和标准化成绩组成列表。

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

这些属性名是本项目稳定契约，不是上游原始字段名。阶段 2 的适配器负责把同一条上游成绩记录中的四个原始标识一次性映射到该对象。

`grades` 最多包含 300 条记录，并显式返回 `reachedPageLimit`。达到上游单页限制时，后端仍返回已取得的数据，但必须记录不含用户数据的结构化告警。

目前标准化资源契约已经固定，学校成绩 JSON 到 `Grade` 的字段映射尚未完成。阶段 2 必须根据脱敏真实 fixture 固化映射和缺失字段行为；在此之前不得假定旧测试中的少量示例字段代表完整上游协议。

## 4. 验证

运行：

```bash
pnpm --filter @gdufs-jwxt/backend test
```

`backend/tests/api-schema.test.ts` 验证资源成功样例和账号、验证码、详情标识的长度/格式边界；`backend/tests/request-security.test.ts` 验证 JSON、同源、统一错误和限流响应语义；`backend/tests/app.test.ts` 验证实际 Worker 路由、安全 header 与 SPA 隔离。
