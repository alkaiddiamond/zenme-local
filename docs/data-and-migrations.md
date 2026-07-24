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
```

## 写入规则

- 动态路径必须通过 `lib/local/path-safety.ts` 限定在数据根目录内。
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
