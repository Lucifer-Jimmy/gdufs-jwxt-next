# 前端数据流与学业计算

本文档说明 React 前端的页面结构、请求状态管理、学业指标计算口径、专业规则匹配与安全降级、浏览器端导出的实现方式。所有个人数据只存在于当前页面内存，不写入 `sessionStorage`、`localStorage`、IndexedDB 或 Cache API。

## 1. 页面与路由

`frontend/src/app.tsx` 组合全部路由，认证区与应用区使用不同的布局壳：

| 路径        | 页面                                       | 布局                                     |
| ----------- | ------------------------------------------ | ---------------------------------------- |
| `/`         | 账号密码登录                               | `features/auth/auth-layout.tsx` 认证壳   |
| `/mfa`      | 短信验证码发送与校验                       | 同上                                     |
| `/overview` | 学业概览（指标、趋势、规则进度或降级提示） | `features/app/app-layout.tsx` 应用壳     |
| `/grades`   | 成绩筛选、排序、详情与导出                 | 同上                                     |

应用壳提供顶部品牌栏、「概览 / 成绩」主导航、当前用户姓名和退出按钮；未匹配路径回到 `/`。

## 2. 请求状态管理

数据获取统一使用 TanStack Query，查询结果只保存在 QueryClient 内存中，不启用任何持久化插件。固定查询键：

| 查询键                          | 来源接口                | staleTime | 定义位置                           |
| ------------------------------- | ----------------------- | --------- | ---------------------------------- |
| `["me"]`                        | `GET /api/v1/me`        | 5 分钟    | `features/app/app-layout.tsx`      |
| `["grades"]`                    | `GET /api/v1/grades`    | 10 分钟   | `features/overview/overview-page.tsx` |
| `["grade-detail", recordKey]`   | `POST /api/v1/grades/detail` | Infinity | `features/grades/grades-page.tsx`  |

所有查询关闭 `refetchOnWindowFocus`。成绩详情以成绩记录键为查询键且永不失效：详情是上游原样透传的单层 JSON，打开对话框时按记录拉取一次，关闭后保留 10 分钟供再次打开复用。

### 认证失效的统一处理

后端对缺失、无效、过期登录态分别返回 `AUTHENTICATION_REQUIRED`、`SESSION_INVALID`、`SESSION_EXPIRED` 三个 401 错误码。`lib/api.ts` 导出两个辅助函数：

- `isAuthErrorCode(code: string): boolean`：普通布尔判断，用于 JSX 否定分支，避免类型谓词把联合类型收窄成 `never`；
- `isAuthError(error): error is ApiError`：类型谓词，仅用于肯定分支。

`features/app/app-layout.tsx` 的 `useAuthRedirect(error)` 在任意查询报认证错误时跳回登录页，并通过路由 state 携带 `authNotice` 提示语；登录页读取该 state 原位展示。退出登录无论请求成败都执行 `queryClient.clear()` 并回到 `/`，后端始终幂等清除 Cookie。

### 手动刷新

成绩页「刷新」调用 `POST /api/v1/grades/refresh`，成功后用 `queryClient.setQueryData(["grades"], …)` 覆盖缓存并以服务端返回的 `retryAfterSeconds`（账号级 30 秒）启动按钮冷却倒计时；倒计时期间按钮禁用并显示剩余秒数。冷却以服务端值为准，不在前端自行假设。

## 3. MFA 交互

`features/auth/mfa-page.tsx` 的验证码流程完全由服务端状态驱动：

1. 进入页面先取 `GET /api/v1/auth/mfa`，恢复「已发送」状态与服务端剩余冷却 `retryAfterSeconds`；
2. 发送成功后以响应中的 `retryAfterSeconds` 重置输入并启动重发倒计时；
3. 验证码为 6 位数字，使用 Input OTP 分段输入，输满自动提交 `POST /api/v1/auth/mfa/verify`；
4. `INVALID_MFA_CODE` 清空输入并在字段原位提示；`RATE_LIMITED` 视为尝试次数耗尽，显示阻断提示并引导重新登录；
5. MFA 状态缺失或过期（401）时回到登录页并说明原因。

倒计时用 `setTimeout` 逐秒递减，与成绩刷新冷却同一实现模式，避免渲染期副作用。

## 4. 学业计算口径

全部统计在 `frontend/src/lib/academics.ts` 的纯函数中完成，口径与旧项目生产实现一致，并有单元测试固定：

```ts
// frontend/src/lib/academics.ts
// 加权 GPA = Σ(绩点 × 学分) / Σ学分；全部成绩记录计入，
// 含不及格（绩点为 0 仍进分子，学分仍进分母）；重修/补考按独立记录各自计入。
export function weightedGpa(grades: readonly Grade[]): number | null {
  const totalCredits = grades.reduce((sum, grade) => sum + grade.credits, 0);
  if (totalCredits === 0) {
    return null;
  }
  ...
}
```

