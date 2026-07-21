# 开发文档索引

`docs/` 按长期职责维护项目实现文档。开始开发前先阅读根目录 `AGENTS.md`，再根据任务进入对应分类；不要在此目录新增按日期、阶段或单次任务命名的记录。

## 文档分类

| 分类              | 职责                                      | 当前文档                                                                                                                                                                   |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture/`   | 仓库结构、模块边界和文件职责              | [项目结构](architecture/project-structure.md)                                                                                                                              |
| `development/`    | TypeScript 本地开发、联调和调试           | [TypeScript 本地开发与调试](development/typescript-local-development.md)                                                                                                   |
| `testing/`        | 测试分层、fixture、单元测试写法和运行方式 | [单元测试](testing/unit-testing.md)                                                                                                                                        |
| `api/`            | 版本化 HTTP 契约和资源边界                | [API v1 契约](api/v1-contract.md)                                                                                                                                          |
| `authentication/` | 统一认证、MFA、SSO 和教务登录协议         | [统一认证适配](authentication/authserver.md)                                                                                                                               |
| `frontend/`       | 前端页面结构、请求状态、学业计算与导出    | [前端数据流与学业计算](frontend/data-flow-and-academics.md)                                                                                                                |
| `security/`       | Cookie、认证状态、限流和通用安全机制      | [加密客户端状态与请求安全](security/client-state.md)、[Durable Objects 严格限流](security/rate-limiting.md)、[安全配置与结构化日志](security/configuration-and-logging.md) |
| `cloudflare/`     | Wrangler、Workers 本地/远程运行和部署     | [Wrangler 开发、调试与部署](cloudflare/wrangler-development.md)                                                                                                            |

后续新增认证上游协议、成绩解析、前端主题等主题时，应先判断主责分类，并优先更新已有主题。交叉内容只在主责文档完整说明，其他文档使用相对链接引用。
