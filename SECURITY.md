# 安全策略

## 支持范围

安全修复优先覆盖当前 `main` 和最新发布版本。Alpha 阶段不承诺为更早的开发快照提供补丁。

## 报告漏洞

请使用 GitHub Security Advisories 的私密漏洞报告功能，不要在公开 Issue、日志或截图中披露漏洞细节、API Key、OAuth Token、本地业务文件或用户数据目录。

报告应包含：

- 受影响版本和操作系统。
- 最小复现步骤与预期影响。
- 已确认的攻击边界。
- 已做脱敏的日志或示例。

## 安全边界

- 桌面窗口是正式入口，本地服务只监听 loopback 并校验同源访问。
- 渲染器保持 `contextIsolation`、sandbox 和禁用 Node integration。
- 密钥只保存在本地数据目录，备份默认移除密钥。
- 所有用户输入路径必须经过限定根目录的安全解析。
- Windows Agent 命令和本机 MCP Server 当前没有进程级文件系统沙箱；安全边界依赖 Workspace Root、能力授权、路径校验、命令分类和逐次审批。
- 公开 Windows Alpha 可能是未签名产物；Release 必须明确标注签名状态、SmartScreen 风险并提供 SHA-256。macOS 公开产物必须签名并 notarize。

发现密钥误提交时，应立即撤销密钥并清理 Git 历史；仅删除最新提交中的文件不能使密钥恢复安全。
