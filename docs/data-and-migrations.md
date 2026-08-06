# 本地数据与迁移

## 数据位置

桌面版默认在 Electron `userData/data` 下保存业务数据。用户可在设置页选择其他目录；选择结果保存在 `userData/desktop-config.json`。开发环境可用 `ZENME_DATA_DIR` 覆盖。

```text
zenme-data/
  settings.json
  app-shell-state.json
  projects/
    {projectId}/
      project.json
      canvas/latest.json
      canvas/thumbnail.webp
      files/
      reading/
        {assetId}/
          asset.json
          sections.json
          notes.json
          progress.json
```

桌面端新导入的音频默认不复制到 `files/original/`。项目文件索引保存经 Electron 明确选择并规范化后的外部绝对路径，画布仍只保存项目文件 ID 与 loopback 资源 URL。旧版本已经复制到项目目录的音频保持兼容。

阅读标注的 `notes.json` 可选保存 `ranges`，用于一条笔记跨多个分页记录各页的 `sectionIndex`、`offset` 和 `length`。没有 `ranges` 的旧标注继续使用顶层 `sectionIndex`、`offset` 和 `length`，无需迁移即可读取。

## 写入规则

- 动态路径必须通过 `lib/local/path-safety.ts` 限定在数据根目录内。
- 外部音频引用是唯一例外：只允许桌面模式登记用户明确选择的普通文件，并以不可猜测项目文件 ID 读取该精确路径；不得接受目录、相对路径或路径拼接。删除项目记录不得删除外部原文件。
- JSON 写入使用临时文件、同步和原子重命名，失败时保留最后一个有效版本。
- 备份恢复先进入临时目录完成结构与路径检查，再切换正式数据。
- 备份默认移除模型 API Key 和 OAuth Token。

## 迁移规则

任何持久化字段的删除、重命名、类型变化或默认值变化都必须：

1. 定义旧版本输入和新版本输出。
2. 保留未知字段，除非有明确删除决策。
3. 添加旧 fixture 回归测试。
4. 处理迁移中断和磁盘写入失败。
5. 在 `CHANGELOG.md` 记录用户影响。

Alpha 阶段也不得静默丢弃旧画布或项目数据。
