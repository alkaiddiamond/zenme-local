# 贡献指南

感谢参与 Zenme Local。提交改动前，请先确认影响范围，并使用与风险匹配的验证方式。

## 开发环境

- Node.js 22.12–24
- npm 11
- Windows 10/11 x64，或 macOS 12+ Intel x64

```bash
npm ci
npm run desktop:dev
```

请复制 `.env.example` 中确实需要的配置，不要提交 `.env`、API Key、OAuth Token、本地数据目录或真实业务文件。

## 改动与测试

| 改动范围 | 最低验证 |
| --- | --- |
| 纯文档 | 链接与命令人工检查 |
| UI、组件、领域逻辑 | `npm run check` |
| API、持久化、本地数据 | 相关回归测试 + `npm run verify` |
| Electron、IPC、打包 | `npm run verify` + 对应平台目录包 + `npm run desktop:smoke` |
| 发布配置 | Windows 与 macOS Intel 各自构建验证 |

持久化格式变更必须包含旧数据 fixture、向前迁移和失败恢复测试。用户可见或跨进程交互如果无法由单元测试充分证明，应在 PR 中记录真机步骤和结果。

## Pull Request

PR 描述必须包含：

- 影响范围和用户可见变化。
- 实际运行的验证命令及结果。
- 未运行的检查及原因。
- 已知边界、兼容性和剩余风险。

保持 PR 聚焦，不混入无关格式化、依赖升级或大型重构。提交信息采用 Conventional Commits，例如 `feat: add macOS Intel package`、`fix: preserve canvas copy preview`。

## 产品与工程文档

- 产品需求、设计资料和研究维护在独立 `zenme-doc` 仓库。
- 与代码版本绑定的架构、数据、安全和发布说明维护在本仓库 `docs/`。
- 行为变化必须同步更新对应文档，不能只更新 README。
