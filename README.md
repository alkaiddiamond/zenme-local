# Zenme Local

Zenme Local 是一个纯本地的 AI 无限画布桌面应用。正式产品入口为 Electron 窗口；Next.js 只作为绑定在 `127.0.0.1` 的本地应用服务。项目、画布、文件、阅读资料、笔记与设置全部保存在本机数据目录中，不需要账号或远程数据库。

## 当前能力

- 项目创建、搜索、重命名、置顶式固定顺序管理与多 Tab 切换。
- 无限画布、节点连线、分组、撤销重做、缩放和平移。
- 统一文本节点，支持纯文本、Markdown、代码显示与基于节点内容继续生成。
- 图片节点与图片编辑节点，支持固定预览尺寸、重新编辑覆盖、全屏查看和下载。
- PDF、EPUB、TXT 阅读器，支持目录、进度、笔记、标注和笔记节点。
- Zhipu、OpenRouter 等模型服务商配置、模型模态、别名、启用状态和最近模型偏好。
- 本地数据目录选择、备份与恢复；备份默认移除模型 API Key。

## 开发与验证

```powershell
npm install
npm run dev
npm run lint
npm test
npm run build
```

桌面开发与目录包：

```powershell
npm run desktop:dev
npm run desktop:pack -- --publish never
```

桌面输出位于 `dist-desktop/`。

## 数据目录

桌面版默认使用 Electron `userData` 下的数据目录，也可以在设置页切换。开发时可通过 `ZENME_DATA_DIR` 指定：

```powershell
$env:ZENME_DATA_DIR="G:\data\zenme"
npm run dev
```

主要结构：

```text
zenme-data/
  settings.json
  projects/
    {projectId}/
      project.json
      canvas/latest.json
      canvas/thumbnail.webp
      files/
      reading/
```

业务文件只写入数据目录。所有动态路径均经过路径安全校验，备份恢复采用临时目录校验与原子切换。

## 配置安全

- API Key 只保存在本机 `settings.json`，不得提交到仓库。
- 本地 API 仅接受 loopback、同源请求。
- 备份包不包含模型 API Key，恢复后需要重新填写密钥。
- `.env.example` 仅提供可选的本地开发配置示例。

产品基线见 [docs/prd.md](docs/prd.md)，里程碑说明见 [docs/milestone-v0.1.0.md](docs/milestone-v0.1.0.md)。
