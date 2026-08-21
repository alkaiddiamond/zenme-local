# Zenme

<p align="center">
  <img src="public/brand/icons/zenme-logo-128.png" width="160" alt="Zenme Logo" />
</p>

<div align="center">

[![GitHub Stars](https://img.shields.io/github/stars/alkaiddiamond/zenme-local?style=social)](https://github.com/alkaiddiamond/zenme-local/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/alkaiddiamond/zenme-local?style=social)](https://github.com/alkaiddiamond/zenme-local/network/members)
[![GitHub Issues](https://img.shields.io/github/issues/alkaiddiamond/zenme-local)](https://github.com/alkaiddiamond/zenme-local/issues)
[![GitHub Pull Requests](https://img.shields.io/github/issues-pr/alkaiddiamond/zenme-local)](https://github.com/alkaiddiamond/zenme-local/pulls)
[![License](https://img.shields.io/github/license/alkaiddiamond/zenme-local)](LICENSE)
[![Docs](https://img.shields.io/badge/工程文档-查看-8B5E3C)](docs/README.md)

</div>

Zenme 是一款**本地优先的 AI 无限画布桌面应用**：把提示词、AI 回复、Workspace 文件、图片、视频、任务、书籍与阅读笔记集中到一个 Windows 应用里，通过节点和连线保存上下文，并让 Project Agent 在用户授权的本地 Workspace 中读取、检索、提出修改和运行任务。

<p align="center">
  <a href="#桌面端">桌面端</a> · <a href="#安装-zenme">安装 Zenme</a> · <a href="#功能亮点">功能亮点</a> · <a href="#本地数据与隐私">本地数据与隐私</a> · <a href="#工程文档">工程文档</a>
</p>

> [!IMPORTANT]
> Zenme 当前处于 `v0.1.x Alpha`。Windows 10/11 x64 是当前公开发布目标；数据格式、升级流程和部分交互仍可能调整。具体版本以 `package.json`、CHANGELOG 与发布标签为准。

---

## 桌面端

Zenme 用无限画布替代线性对话列表。提示词、AI 回复、生成结果、任务和阅读笔记都可以成为节点，并通过连线保存它们之间的关系。

<p align="center">
  <a href="https://github.com/alkaiddiamond/zenme-local/releases"><img src="https://img.shields.io/badge/下载桌面端-Windows_x64-8B5E3C?style=for-the-badge" alt="下载 Zenme 桌面端"></a>
  &nbsp;
  <a href="docs/release.md"><img src="https://img.shields.io/badge/安装与发布-Guide-gray?style=for-the-badge" alt="安装与发布指南"></a>
</p>

---

## 安装 Zenme

1. 前往 [GitHub Releases](https://github.com/alkaiddiamond/zenme-local/releases) 下载最新的 Windows x64 安装包。
2. 运行 NSIS `.exe`，按安装向导完成安装。
3. 首次启动后，在「设置 → 模型配置」中登录 ChatGPT，或添加兼容 OpenAI / Anthropic 协议的服务商。

> [!NOTE]
> Alpha 阶段请先阅读对应 Release 的安装说明和已知问题。Windows 安装包当前可能未签名并触发 SmartScreen；请确认文件来自本仓库 Releases，核对 SHA-256 后点击「更多信息」确认运行。公开产物仍需完成安装、升级、卸载和冷启动验证。

### 平台支持

| 平台 | 状态 | 产物 |
| --- | --- | --- |
| Windows 10/11 x64 | 当前发布目标 | NSIS `.exe` |
| macOS 12+ Intel x64 | 暂停发布，保留构建配置 | `.dmg`、`.zip` |
| macOS Apple Silicon | 暂未支持 | — |
| Linux | 暂未支持 | — |

---

## 功能亮点

- **统一 Project Agent**：普通问答、文件调查、代码修改、命令执行和多 Agent 协作共用一个画布入口；运行过程、审批、暂停、重试和最终答复保留在同一 Turn 中。
- **分层画布上下文**：当前指令、当前节点、显式连接/选择的 Graph Context、当前 Conversation 历史和 Project 背景按稳定优先级进入模型；画布分叉会形成独立 Conversation。
- **本地 Workspace**：项目可绑定一个主目录并加入附加 Root，以独立的读、写、删除、命令和 Git 写入权限访问真实文件；路径、敏感文件和链接逃逸均在服务端校验。
- **可审阅文件修改**：Agent 的写入、编辑和补丁先形成 ChangeSet，保留基线哈希、冲突检测、审批、应用与回退记录，不直接覆盖 Workspace。
- **Agent 工具与扩展**：支持文件搜索、Shell、代码诊断与语义导航、网页取证、隔离浏览器、图片工具、Skill、MCP、Hooks、Task、Plan Mode、Workflow、Sub-agent 和持续 Team。
- **Project Memory 与 Knowledge**：用户确认的长期记忆可跨 Conversation 使用；可重建的本地图谱和向量索引为 Agent 提供有来源、有限预算的检索上下文。
- **无限画布工作区**：自由组织文本、AI 回复、Workspace 文件、图片、视频、任务、书籍和阅读笔记，通过连线保留上下文。
- **多模型服务商**：支持 ChatGPT OAuth，以及兼容 OpenAI / Anthropic 协议的自定义服务商。
- **能力化模型管理**：按文本、视觉、图片、视频、向量、音频和工具能力管理模型，节点只展示可用选项。
- **图片生成与编辑**：支持提示词、参考图片、画幅和模型选择，生成结果可以继续编辑并保留来源。
- **异步视频生成**：创建任务后保存服务商任务 ID，独立轮询状态，关闭并重新打开项目后可继续恢复。
- **阅读与笔记**：在画布中打开 PDF、EPUB、DOCX、Markdown 和 TXT；DOCX 使用无需 Word 或 LibreOffice 的内置版式渲染，保留页面尺寸、字体、页眉页脚等样式，并支持自动分页、标题目录、阅读进度、标注与页内笔记。
- **任务管理**：支持父子任务、进度、状态、优先级、复杂度、负责人和标签。
- **高效画布交互**：支持框选、多选、连线、分组、Alt 拖动复制、撤销重做、缩放和小地图。
- **本地数据管理**：支持数据目录切换、备份与恢复，并提供本地 Token 用量统计。

### 节点类型

| 类别 | 节点 |
| --- | --- |
| 文本与 Agent | 文本、Markdown、代码、文本生成、AI 回复 |
| 文件与 Workspace | 文件、Workspace 文件、文件夹 |
| 生成 | 图片、图片生成/编辑、视频生成、视频结果 |
| 管理 | 任务、分组 |
| 阅读 | 可阅读文件、阅读器、摘录与阅读笔记 |
| 音乐 | 音乐、音乐播放器、歌词 |

历史版本创建的 Workspace Agent / Global Agent 节点仍可回看与审计，但新任务统一从文本生成节点进入 Project Agent Turn。

---

## 本地数据与隐私

Zenme 是纯本地桌面应用，不提供 Zenme 账号、远程数据库或自动云同步。

- 项目、画布、文件、阅读资料、笔记和设置默认保存在本机。
- 模型 API Key 与 ChatGPT OAuth 凭据只保存在本机私有存储中，不进入前端、日志或备份。
- 本地 Next.js 服务只监听 loopback，并限制同源访问。
- 导出的备份默认排除 API Key 和 OAuth 凭据，恢复后需要重新登录或填写密钥。
- 升级和卸载不会主动删除用户数据；删除数据需要用户明确操作。
- 调用外部模型时，发送给服务商的内容仍受对应服务商的隐私政策约束。
- 启用本机 MCP Server 等同于运行用户选择的第三方程序；Windows 当前不提供进程级文件系统沙箱，具体边界见安全模型。

默认数据目录位于 Electron `userData` 下，也可以在应用设置中切换。开发环境请使用 `ZENME_DATA_DIR` 指定独立测试目录，避免读取真实数据。

---

## 参与开发

### 环境要求

- Node.js `22.12–24`
- npm `11`
- Windows 10/11 x64（当前主要开发与发布环境）

### 从源码启动桌面应用

```powershell
git clone https://github.com/alkaiddiamond/zenme-local.git
cd zenme-local
npm ci
$env:ZENME_DATA_DIR="G:\data\zenme-development"
npm run desktop:dev
```

Electron 窗口是正式产品入口。单独运行 `npm run dev` 主要用于 Web 界面调试，不能替代桌面端验证。

### 质量检查

```powershell
npm run check          # ESLint + 测试
npm run verify         # check + 生产构建
npm run release:check  # 发布门禁 + 桌面打包与冒烟测试
```

### Windows 构建

```powershell
npm run build
npm run desktop:pack      # 生成免安装目录包
npm run desktop:dist:win  # 生成 Windows x64 NSIS 安装包
```

构建产物输出到 `dist-desktop/`。签名、安装验证和回滚流程见 [发布手册](docs/release.md)。

---

## 技术栈

| 类别 | 技术 |
| --- | --- |
| 桌面应用 | Electron |
| Web 框架 | Next.js + React |
| 语言 | TypeScript |
| 样式 | Tailwind CSS |
| 画布 | React Flow |
| 测试 | Vitest + Node.js Test Runner |
| 打包 | electron-builder + NSIS |
| 数据 | 本地文件系统、原子写入与版本迁移 |

### 项目结构

```text
app/                  Next.js 页面与仅本机访问的 API
components/zenme/     桌面界面、画布、节点和阅读工作区
components/ui/        通用 UI 原语
desktop/              Electron 主进程、IPC、窗口与打包工具
lib/                  AI、Agent、Workspace、本地数据、迁移和领域逻辑
public/               品牌、字体、PDF.js 与静态资源
docs/                 与源码版本绑定的工程文档
```

产品需求、设计资料、路线图和研究文档维护在独立的 `zenme-doc` 仓库；本仓库只保留与代码版本直接绑定的工程资料。

---

## 工程文档

| 文档 | 说明 |
| --- | --- |
| [工程文档索引](docs/README.md) | 架构、安全、数据与发布文档入口 |
| [系统架构](docs/architecture.md) | Next.js、Electron 和本地服务边界 |
| [Agent Workspace Runtime](docs/agent-workspace-runtime.md) | 统一 Project Agent、工具、权限和恢复契约 |
| [Workspace Foundation](docs/workspace-foundation.md) | 本地目录绑定、多 Root 与能力边界 |
| [本地数据与迁移](docs/data-and-migrations.md) | 数据目录、格式、迁移与备份策略 |
| [安全模型](docs/security-model.md) | Loopback、同源、凭据和路径安全 |
| [发布手册](docs/release.md) | 打包、签名、冒烟测试与发布流程 |
| [贡献指南](CONTRIBUTING.md) | 开发流程、质量门禁和提交要求 |
| [安全策略](SECURITY.md) | 漏洞报告方式和支持范围 |
| [版本记录](CHANGELOG.md) | 版本变化与发布记录 |
| [第三方许可证](THIRD_PARTY_LICENSES.md) | 随应用分发的软件及许可证 |

提交 Issue 或日志时，请勿包含 API Key、OAuth 凭据、本地业务文件或完整数据目录。

---

## 贡献与许可证

欢迎通过 [Issues](https://github.com/alkaiddiamond/zenme-local/issues) 报告问题或提出建议。提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

Zenme 自有代码以 [MIT License](LICENSE) 开源；随应用分发的第三方软件继续适用各自的许可证与署名要求。
