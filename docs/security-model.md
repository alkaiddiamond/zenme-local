# 安全模型

## 信任边界

- Electron 主进程和本地数据仓库属于可信应用边界。
- 渲染器、用户导入内容、模型响应、文件路径和外部 URL 均视为不可信输入。
- 本地服务只服务同一台机器上的受控桌面窗口，不作为 LAN 或公网 API。

## 固定要求

- 服务只绑定 `127.0.0.1`，请求必须通过统一 loopback 与同源校验。
- BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- preload 不提供任意 IPC channel、shell 命令或文件系统访问。
- 导入文件名和路径段拒绝绝对路径、父目录、UNC 与路径分隔符。
- API Key、OAuth Token 不进入前端 bundle、日志、错误响应和备份。
- HTML、EPUB 和模型返回内容在展示前经过既有安全处理。

## 发布检查

- 运行环境变量安全测试和路径安全测试。
- 检查安装包中不包含 `.env.local`、真实数据、日志或调试截图。
- Windows 与 macOS 正式产物必须代码签名；macOS 还必须完成 notarization。
- 依赖安全审计必须使用支持 npm audit API 的 registry，并记录未解决项。
