# 节点执行与恢复

Zenme 将一次用户触发的工作记录为 `Execution`，其中每个实际执行节点对应一个
`NodeRun`，每次初次运行或重试对应一个不可覆盖的 `Attempt`。画布节点只保存便于
渲染和定位的执行 ID；完整运行证据保存在项目目录的
`executions/index.json`。

## 标识和状态

- `executionId`：一次用户触发的执行。
- `nodeRunId`：该执行中的一个节点运行。
- `attemptId`：一次具体尝试；重试会新建 Attempt，并保留旧错误和产物。
- `externalTaskId`：供应商异步任务 ID，仅属于 Attempt，不能代替内部 ID。
- 状态：`queued`、`running`、`polling`、`succeeded`、`failed`、`stopped`、
  `timedOut`、`interrupted`。

Attempt 同时保存经过大小限制的输入快照、服务商、模型、结构化错误和结果
`AssetRef`。这使重试和重启恢复不依赖临时 React 状态。

## 资产规则

远程结果不能把供应商临时 URL 作为项目资产持久化。图片和视频必须先写入项目的
本地文件仓库，再由执行 API 根据 `fileId` 建立 `AssetRef`。视频下载由本地服务完成，
只接受受信任的 HTTPS 下载域名，限制为 512 MB，并通过原子文件写入保存。

## 恢复规则

- 已成功的文本、图片和视频从 Attempt 的文本或 AssetRef 修复画布节点。
- 已获得 `externalTaskId` 的视频任务在应用重启后继续独立轮询，同一节点同时只允许
  一个轮询器。
- 文本和图片使用同步 HTTP 流，应用退出后不能续接；重启时转为带可重试错误的
  `failed`，避免永远停留在运行中。
- 活跃视频缺少 `externalTaskId` 时同样转为失败，防止重复提交供应商任务。
- 停止和重试通过项目执行 API 原子更新；重试新增 Attempt，不覆盖历史 Attempt。

## 运行前检查和端口

首批接入文本、图片和视频生成。提交前检查节点能力、提示词、模型选择和当前可用
模型。`node-capabilities.ts` 注册节点是否可执行及输入输出数据类型，连接规范化读取
该注册表，新增节点不应再扩展独立的节点类型白名单。

## 迁移

执行存储当前版本为 `1`。旧版 `version: 0` 的 `runs[].taskId` 会迁移为
`Attempt.externalTaskId` 并原地原子重写。新增字段必须保持旧记录可读取，并增加临时
数据目录回归测试。
