import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  commandApproval: vi.fn(),
  steer: vi.fn(),
  stop: vi.fn(),
  active: vi.fn(),
}));

vi.mock("@/lib/agent/project-turn-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent/project-turn-runtime")>("@/lib/agent/project-turn-runtime");
  return { ...actual, isProjectAgentTurnRunActive: mocks.active, resolveProjectAgentTurnCommandApproval: mocks.commandApproval, startProjectAgentTurnRun: mocks.start, steerProjectAgentTurnRun: mocks.steer, stopProjectAgentTurnRun: mocks.stop };
});

import { DELETE, GET, POST } from "@/app/api/projects/[projectId]/agent-session/turns/route";
import { createAgentExecution, getAgentExecution } from "@/lib/agent/execution-store";
import { appendProjectAgentEvent, getProjectAgentSession } from "@/lib/agent/project-session-store";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.active.mockReturnValue(false);
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-turn-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  projectId = (await createLocalProject({ name: "Turn API", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("Project Agent detached Turn API", () => {
  it("starts a server-owned job and returns immediately", async () => {
    mocks.start.mockResolvedValue({ started: true, turnId: "turn-1" });
    const response = await POST(new Request("http://localhost/turns", {
      method: "POST",
      body: JSON.stringify({ prompt: "检查项目", model: "provider:model", turnId: "turn-1", permissionMode: "untrusted" }),
    }), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "running", turnId: "turn-1" });
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ projectId, turnId: "turn-1", permissionMode: "untrusted" }));
  });

  it("forwards a structured question answer when resuming the same Turn", async () => {
    mocks.start.mockResolvedValue({ started: true, turnId: "turn-answer" });
    const response = await POST(new Request("http://localhost/turns", {
      method: "POST",
      body: JSON.stringify({
        prompt: "用户回答：核心工具",
        model: "provider:model",
        turnId: "turn-answer",
        resume: true,
        questionAnswer: { eventId: "question-event", value: "核心工具" },
      }),
    }), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      turnId: "turn-answer",
      resume: true,
      questionAnswer: { eventId: "question-event", value: "核心工具" },
    }));
  });

  it("routes command approval through the server-owned Turn runtime", async () => {
    mocks.commandApproval.mockResolvedValue({ status: "running", turnId: "turn-command" });
    const response = await POST(new Request("http://localhost/turns", {
      method: "POST",
      body: JSON.stringify({
        turnId: "turn-command",
        commandApproval: { eventId: "approval-event", decision: "approve", scope: "project" },
      }),
    }), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "running", turnId: "turn-command" });
    expect(mocks.commandApproval).toHaveBeenCalledWith({
      projectId,
      turnId: "turn-command",
      eventId: "approval-event",
      decision: "approve",
      scope: "project",
    });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("routes a steering request into the active Turn without requiring a model field", async () => {
    mocks.steer.mockResolvedValue({ revision: 1, turnId: "turn-steer" });
    const response = await POST(new Request("http://localhost/turns", {
      method: "POST",
      body: JSON.stringify({ prompt: "同时打开页面", steer: true, turnId: "turn-steer" }),
    }), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ revision: 1, status: "steered", turnId: "turn-steer" });
    expect(mocks.steer).toHaveBeenCalledWith({ projectId, prompt: "同时打开页面", turnId: "turn-steer" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("rejects a steering request without an explicit Turn identity", async () => {
    const response = await POST(new Request("http://localhost/turns", {
      method: "POST",
      body: JSON.stringify({ prompt: "同时打开页面", steer: true }),
    }), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(400);
    expect(mocks.steer).not.toHaveBeenCalled();
  });

  it("projects durable events into a bounded polling result", async () => {
    const created = await createAgentExecution({
      projectId,
      instruction: "检查",
      resultNodeId: "turn-2",
      triggerNodeId: "turn-2",
      allowWithoutWorkspace: true,
    }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-2", type: "user", content: "检查" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-2", type: "assistant", content: "检查完成" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-2", type: "status", data: { stage: "completed" } }, dataDir);

    const response = await GET(new Request("http://localhost/turns?turnId=turn-2"), {
      params: Promise.resolve({ projectId }),
    });
    await expect(response.json()).resolves.toEqual({ status: "completed", turnId: "turn-2", answer: "检查完成" });
    await expect(getAgentExecution(projectId, created.detail.id, dataDir)).resolves.toMatchObject({
      status: "succeeded",
      stage: "completed",
      resultSummary: "检查完成",
    });
  });

  it("treats the live server job as authoritative while a waiting Turn resumes", async () => {
    await appendProjectAgentEvent({ projectId, turnId: "turn-resuming", type: "user", content: "继续" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-resuming", type: "status", data: { stage: "waitingInput" } }, dataDir);
    mocks.active.mockReturnValue(true);

    const response = await GET(new Request("http://localhost/turns?turnId=turn-resuming"), {
      params: Promise.resolve({ projectId }),
    });

    await expect(response.json()).resolves.toEqual({ status: "running", turnId: "turn-resuming" });
  });

  it("terminalizes a running Turn whose server-owned job was lost after restart", async () => {
    const created = await createAgentExecution({
      projectId,
      instruction: "检查",
      resultNodeId: "turn-lost",
      triggerNodeId: "turn-lost",
      allowWithoutWorkspace: true,
    }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-lost", type: "user", content: "检查" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId: "turn-lost", type: "status", data: { stage: "thinking" } }, dataDir);

    const response = await GET(new Request("http://localhost/turns?turnId=turn-lost"), {
      params: Promise.resolve({ projectId }),
    });
    await expect(response.json()).resolves.toMatchObject({
      status: "failed",
      turnId: "turn-lost",
      error: expect.stringContaining("本地服务已重启"),
    });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.findLast((event) => event.turnId === "turn-lost" && event.type === "status")?.data)
      .toMatchObject({ stage: "failed" });
    await expect(getAgentExecution(projectId, created.detail.id, dataDir)).resolves.toMatchObject({
      status: "failed",
      stage: "failed",
      error: expect.stringContaining("本地服务已重启"),
    });
  });

  it("stops the matching server job without relying on request cancellation", async () => {
    mocks.stop.mockReturnValue(true);
    const response = await DELETE(new Request("http://localhost/turns?turnId=turn-3", { method: "DELETE" }), {
      params: Promise.resolve({ projectId }),
    });
    await expect(response.json()).resolves.toEqual({ stopped: true, turnId: "turn-3" });
    expect(mocks.stop).toHaveBeenCalledWith(projectId, "turn-3");
  });
});
