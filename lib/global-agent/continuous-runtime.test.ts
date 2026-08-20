import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runContinuousGlobalAgentOnce } from "@/lib/global-agent/continuous-runtime";
import { appendContinuousProjectEvent, configureContinuousGlobalAgent, getContinuousGlobalAgentState } from "@/lib/global-agent/continuous-store";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-continuous-runtime-"));
  projectId = (await createLocalProject({ name: "Continuous", prompt: "", model: "" }, dataDir)).id;
  await configureContinuousGlobalAgent({ projectId, mode: "enabled", modelId: "provider:model" }, dataDir);
});
afterEach(async () => fs.rm(dataDir, { recursive: true, force: true }));

describe("Continuous Global Agent runtime", () => {
  it("turns domain events into checkpointed candidate suggestions without tools", async () => {
    const event = await appendContinuousProjectEvent({
      projectId, type: "changeSet.changed", source: "changeSet", sourceId: "change-1", idempotencyKey: "change-1:applied",
      data: { status: "applied" },
    }, dataDir);
    let modelInput: { mode?: string; additionalAgentTools?: unknown[] } | undefined;
    const result = await runContinuousGlobalAgentOnce({ projectId }, {
      dataDir,
      callModel: async (input) => {
        modelInput = input;
        return { text: JSON.stringify({
          summary: "ChangeSet 已应用。", waitingItems: ["运行测试"],
          suggestions: [{ kind: "nextTask", title: "运行测试", summary: "验证改动", rationale: ["ChangeSet 已应用"], sourceEventIds: [event.id], idempotencyKey: "verify-change-1" }],
        }), usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } };
      },
    });
    expect(result).toMatchObject({ ran: true, state: { checkpoint: { lastProcessedSequence: event.sequence, tokensInWindow: 30 }, suggestions: [{ status: "candidate" }] } });
    expect(modelInput).toMatchObject({ mode: "agent_planning" });
  });

  it("backs off and keeps the event pending when model output is not grounded", async () => {
    await appendContinuousProjectEvent({ projectId, type: "manual.requested", source: "user", sourceId: "manual", idempotencyKey: "manual" }, dataDir);
    await expect(runContinuousGlobalAgentOnce({ projectId }, {
      dataDir,
      callModel: async () => ({ text: '{"summary":"x","waitingItems":[],"suggestions":[{"kind":"nextTask","title":"x","summary":"x","rationale":[],"sourceEventIds":["invented"],"idempotencyKey":"x"}]}', usage: null }),
    })).rejects.toThrow("缺少事件依据");
    await expect(getContinuousGlobalAgentState(projectId, dataDir)).resolves.toMatchObject({ status: "backoff", checkpoint: { lastProcessedSequence: 0, consecutiveFailures: 1 } });
  });
});
