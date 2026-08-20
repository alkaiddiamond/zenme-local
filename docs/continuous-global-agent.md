# Continuous Global Agent

文档状态：当前后台观察循环契约；桌面端暂不提供独立配置入口。

Continuous Global Agent 是画布项目的低频观察循环。它消费项目领域事件、维护可恢复检查点并生成候选建议；它不是另一个拥有隐式写权限的聊天入口。

## 运行契约

1. Execution、ChangeSet 等生产路径在自身数据提交成功后，以 best-effort 方式追加幂等事件。观察层失败不得回滚业务数据。
2. Runner 原子领取检查点之后的有界事件批次。同一项目同时只有一个 active run。
3. 模型调用使用无工具的隔离规划模式，只能返回状态摘要、待处理项和具备事件依据的候选建议。
4. 成功时一次提交 checkpoint、token 用量和建议；失败时不推进游标，并按连续失败次数指数退避。
5. 暂停或禁用会向 active run 写入取消请求。迟到结果记为 cancelled，不推进 checkpoint。
6. 桌面应用打开时由 App Shell 中的不可见 supervisor 为所有本地项目维持唯一 driver；无论用户停留在首页、设置还是任一画布，driver 都会每 30 秒检查一次是否存在待处理事件。服务端锁、冷却时间与小时预算是最终节流边界。
7. 每个 active run 持久化当前本地服务运行实例 ID。服务重启后，状态读取与下一次领取都会把旧实例遗留的 `running` 归档为安全中断，不推进 checkpoint；同一批未处理事件随后由新实例重新领取，避免持续 Agent 永久卡死或静默丢事件。

## 控制面状态

当前生产路径保留持久化状态、服务端配置/建议 API 与 App Shell supervisor，但旧独立 Global Agent Dialog 已退役，当前桌面界面不再提供单独的 Continuous Agent 配置面板。已有配置仍可由 supervisor 恢复和运行；在新的统一管理界面落地前，不应把旧 Dialog 描述为当前用户入口。候选建议只有在被明确标记为已采纳后才可进入后续 Project Agent 上下文；采纳本身不会直接创建任务、执行命令、写文件或写入正式 Memory。

## 持久化

状态位于项目本地目录 `global-agent/continuous.json`，包含：

- mode、runtime status 与模型选择；
- 小时运行次数、token 和单批事件预算；
- durable checkpoint、active run、退避截止时间；
- 有界事件、运行历史和候选建议。

事件和建议均使用稳定幂等键。已处理事件优先清理；未处理事件不会为满足容量限制而静默丢弃。

## 安全边界

- 模型不可获得 Workspace、命令、网页或 MCP 工具。
- 候选建议必须至少引用本轮真实事件 ID；伪造或无依据建议会使本轮失败并退避。
- 领域事件只保存有界摘要，不复制完整文件、命令输出或二进制内容。
- Continuous Agent 不绕过会话权限、ChangeSet 审批和 Workspace 范围校验。
- 只有用户明确采纳的建议可以进入 Project Agent 上下文；未采纳、拒绝或忽略的建议保持隔离。

## 恢复与验证

测试覆盖默认禁用、事件去重、原子领取、成功 checkpoint、暂停取消、失败退避、小时预算、运行实例重启恢复、模型输出依据校验、API 控制、应用级唯一 driver 与唤醒条件，以及 Execution/ChangeSet 的真实事件接入。
