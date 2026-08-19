import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendProjectAgentEvent,
  calculateProjectAgentContextBudget,
  canAttemptProjectAgentCompaction,
  createProjectAgentCompactCheckpoint,
  getEffectiveProjectAgentContext,
  getProjectAgentModelContext,
  getProjectAgentSession,
  recordProjectAgentCompactionFailure,
  shouldCompactProjectAgentContext,
  clearProjectAgentAnswerDraft,
  createProjectAgentTask,
  getProjectAgentTask,
  listProjectAgentTasks,
  updateProjectAgentContext,
  updateProjectAgentEvent,
  updateProjectAgentTask,
  updateProjectAgentTaskPlan,
  upsertProjectAgentAnswerDraft,
} from "@/lib/agent/project-session-store";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-agent-session-"));
  projectId = (await createLocalProject({ name: "Project session", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("project agent session store", () => {
  it("maintains atomic shared tasks with dependencies across Agent turns", async () => {
    const inspect = await createProjectAgentTask({
      projectId,
      subject: "检查现有实现",
      description: "阅读生产路径和回归测试",
      owner: "parent",
    }, dataDir);
    const fix = await createProjectAgentTask({
      projectId,
      subject: "修复缺陷",
      description: "根据检查结果实现修复",
      blockedBy: [inspect.id],
    }, dataDir);

    expect(await getProjectAgentTask(projectId, fix.id, dataDir)).toMatchObject({
      content: "修复缺陷",
      description: "根据检查结果实现修复",
      blockedBy: [inspect.id],
      status: "pending",
    });
    expect(await listProjectAgentTasks(projectId, dataDir)).toEqual([
      expect.objectContaining({ id: inspect.id, owner: "parent", blockedBy: [] }),
      expect.objectContaining({ id: fix.id, blockedBy: [inspect.id] }),
    ]);

    await updateProjectAgentTask({ projectId, taskId: inspect.id, status: "completed" }, dataDir);
    expect((await listProjectAgentTasks(projectId, dataDir)).find((task) => task.id === fix.id)?.blockedBy).toEqual([]);
    await Promise.all([
      updateProjectAgentTask({ projectId, taskId: fix.id, owner: "subagent-a" }, dataDir),
      updateProjectAgentTask({ projectId, taskId: fix.id, status: "in_progress" }, dataDir),
    ]);
    expect(await getProjectAgentTask(projectId, fix.id, dataDir)).toMatchObject({ owner: "subagent-a", status: "in_progress" });
    await expect(updateProjectAgentTask({
      projectId,
      taskId: inspect.id,
      addBlockedBy: [fix.id],
    }, dataDir)).rejects.toThrow("依赖");
  });

  it("creates one stable session for the project and appends a chronological waterfall", async () => {
    const first = await getProjectAgentSession(projectId, dataDir);
    const turnId = "turn-1";
    await Promise.all([
      appendProjectAgentEvent({ projectId, turnId, type: "user", content: "检查项目" }, dataDir),
      appendProjectAgentEvent({ projectId, turnId, type: "status", data: { stage: "planning" } }, dataDir),
      appendProjectAgentEvent({ projectId, turnId, type: "assistant", content: "开始检查" }, dataDir),
    ]);

    const reloaded = await getProjectAgentSession(projectId, dataDir);
    expect(reloaded.id).toBe(first.id);
    expect(reloaded.events).toHaveLength(3);
    expect(reloaded.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(reloaded.events.every((event) => event.turnId === turnId)).toBe(true);
  });

  it("persists conversation roots and fork metadata alongside the project event store", async () => {
    await appendProjectAgentEvent({
      projectId,
      turnId: "turn-a",
      conversationId: "conv-a",
      sourceNodeId: "node-a",
      type: "user",
      content: "A",
    }, dataDir);
    await appendProjectAgentEvent({
      projectId,
      turnId: "turn-b",
      conversationId: "conv-b",
      parentConversationIds: ["conv-a"],
      parentTurnId: "turn-a",
      sourceNodeId: "node-b",
      type: "user",
      content: "B",
    }, dataDir);

    expect((await getProjectAgentSession(projectId, dataDir)).conversations).toEqual([
      expect.objectContaining({
        id: "conv-a",
        rootNodeId: "node-a",
      }),
      expect.objectContaining({
        id: "conv-b",
        rootNodeId: "node-b",
        parentConversationIds: ["conv-a"],
        forkedFromTurnId: "turn-a",
      }),
    ]);
  });

  it("updates one active tool event in place for streamed progress", async () => {
    const active = await appendProjectAgentEvent({
      projectId,
      turnId: "progress-turn",
      type: "toolCall",
      data: { name: "run_command", status: "running" },
    }, dataDir);

    const updated = await updateProjectAgentEvent({
      projectId,
      eventId: active.id,
      content: "server ready",
      data: { elapsedMs: 2_500, stdoutTail: "server ready" },
    }, dataDir);

    expect(updated).toMatchObject({
      id: active.id,
      sequence: active.sequence,
      content: "server ready",
      data: { name: "run_command", status: "running", elapsedMs: 2_500, stdoutTail: "server ready" },
    });
    expect((await getProjectAgentSession(projectId, dataDir)).events).toHaveLength(1);
  });

  it("persists a project-session permission override independently from global defaults", async () => {
    await updateProjectAgentContext({ projectId, permissionMode: "untrusted" }, dataDir);
    expect((await getProjectAgentSession(projectId, dataDir)).context.permissionMode).toBe("untrusted");
    await updateProjectAgentContext({ projectId, modelId: "provider:model" }, dataDir);
    expect((await getProjectAgentSession(projectId, dataDir)).context).toMatchObject({
      modelId: "provider:model",
      permissionMode: "untrusted",
    });
  });

  it("persists Plan Mode and its active plan as project-session state", async () => {
    await updateProjectAgentContext({
      projectId,
      interactionMode: "plan",
      activePlan: "## 实施计划\n1. 检查现有实现",
    }, dataDir);

    expect((await getProjectAgentSession(projectId, dataDir)).context).toMatchObject({
      interactionMode: "plan",
      activePlan: "## 实施计划\n1. 检查现有实现",
    });
    expect(await getProjectAgentModelContext(projectId, dataDir)).toMatchObject({
      interactionMode: "plan",
      activePlan: "## 实施计划\n1. 检查现有实现",
    });

    await updateProjectAgentContext({ projectId, interactionMode: "default", activePlan: null }, dataDir);
    expect((await getProjectAgentSession(projectId, dataDir)).context).toMatchObject({ interactionMode: "default" });
    expect((await getProjectAgentSession(projectId, dataDir)).context.activePlan).toBeUndefined();
  });

  it("keeps one mutable assistant draft out of durable model context", async () => {
    const first = await upsertProjectAgentAnswerDraft({
      projectId,
      turnId: "streaming-turn",
      content: "正在生成",
    }, dataDir);
    const updated = await upsertProjectAgentAnswerDraft({
      projectId,
      turnId: "streaming-turn",
      content: "正在生成最终答复",
    }, dataDir);

    expect(updated.id).toBe(first.id);
    expect((await getProjectAgentSession(projectId, dataDir)).events).toEqual([
      expect.objectContaining({ id: first.id, type: "assistantDraft", content: "正在生成最终答复" }),
    ]);
    expect((await getProjectAgentModelContext(projectId, dataDir)).events).toEqual([]);

    await clearProjectAgentAnswerDraft({ projectId, turnId: "streaming-turn" }, dataDir);
    expect((await getProjectAgentSession(projectId, dataDir)).events).toEqual([]);
  });

  it("keeps full Shell records durably but projects cc-haha-style background results to the model", async () => {
    const outputFilePath = path.join(dataDir, "tasks", "command.log");
    const persistedOutput = {
      id: "command-1",
      executable: "pnpm",
      args: ["run", "dev"],
      cwd: ".",
      timeoutMs: 120_000,
      reason: "启动开发模式",
      status: "running",
      outputFilePath,
      processId: 1234,
      stdout: "Local: http://127.0.0.1:5173/",
      stderr: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const event = await appendProjectAgentEvent({
      projectId,
      turnId: "background-shell-turn",
      type: "toolResult",
      content: "pnpm run dev\nLocal: http://127.0.0.1:5173/",
      data: { name: "shell_command", status: "succeeded", output: persistedOutput },
    }, dataDir);

    const durableEvent = (await getProjectAgentSession(projectId, dataDir)).events.find((item) => item.id === event.id);
    expect(durableEvent?.data?.output).toEqual(persistedOutput);

    const modelEvent = (await getProjectAgentModelContext(projectId, dataDir)).events.find((item) => item.id === event.id);
    expect(modelEvent).toMatchObject({
      content: `Command running in background with ID: command-1. Output is being written to: ${outputFilePath}.`,
      data: {
        name: "shell_command",
        output: `Command running in background with ID: command-1. Output is being written to: ${outputFilePath}.`,
      },
    });
    expect(JSON.stringify(modelEvent)).not.toContain("processId");
    expect(JSON.stringify(modelEvent)).not.toContain("启动开发模式");
  });

  it("keeps the active task plan outside transcript compaction and clears it when all items complete", async () => {
    const plan = [
      { id: "inspect", content: "检查实现", status: "completed" as const },
      { id: "fix", content: "修复缺陷", status: "in_progress" as const },
    ];
    await updateProjectAgentTaskPlan({ projectId, items: plan }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "old", type: "user", content: "旧任务" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "old", type: "assistant", content: "处理中" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "new", type: "user", content: "继续" }, dataDir);
    await createProjectAgentCompactCheckpoint({
      projectId,
      summary: "已完成检查，正在修复缺陷。",
      compactedThroughSequence: 2,
      sourceTokenEstimate: 20,
    }, dataDir);

    expect((await getProjectAgentModelContext(projectId, dataDir)).taskPlan).toEqual(plan);
    await updateProjectAgentTaskPlan({
      projectId,
      items: plan.map((item) => ({ ...item, status: "completed" as const })),
    }, dataDir);
    expect((await getProjectAgentSession(projectId, dataDir)).taskPlan).toEqual([]);
  });

  it("keeps the complete event log while effective context starts at the latest compact boundary", async () => {
    const first = await appendProjectAgentEvent({ projectId, type: "user", content: "旧问题" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: first.turnId, type: "assistant", content: "旧回答" }, dataDir);
    await appendProjectAgentEvent({ projectId, type: "user", content: "继续执行" }, dataDir);
    const checkpoint = await createProjectAgentCompactCheckpoint({
      projectId,
      summary: "用户此前要求检查项目，Agent 已完成初步回答。",
      compactedThroughSequence: 2,
      sourceTokenEstimate: 50_000,
    }, dataDir);

    const fullSession = await getProjectAgentSession(projectId, dataDir);
    const effective = await getEffectiveProjectAgentContext(projectId, dataDir);
    expect(fullSession.events.map((event) => event.type)).toEqual(["user", "assistant", "user", "compact"]);
    expect(fullSession.compactCheckpoints).toEqual([expect.objectContaining({ id: checkpoint.id })]);
    expect(effective).toMatchObject({
      summary: "用户此前要求检查项目，Agent 已完成初步回答。",
      compactedThroughSequence: 2,
      events: [expect.objectContaining({ type: "user", content: "继续执行" })],
    });
  });

  it("preserves unknown session, context and event fields when loading and writing", async () => {
    const session = await getProjectAgentSession(projectId, dataDir);
    const filePath = path.join(dataDir, "projects", projectId, "agent", "session.json");
    const legacyContext = { ...session.context } as Partial<typeof session.context>;
    delete legacyContext.consecutiveCompactionFailures;
    await fs.writeFile(filePath, JSON.stringify({
      ...session,
      futureSessionField: { enabled: true },
      context: { ...legacyContext, futureContextField: "kept" },
      events: [{
        id: "old-event",
        sequence: 1,
        turnId: "old-turn",
        type: "user",
        createdAt: new Date().toISOString(),
        content: "旧 fixture",
        futureEventField: 42,
      }],
    }));

    await updateProjectAgentContext({ projectId, modelId: "gpt-5.6-sol", contextWindowTokens: 1_000_000 }, dataDir);
    const reloaded = await getProjectAgentSession(projectId, dataDir);
    expect(reloaded).toMatchObject({
      futureSessionField: { enabled: true },
      context: {
        futureContextField: "kept",
        contextWindowTokens: 1_000_000,
        consecutiveCompactionFailures: 0,
      },
      events: [{ futureEventField: 42 }],
    });
  });

  it("derives compaction thresholds from the selected model context window", () => {
    expect(calculateProjectAgentContextBudget(1_000_000)).toEqual({
      contextWindowTokens: 1_000_000,
      reservedOutputTokens: 20_000,
      effectiveContextWindowTokens: 980_000,
      compactBufferTokens: 13_000,
      compactAtTokens: 967_000,
    });
    expect(calculateProjectAgentContextBudget(128_000).compactAtTokens).toBe(95_000);
    expect(calculateProjectAgentContextBudget(32_000).compactAtTokens).toBe(16_000);
    expect(shouldCompactProjectAgentContext({ contextWindowTokens: 1_000_000, effectiveTokens: 966_999 })).toBe(false);
    expect(shouldCompactProjectAgentContext({ contextWindowTokens: 1_000_000, effectiveTokens: 967_000 })).toBe(true);
  });

  it("projects old tool results without changing the durable waterfall", async () => {
    for (let index = 0; index < 7; index += 1) {
      await appendProjectAgentEvent({
        projectId,
        turnId: `tool-turn-${index}`,
        type: "toolResult",
        content: `output-${index}`,
        data: { name: "read_file", toolCallId: `tool-${index}`, output: "x".repeat(10_000) },
      }, dataDir);
    }
    await appendProjectAgentEvent({ projectId, turnId: "current", type: "user", content: "继续" }, dataDir);

    const modelContext = await getProjectAgentModelContext(projectId, dataDir);
    const durable = await getProjectAgentSession(projectId, dataDir);
    expect(modelContext.clearedToolResultEventIds).toHaveLength(2);
    expect(modelContext.events[0]?.content).toBe("[Old tool result content cleared]");
    expect(durable.events[0]?.content).toBe("output-0");
  });

  it("keeps delegated UI projections durable without sending them back to the model", async () => {
    await appendProjectAgentEvent({
      projectId,
      turnId: "delegated-turn",
      type: "toolCall",
      content: "子任务：正在读取文件",
      data: { delegated: true, delegatedSourceId: "tool:1", uiProjection: true },
    }, dataDir);
    await appendProjectAgentEvent({
      projectId,
      turnId: "delegated-turn",
      type: "status",
      data: { stage: "delegating" },
    }, dataDir);

    expect((await getProjectAgentSession(projectId, dataDir)).events).toHaveLength(2);
    expect((await getEffectiveProjectAgentContext(projectId, dataDir)).events.map((event) => event.type))
      .toEqual(["status"]);
    expect((await getProjectAgentModelContext(projectId, dataDir)).events.map((event) => event.type))
      .toEqual(["status"]);
  });

  it("stops compaction retries after three failures and resets after a successful checkpoint", async () => {
    await appendProjectAgentEvent({ projectId, turnId: "old", type: "user", content: "旧内容" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "current", type: "user", content: "新内容" }, dataDir);
    await expect(recordProjectAgentCompactionFailure({ projectId, code: "summary_failed" }, dataDir))
      .resolves.toEqual({ consecutiveFailures: 1, canRetry: true });
    await recordProjectAgentCompactionFailure({ projectId, code: "summary_failed" }, dataDir);
    await expect(recordProjectAgentCompactionFailure({ projectId, code: "summary_failed" }, dataDir))
      .resolves.toEqual({ consecutiveFailures: 3, canRetry: false });
    expect(canAttemptProjectAgentCompaction(await getProjectAgentSession(projectId, dataDir))).toBe(false);

    await createProjectAgentCompactCheckpoint({
      projectId,
      summary: "旧内容摘要",
      compactedThroughSequence: 1,
      sourceTokenEstimate: 10,
    }, dataDir);
    const recovered = await getProjectAgentSession(projectId, dataDir);
    expect(recovered.context).toMatchObject({ consecutiveCompactionFailures: 0 });
    expect(recovered.context.compactionBlockedAt).toBeUndefined();
    expect(canAttemptProjectAgentCompaction(recovered)).toBe(true);
  });

  it("rejects compact boundaries that split a turn or cross pending approval", async () => {
    await appendProjectAgentEvent({ projectId, turnId: "turn-1", type: "user", content: "执行命令" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-1", type: "approval", data: { status: "pending" } }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-2", type: "user", content: "稍后继续" }, dataDir);

    await expect(createProjectAgentCompactCheckpoint({
      projectId,
      summary: "不应成功",
      compactedThroughSequence: 1,
      sourceTokenEstimate: 10,
    }, dataDir)).rejects.toThrow("不能拆分同一 Turn");
    await expect(createProjectAgentCompactCheckpoint({
      projectId,
      summary: "仍不应成功",
      compactedThroughSequence: 2,
      sourceTokenEstimate: 10,
    }, dataDir)).rejects.toThrow("不能越过待审批");
  });
});
