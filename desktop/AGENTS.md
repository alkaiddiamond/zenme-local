# Desktop Instructions

- `main.cjs` 负责启动和停止本地 Next.js 服务、窗口生命周期、IPC 注册及外部导航边界。
- `preload.cjs` 只暴露最小、明确命名的 IPC API；禁止向渲染器暴露 Node.js、任意 channel 或通用文件系统能力。
- 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，并拒绝非可信 origin 的窗口和导航。
- 所有平台路径使用 `node:path` 和 Electron `app.getPath()`；不要硬编码盘符、`AppData` 或 macOS 用户目录。
- Windows 与 macOS 的安装、签名、数据保留和冷启动要求见 `docs/release.md`。
- 修改窗口、IPC、本地服务或打包配置后，运行 `npm run check`、`npm run build`、对应平台目录包和 `npm run desktop:smoke`。
- 冒烟测试必须使用临时 `userData` 与 `ZENME_DATA_DIR`，不得读写真实用户数据。