- **已修学分**：全部成绩记录的学分合计（`earnedCredits`），与 GPA 一样包含不及格记录；
- **通识学分**：上游 `courseCategory` 非空即计为通识课程（`generalEducationCredits`）；
- **本学期**：出现过的学期中时间最新者（`currentSemester`），学期标识格式为 `2023-2024-1`；
- **分学期趋势**：`semesterTrend` 按时间正序输出每学期 GPA（两位小数）、学分和门数，概览页用 Recharts 线性折线渲染，同时在 `<details>` 内提供等价数据表，图表不是数据的唯一表达；
- **学期展示**：`formatSemester` 输出「2023–2024 学年第 1 学期」，趋势图横轴用短标签 `23-24-1`；
- **空口径**：学分为零的记录集合 GPA 为 `null`，界面显示「—」，不产生误导性的 0.00。

成绩页筛选（学期、课程属性）与排序（学期、学分、总评、绩点）同样由该文件提供。默认排序为学期倒序，同学期保持上游返回顺序；排序使用展开副本，不改写缓存数组。

## 5. 专业学分规则与安全降级

规则框架位于 `frontend/src/lib/rules.ts`，静态规则表位于 `frontend/src/lib/rules-data.ts`。规则随前端版本发布，不经过数据库或运行时存储。

每条规则由 `majorRuleSchema`（Zod strict）固定字段：稳定 `ruleId`、标准化专业匹配值 `majors`、登记别名 `aliases`、规则 `version`、预留年级维度 `enrollmentYears`、毕业总学分与通识学分要求、通识类别口径，以及可追溯来源 `source { title, checkedAt, url? }`。

匹配只允许规范化后的精确相等：

```ts
// frontend/src/lib/rules.ts
// 规范化只服务精确匹配：去首尾空白、统一全/半角括号、移除内部空白。
export function matchMajorRule(
  major: string,
  rules: readonly MajorRule[],
): RuleMatch {
  const target = normalizeMajorName(major);
  const matched = rules.filter((rule) =>
    [...rule.majors, ...rule.aliases].some(
      (candidate) => normalizeMajorName(candidate) === target,
    ),
  );
  ...
}
```

返回三种状态：`matched`、`unmatched`、`conflict`（多条规则同时命中）。**当前 `MAJOR_RULES` 为空表**——尚无专业完成培养方案来源核对，因此概览页对所有专业走安全降级：显示「该专业规则暂未配置或无法准确匹配」的说明和不依赖培养方案的已修/通识学分统计，不渲染任何完成比例。禁止回退到全校统一默认值或旧项目固定值，禁止模糊匹配，禁止展示可能错误的「已达毕业要求」。

新增专业规则时必须同时提供：来源培养方案与核对日期、匹配/边界学分/分类/降级的单元测试（`frontend/tests/rules.test.ts`），并在规则 `version` 中体现变化。

## 6. 浏览器端导出

`frontend/src/lib/export.ts` 提供两种导出，内容始终是成绩页当前筛选与排序后的可见列表，不上传也不暂存后端：

- **CSV**：纯函数 `gradesToCsv` 生成，带 BOM 前缀保证 Excel 正确识别中文，字段按规则转义；文件名含导出时间；
- **Excel**：`downloadGradesExcel` 动态 `import("xlsx")` 按需加载 SheetJS，避免其进入首屏 bundle。

两种导出共用同一组中文表头与行映射（`gradesToRows`），并有单元测试固定列顺序与转义行为。

## 7. 测试约定

- 页面测试渲染完整 `<App />` 并通过 `window.history.replaceState` 进入目标路由；后端响应用 `vi.spyOn(globalThis, "fetch")` 按 URL 路由桩接，不依赖查询触发顺序；
- 成绩 fixture 由 `frontend/tests/fixtures.ts` 的 `makeGrade` 工厂生成，字段值全部虚构，不提交真实学号、姓名或成绩；
- jsdom 缺失的浏览器 API（`ResizeObserver`、`elementFromPoint`、指针捕获、`scrollIntoView`）在 `frontend/tests/setup.ts` 统一补齐，供 Radix Select/DropdownMenu、Input OTP 和 Recharts 运行；CSV 下载测试直接挂载 `URL.createObjectURL`/`revokeObjectURL` 并在结束后移除，不得用 `vi.stubGlobal` 整体替换 `URL`（会破坏 React Router 的 `new URL()`）。

## 相关文档

- [API v1 契约](../api/v1-contract.md)：前端消费的资源 schema 与错误结构；
- [单元测试](../testing/unit-testing.md)：测试分层与运行方式；
- [项目结构](../architecture/project-structure.md)：前端目录与逐文件职责。
