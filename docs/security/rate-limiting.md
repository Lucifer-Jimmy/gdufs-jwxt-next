# Durable Objects 严格限流

本文档说明受保护动作的主体摘要、16 分片路由、SQLite Durable Objects 原子计数、规则目录和故障语义。限流只保存不可逆摘要和短期安全元数据，不保存账号、学号、IP、认证状态或教务数据。

## 1. 模块职责

| 文件                                         | 职责                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| `backend/src/rate-limit/types.ts`            | 动作、规则、DO 请求和判定结果的共享类型。              |
| `backend/src/rate-limit/rules.ts`            | 已确认阈值的唯一规则目录和业务动作策略组合。           |
| `backend/src/rate-limit/subject.ts`          | HMAC 主体摘要、分片版本和 16 分片映射。                |
| `backend/src/rate-limit/rate-limit-shard.ts` | SQLite schema、原子检查/登记、过期清理和选定计数清除。 |
| `backend/src/rate-limit/rate-limiter.ts`     | Worker 侧多维规则调用和 fail-closed 错误映射。         |

慢速学校上游请求不能在 Durable Object 内执行。调用顺序固定为：

```text
路由取得原始主体
  -> Worker 使用 secret HMAC
  -> 摘要首字节映射到 v1 的 16 个分片
  -> DO 原子检查并登记本次尝试
  -> DO 立即返回
  -> 允许时路由才请求学校上游
```

## 2. 主体摘要与分片

`RATE_LIMIT_HMAC_KEY_V1` 必须是 32 字节随机值的 base64url 编码，与会话 AEAD 密钥独立。原始主体只在当前 Worker 请求内短暂存在；DO 只接收 43 字符的 SHA-256 HMAC base64url 摘要。

核心输入在 `backend/src/rate-limit/subject.ts` 中包含用途域和分片版本，避免账号、IP 和 MFA flow 的相同文本得到同一摘要：

```ts
const digest = await crypto.subtle.sign(
  "HMAC",
  key,
  encodeUtf8(
    `gdufs-jwxt-rate-limit:${RATE_LIMIT_SHARD_VERSION}:${subjectKind}:${subject}`,
  ),
);
```

分片算法固定为 `v1`：

```ts
shardName: `v1-shard-${digestBytes[0] % 16}`;
```

分片只是并发和存储边界。同一分片内仍以 `subject_hash + action` 为主键，主体之间不共享额度。不得直接修改版本、分片数或映射算法；扩容需要兼容迁移方案，防止主体在过渡期间获得新额度。

## 3. SQLite 数据模型

`backend/src/rate-limit/rate-limit-shard.ts` 通过 `_sql_schema_migrations` 记录 schema 版本，不使用 Durable Objects SQLite 不支持的 `PRAGMA user_version`。业务表只包含：

```sql
CREATE TABLE rate_limit_counters (
  subject_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  window_started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (subject_hash, action)
);
```

每次检查先删除 `expires_at <= now` 的记录。当前所有规则的 `retentionSeconds` 等于窗口长度，最短 30 秒、最长 24 小时。表中没有原始主体、上游响应、认证 Cookie 或用户业务字段。

## 4. 原子检查与登记

DO 暴露 RPC 方法 `checkAndConsume()`，不公开内部 HTTP 路由。所有规则在一个 `transactionSync()` 内读取、判断和写入：

```ts
return this.ctx.storage.transactionSync(() => {
  // 清理过期记录并读取同一主体的所有规则。
  // 任一规则已满时不写入任何规则。
  // 全部允许时再一次性写入所有计数。
});
```

窗口是固定窗口。未过期记录沿用原 `window_started_at`；到达 `window_started_at + windowSeconds` 时旧记录失效，本次尝试建立新窗口。拒绝时返回所有触发规则中最长的等待时间，保证调用方不会比更严格规则更早重试。

同一 DO 实例的输入门和同步事务共同保证并发请求不能同时越过额度。DO 返回后才允许执行学校上游请求；上游失败或超时不返还已登记额度。

## 5. 已配置规则

阈值唯一来源是 `backend/src/rate-limit/rules.ts`：

| 动作         | 主体     | 规则                                     |
| ------------ | -------- | ---------------------------------------- |
| 账号密码登录 | 账号     | 10 分钟最多 5 次                         |
| 账号密码登录 | IP       | 10 分钟最多 30 次                        |
| MFA 发送     | 账号     | 10 分钟最多 3 次，同时 24 小时最多 10 次 |
| MFA 发送     | IP       | 10 分钟最多 20 次                        |
| MFA 校验失败 | MFA flow | 单个 10 分钟流程最多 5 次                |
| 成绩手动刷新 | 账号     | 30 秒最多 1 次                           |

MFA 发送仍须遵守学校返回的 `codeTime`；路由应取本地判定和上游冷却中的更严格等待时间。MFA 校验只在校验失败时登记 flow 失败计数；达到 5 次后，认证路由还必须清除临时 Cookie。

## 6. 路由调用

阶段 2 路由应从当前认证步骤取得主体，并传入完整策略。账号登录示例：

```ts
await enforceRateLimits({
  namespace: context.env.RATE_LIMIT_SHARD,
  hmacKey,
  dimensions: [
    {
      kind: "account",
      subject: normalizedUsername,
      rules: RATE_LIMIT_POLICIES.authLogin.account,
    },
    {
      kind: "ip",
      subject: clientIp,
      rules: RATE_LIMIT_POLICIES.authLogin.ip,
    },
  ],
  now: Math.floor(Date.now() / 1000),
});
```

维度按顺序登记。若账号维度已登记而 IP 维度随后触发限制或发生故障，账号额度不返还，符合“被 Worker 接受并准备执行的尝试计数”规则。成功登录只通过 DO 的 `clear()` 清理该账号的 `auth_login_account` 连续失败计数，不清理 IP 窗口。

任何 HMAC、binding、RPC、DO 或 SQLite 异常都映射为通用可恢复 `500` 并拒绝受保护动作，不得失效放行。正常超限映射为 `429`，由统一错误层同时写入 `Retry-After` 和 `retryAfterSeconds`。

## 7. 验证

```bash
pnpm --filter @gdufs-jwxt/backend typecheck
pnpm --filter @gdufs-jwxt/backend test
```

`backend/tests/rate-limit.test.ts` 在 workerd 中覆盖：

- HMAC 稳定性、主体域隔离、密钥长度和 16 分片范围；
- 固定窗口边界与精确等待秒数；
- 多规则原子登记和拒绝不递增；
- 同主体 10 个并发请求只能放行规则指定次数；
- 不同主体隔离、指定动作清理和过期元数据删除；
- Worker 调用层的 RPC 路由与 `429` 映射。

阶段 2 接入真实路由后还需增加请求级契约测试，验证账号/IP 组合、MFA 上游冷却、五次失败清 Cookie，以及 DO 故障时响应中不含主体或底层异常。
