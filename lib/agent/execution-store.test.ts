import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAgentExecution,
  getAgentExecution,
  listAgentExecutions,
  reconcileAgentExecutionsForTurn,
  retryAgentExecution,
  stopAgentExecution,
} from "@/lib/agent/execution-store";
import { AGENT_EXECUTION_DETAIL_VERSION, type AgentExecutionDetail } from "@/lib/agent/types";
import { createLocalExecution, getLocalExecution } from "@/lib/local/execution-repository";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";
import { getContinuousGlobalAgentState } from "@/lib/global-agent/continuous-store";

let dataDir: string;
let workspaceRoot: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-execution-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-execution-workspace-"));
  projectId = (await createLocalProject({ name: "Agent execution", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
});

describe("agent execution store", () => {
  it("persists selected canvas and file context beside an agent Execution", async () => {
    const created = await createAgentExecution({
      projectId,
      instruction: "Review this project",
      resultNodeId: "result",
      triggerNodeId: "request",
      selectedNodeIds: ["node-a", "node-a", "node-b"],
      fileDocumentIds: ["file-a"],
      canvasContext: "selected context",
      currentNodeContext: "CURRENT_NODE_LAYER",
      connectedGraphContext: "CONNECTED_GRAPH_LAYER",
      conversationId: "conversation-a",
    }, dataDir);

    expect(created.execution).toMatchObject({
      id: created.detail.id,
      status: "running",
      nodeRuns: [{ kind: "agent" }],
    });
    await expect(getAgentExecution(projectId, created.detail.id, dataDir)).resolves.toMatchObject({
      instruction: "Review this project",
      context: {
        contextSnapshot: {
          version: 1,
          instruction: { prompt: "Review this project" },
          currentNode: { content: "CURRENT_NODE_LAYER" },
          graph: { connectedContext: "CONNECTED_GRAPH_LAYER" },
          conversation: { conversationId: "conversation-a" },
          references: { selectedNodeIds: ["node-a", "node-a", "node-b"], fileDocumentIds: ["file-a"] },
        },
        selectedNodeIds: ["node-a", "node-b"],
        fileDocumentIds: ["file-a"],
        canvasContext: "selected context",
        currentNodeContext: "CURRENT_NODE_LAYER",
        connectedGraphContext: "CONNECTED_GRAPH_LAYER",
        conversationId: "conversation-a",
      },
      stage: "planning",
    });
    await expect(getContinuousGlobalAgentState(projectId, dataDir)).resolves.toMatchObject({
      events: [expect.objectContaining({ type: "execution.changed", sourceId: created.detail.id, data: expect.objectContaining({ status: "running", stage: "planning" }) })],
    });
  });

  it("marks an orphaned active execution interrupted but preserves durable waiting states", async () => {
    const interrupted = await writeManualDetail("manual-running", "running", "searching");
    const waiting = await writeManualDetail("manual-waiting", "running", "waitingApproval");
    const waitingInput = await writeManualDetail("manual-input", "running", "waitingInput");

    const details = await listAgentExecutions(projectId, dataDir);
    expect(details).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: interrupted.id, status: "interrupted", stage: "interrupted" }),
      expect.objectContaining({ id: waiting.id, status: "running", stage: "waitingApproval" }),
      expect.objectContaining({ id: waitingInput.id, status: "running", stage: "waitingInput" }),
    ]));
    await expect(getLocalExecution({ projectId, executionId: interrupted.id }, dataDir)).resolves.toMatchObject({
      nodeRuns: [{ attempts: [{ status: "interrupted" }] }],
    });
  });

  it("retries an interrupted execution with a new Attempt and keeps unknown fields", async () => {
    const manual = await writeManualDetail("manual-retry", "running", "reading", { futureField: { enabled: true } });
    await getAgentExecution(projectId, manual.id, dataDir);
    const retried = await retryAgentExecution(projectId, manual.id, dataDir);

    expect(retried.detail).toMatchObject({
      id: manual.id,
      stage: "planning",
      status: "running",
      futureField: { enabled: true },
    });
    expect(retried.detail.attemptId).not.toBe(manual.attemptId);
    expect(retried.execution.nodeRuns[0].attempts).toHaveLength(2);
  });

  it("idempotently reconciles only running executions owned by a terminal Turn", async () => {
    const matching = await createAgentExecution({
      projectId,
      instruction: "Finish this turn",
      resultNodeId: "terminal-turn",
      triggerNodeId: "terminal-turn",
    }, dataDir);
    const unrelated = await createAgentExecution({
      projectId,
      instruction: "Keep running",
      resultNodeId: "other-turn",
      triggerNodeId: "other-turn",
    }, dataDir);

    await expect(reconcileAgentExecutionsForTurn({
      projectId,
      turnId: "terminal-turn",
      status: "failed",
      error: "terminal failure",
      summary: "terminal failure",
    }, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: matching.detail.id, status: "failed", stage: "failed" }),
    ]);
    await expect(reconcileAgentExecutionsForTurn({
      projectId,
      turnId: "terminal-turn",
      status: "failed",
      error: "terminal failure",
    }, dataDir)).resolves.toEqual([]);
    await expect(getAgentExecution(projectId, unrelated.detail.id, dataDir)).resolves.toMatchObject({ status: "running" });
    await stopAgentExecution(projectId, unrelated.detail.id, dataDir);
  });

  it("shares active execution liveness across isolated route module instances", async () => {
    const created = await createAgentExecution({
      projectId,
      instruction: "Continue across route bundles",
      resultNodeId: "result-shared-runtime",
      triggerNodeId: "request-shared-runtime",
    }, dataDir);

    vi.resetModules();
    const isolatedStore = await import("@/lib/agent/execution-store");
    await expect(isolatedStore.getAgentExecution(projectId, created.detail.id, dataDir)).resolves.toMatchObject({
      stage: "planning",
      status: "running",
    });
    await isolatedStore.stopAgentExecution(projectId, created.detail.id, dataDir);
  });
});

async function writeManualDetail(
  executionId: string,
  status: AgentExecutionDetail["status"],
  stage: AgentExecutionDetail["stage"],
  extra: Record<string, unknown> = {},
) {
  const nodeRunId = `${executionId}-run`;
  const attemptId = `${executionId}-attempt`;
  const now = new Date().toISOString();
  await createLocalExecution({
    projectId,
    executionId,
    nodeRunId,
    attemptId,
    nodeId: `${executionId}-node`,
    triggerNodeId: `${executionId}-trigger`,
    kind: "agent",
    input: { prompt: executionId },
  }, dataDir);
  const detail: AgentExecutionDetail = {
    ...extra,
    version: AGENT_EXECUTION_DETAIL_VERSION,
    id: executionId,
    projectId,
    nodeRunId,
    attemptId,
    agentId: "global-agent",
    instruction: executionId,
    context: { selectedNodeIds: [], fileDocumentIds: [], canvasContext: "" },
    stage,
    status,
    toolCalls: [],
    commandRequests: [],
    changeSetIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const directory = path.join(dataDir, "projects", projectId, "executions", "agent");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${executionId}.json`), JSON.stringify(detail));
  return detail;
}
