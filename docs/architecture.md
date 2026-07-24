# 系统架构

## 运行边界

Zenme Local 是单机桌面应用。Electron 主进程启动绑定到 `127.0.0.1` 随机端口的 Next.js 生产服务，再由受限 BrowserWindow 加载。应用不提供公网 Web 入口、账号系统、远程数据库或自动云同步。

```text
Electron main
  ├─ BrowserWindow + preload IPC
  ├─ local Next.js child process (127.0.0.1)
  └─ userData/desktop-config.json
                │
                ▼
Next.js app and API
  ├─ app/ routes
  ├─ components/ UI and canvas
  └─ lib/local repositories
                │
                ▼
User-selected Zenme data directory
```

## 代码职责

- `desktop/`：进程、窗口、IPC、外部导航和数据目录切换。
- `app/`：页面和本地 API 边界。
- `components/zenme/`：工作区、画布、节点和阅读界面。
- `lib/ai/`：模型服务商和调用适配。
- `lib/local/`：项目、文件、设置、备份和原子持久化。
- `lib/reading/`：阅读解析与展示逻辑。
- `lib/music/`：音乐元数据与歌词能力，不包含音乐分析服务。

## 约束

- BrowserWindow 不获得 Node.js 能力，IPC 只暴露明确白名单。
- 本地 API 复用统一 loopback、同源和错误响应边界。
- 业务数据不写入源码仓库或 Next.js 构建目录。
- 外部 HTTP 导航交给系统浏览器，窗口内禁止跨 origin 导航。
