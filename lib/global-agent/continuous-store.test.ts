import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendContinuousProjectEvent,
  claimContinuousAgentRun,
  completeContinuousAgentRun,
  configureContinuousGlobalAgent,
  failContinuousAgentRun,
  getAcceptedContinuousAgentSuggestions,
  getContinuousGlobalAgentState,
  reconcileContinuousAgentRuntime,
  updateContinuousAgentSuggestion,
} from "@/lib/global-agent/continuous-store";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-continuous-agent-"));
  projectId = (await createLocalProject({ name: "Continuous", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 20 });
});

describe("Continuous Global Agent checkpoint", () => {
  it("is disabled by default and deduplicates project events", async () => {
    await expect(getContinuousGlobalAgentState(projectId, dataDir)).resolves.toMatchObject({ mode: "disabled", status: "disabled" });
    const first = await appendContinuousProjectEvent({
      projectId, type: "execution.changed", source: "execution", sourceId: "execution-1",
      idempotencyKey: "execution-1:completed", data: { status: "completed" },
    }, dataDir);
    const duplicate = await appendContinuousProjectEvent({
      projectId, type: "execution.changed", source: "execution", sourceId: "execution-1",
      idempotencyKey: "execution-1:completed", data: { status: "completed" },
    }, dataDir);
    expect(duplicate.id).toBe(first.id);
    expect((await getContinuousGlobalAgentState(projectId, dataDir)).events).toHaveLength(1);
    await expect(claimContinuousAgentRun(projectId, dataDir)).resolves.toBeNull();
  });

  it("claims pending events once and resumes from a durable checkpoint", async () => {
    await configureContinuousGlobalAgent({ projectId, mode: "enabled", modelId: "provider:model" }, dataDir);
    const event = await appendContinuousProjectEvent({
      projectId, type: "changeSet.changed", source: "changeSet", sourceId: "change-1",
      idempotencyKey: "change-1:applied", data: { status: "applied" },
    }, dataDir);
    const claimed = await claimContinuousAgentRun(projectId, dataDir);
    expect(claimed).toMatchObject({ events: [{ id: event.id }] });
    await expect(claimContinuousAgentRun(projectId, dataDir)).resolves.toBeNull();
    const completed = await completeContinuousAgentRun({
      projectId,
      runId: claimed!.run.id,
      contextSummary: "ChangeSet 已应用，等待验证。",
      waitingItems: ["运行相关测试"],
      inputTokens: 100,
      outputTokens: 50,
      suggestions: [{
        kind: "nextTask", title: "运行测试", summary: "验证 ChangeSet", rationale: ["文件已修改"],
        sourceEventIds: [event.id], idempotencyKey: "test-change-1",
      }],
    }, dataDir);
    expect(completed).toMatchObject({
      status: "idle",
      checkpoint: { lastProcessedSequence: event.sequence, contextSummary: "ChangeSet 已应用，等待验证。", tokensInWindow: 150 },
      suggestions: [{ status: "candidate", title: "运行测试" }],
    });
    await expect(claimContinuousAgentRun(projectId, dataDir)).resolves.toBeNull();
  });

  it("exposes only explicitly accepted suggestions to the Project Agent", async () => {
    await configureContinuousGlobalAgent({ projectId, mode: "enabled" }, dataDir);
    const event = await appendContinuousProjectEvent({
      projectId, type: "task.changed", source: "task", sourceId: "task-1", idempotencyKey: "task-1:changed",
    }, dataDir);
    const claimed = await claimContinuousAgentRun(projectId, dataDir);
    const state = await completeContinuousAgentRun({
      projectId,
      runId: claimed!.run.id,
      suggestions: [
        {
          kind: "nextTask", title: "采纳的后续任务", summary: "运行受影响模块的测试", rationale: ["任务已变更"],
          sourceEventIds: [event.id], idempotencyKey: "accepted-task",
        },
        {
          kind: "knowledgeReview", title: "仍是候选", summary: "检查知识索引", rationale: ["任务已变更"],
          sourceEventIds: [event.id], idempotencyKey: "candidate-review",
        },
      ],
    }, dataDir);
    await updateContinuousAgentSuggestion({
      projectId,
      suggestionId: state.suggestions.find((item) => item.idempotencyKey === "accepted-task")!.id,
      status: "accepted",
    }, dataDir);

    await expect(getAcceptedContinuousAgentSuggestions(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ title: "采纳的后续任务", status: "accepted" }),
    ]);
  });

  it("pauses an active run without advancing its checkpoint", async () => {
    await configureContinuousGlobalAgent({ projectId, mode: "enabled" }, dataDir);
    await appendContinuousProjectEvent({
      projectId, type: "manual.requested", source: "user", sourceId: "manual-1", idempotencyKey: "manual-1",
    }, dataDir);
    const claimed = await claimContinuousAgentRun(projectId, dataDir);
    await configureContinuousGlobalAgent({ projectId, mode: "paused" }, dataDir);
    const state = await completeContinuousAgentRun({ projectId, runId: claimed!.run.id, contextSummary: "不应提交" }, dataDir);
    expect(state).toMatchObject({ mode: "paused", status: "paused", checkpoint: { lastProcessedSequence: 0 } });
    expect(state.runs.at(-1)?.status).toBe("cancelled");
  });

  it("backs off after failure and enforces the hourly run budget", async () => {
    const now = new Date("2026-08-14T00:00:00.000Z");
    await configureContinuousGlobalAgent({ projectId, mode: "enabled", budget: { maxRunsPerHour: 1, cooldownMs: 1_000 } }, dataDir);
    await appendContinuousProjectEvent({
      projectId, type: "manual.requested", source: "user", sourceId: "manual-2", idempotencyKey: "manual-2",
    }, dataDir);
    const claimed = await claimContinuousAgentRun(projectId, dataDir, now);
    const failed = await failContinuousAgentRun({ projectId, runId: claimed!.run.id, error: "provider unavailable" }, dataDir, now);
    expect(failed).toMatchObject({ status: "backoff", checkpoint: { consecutiveFailures: 1 } });
    await expect(claimContinuousAgentRun(projectId, dataDir, new Date(now.getTime() + 2_000))).resolves.toBeNull();
  });

  it("recovers an active run owned by a previous local service instance", async () => {
    await configureContinuousGlobalAgent({ projectId, mode: "enabled" }, dataDir);
    const event = await appendContinuousProjectEvent({
      projectId, type: "manual.requested", source: "user", sourceId: "restart", idempotencyKey: "restart",
    }, dataDir);
    const first = await claimContinuousAgentRun(projectId, dataDir, new Date("2026-08-14T01:00:00.000Z"), "runtime-before-restart");
    expect(first?.run.runtimeInstanceId).toBe("runtime-before-restart");

    const recovered = await reconcileContinuousAgentRuntime(
      projectId,
      "runtime-after-restart",
      dataDir,
      new Date("2026-08-14T01:01:00.000Z"),
    );
    expect(recovered).toMatchObject({
      status: "idle",
      checkpoint: { lastProcessedSequence: 0 },
      runs: [{ id: first!.run.id, status: "failed", error: expect.stringContaining("本地服务已重启") }],
    });

    const retried = await claimContinuousAgentRun(
      projectId,
      dataDir,
      new Date("2026-08-14T01:01:01.000Z"),
      "runtime-after-restart",
    );
    expect(retried).toMatchObject({ events: [{ id: event.id }], run: { runtimeInstanceId: "runtime-after-restart" } });
  });
});
