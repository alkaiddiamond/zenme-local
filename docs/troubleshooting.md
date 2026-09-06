# 故障排查

文档状态：当前用户与维护者排查入口。

## 历史改动收敛时的验证快照（2026-09-06）

本次快照用于交接已知验证结果，不代表后续版本的实时状态，也不豁免后续验证要求。

- 通过：ESLint、Vitest 1,551 项、桌面 Node 测试 25 项、生产构建、Windows 目录包构建。Vitest 另有 1 项跳过。
- 已修复（2026-09-06）：`lib/agent/workspace-tools.test.ts` 的 Corepack pnpm bridge 测试隔离不完整。测试只替换 PATH，但运行时优先查找 `ProgramFiles/nodejs/corepack.cmd`，因此调用了真实 Corepack，输出本机 pnpm 的 `11.16.0`。现使用临时安装目录与 Node 运行时路径，覆盖“缺少 pnpm 时创建 bridge”和“已有 pnpm 时不覆盖”两种情况；不更改生产命令解析逻辑。相关 4 项测试通过，日志见 `.logs/pnpm-bridge-after.log`。
- 已修复（2026-09-06）：Windows `npm run desktop:smoke` 原先直接启动 `npm.cmd`，返回 `EINVAL`，但错误输出遗漏了启动异常，只显示 `unknown error`。现通过 npm 提供的绝对 Node/npm CLI 路径执行工作区脚本，无需 shell 字符串拼接；保留启动错误、限定测试命令超时，并在预览结束时清理 Windows 子进程树。重新生成的 Windows 目录包已通过 Browser 与 Workspace 完整冒烟检查，日志见 `.logs/workspace-smoke-pack.log` 和 `.logs/workspace-smoke-after.log`。
- 后续验证（2026-09-06）：修复测试隔离与冒烟命令启动后，`npm run verify` 完整通过，包含 ESLint、Vitest 1,553 项通过 / 1 项跳过、桌面 Node 测试 29 项通过及生产构建，日志见 `.logs/workspace-smoke-verify.log`。Windows 目录包与完整冒烟检查通过。未进行安装、升级、卸载、发布审计及 macOS Intel 真机验证，不能据此宣称发布验收通过。

维护者本地日志位于 `.logs/reading-position-check.log`、`.logs/reading-position-desktop-tests.log` 和 `.logs/history-cleanup-{build,pack,smoke}.log`；日志不纳入版本控制。后续修复相关问题时应更新本节，避免将已解决的问题继续当作当前阻塞。

## 桌面窗口启动失败

1. 运行 `npm run build`，确认 Next.js 生产构建成功。
2. 检查本机安全软件是否阻止 Electron 子进程监听 `127.0.0.1`。
3. 使用临时 `ZENME_DATA_DIR` 排除损坏数据，但不要覆盖真实目录。
4. 收集脱敏后的桌面日志；不得上传 API Key 或业务文件。

## 数据目录无法切换

- 确认目录可写且不是文件。
- 确认路径没有指向安装目录、系统目录或受保护位置。
- 切换失败时保留原目录，不手工移动未完成的临时恢复目录。

## Windows 安装包被拦截

未签名 Windows Alpha 包可能触发 SmartScreen。先确认安装包来自本仓库 Releases，并核对 Release 提供的 SHA-256 与签名状态；不要建议用户长期关闭系统安全功能。

## macOS 无法打开

内部未签名包可能被 Gatekeeper 拦截。正式发布应使用 Developer ID 签名并 notarize。Intel 版本要求 macOS 12 或更高版本。

## 报告问题

Issue 应包含版本、系统、复现步骤和已脱敏日志。安全漏洞通过 `SECURITY.md` 指定的私密渠道报告。
