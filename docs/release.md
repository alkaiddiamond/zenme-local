# 发布手册

> 当前公开发布目标仅为 Windows x64。macOS Intel 构建配置保留，但自动验证与公开发布已暂停；恢复工作跟踪在 GitHub Issue #9。

## 支持矩阵

| 平台 | 架构 | 最低版本 | 正式产物 |
| --- | --- | --- | --- |
| Windows | x64 | Windows 10 | NSIS `.exe` |
| macOS | Intel x64 | macOS 12 Monterey | 暂停发布 |

Apple Silicon 原生包和 Linux 尚未进入 v0.1.0 发布范围。

## 发布门禁

所有平台发布前必须完成：

```bash
npm ci
npm run verify
npm run audit:prod
npm run licenses:check
```

并确认：

- `npm audit --omit=dev` 使用可用 registry 完成，风险已经处置或记录。
- `package.json`、`CHANGELOG.md` 和 Git tag 版本一致。
- 工作区没有真实数据、密钥、日志、截图或生成缓存被跟踪。
- 第三方许可清单已重新生成并审核。
- 备份恢复、数据目录切换和旧数据打开完成真机验证。

## Windows x64

```powershell
npm run build
npm run desktop:dist:win
```

正式产物必须完成 Authenticode 签名。安装后验证：

1. 全新安装与首次启动。
2. 自定义安装目录。
3. 覆盖升级并保留数据。
4. 卸载不删除用户数据。
5. NSIS 安装后的 `Zenme.exe` 冷启动和核心流程。

目录包可以使用 `npm run desktop:pack && npm run desktop:smoke` 自动检查，但不能替代安装、升级和卸载测试。

## macOS Intel x64

必须在 Intel macOS runner 或 Intel 真机执行：

```bash
npm run build
npm run desktop:dist:mac:intel
```

公开产物必须使用 Apple Developer ID Application 签名，并完成 notarization 与 stapling。验证：

1. `codesign --verify --deep --strict --verbose=2`。
2. `spctl --assess --type execute --verbose=4`。
3. DMG 挂载、拖入 Applications、首次冷启动。
4. macOS 12 Intel 真机核心流程与数据保留。

GitHub Actions 的无签名产物仅用于证明构建链，不得发布给普通用户。

## 发布步骤

1. 冻结范围，更新 `CHANGELOG.md` 的版本和日期。
2. 运行所有门禁和平台真机检查。
3. 创建版本提交与 `vX.Y.Z` tag。
4. 从受保护的发布 workflow 生成签名产物。
5. 核对 SHA-256、签名、文件名和安装结果。
6. 创建 GitHub Release，附变更、已知问题、系统要求和校验和。
7. 发布后从 Releases 页面重新下载并执行一次安装冒烟测试。

## 回滚

如果产物、签名或数据兼容存在问题，立即将 Release 标记为 pre-release 或撤下附件，保留 tag 和故障记录。不得用相同版本号静默替换二进制文件；修复后发布新的补丁版本。
