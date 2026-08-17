import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/global-agent/planning-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/global-agent/planning-runtime")>("@/lib/global-agent/planning-runtime");
  return { ...actual, planGlobalAgentTasks: mocks.plan };
});

vi.mock("@/lib/global-agent/delegated-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/global-agent/delegated-runtime")>("@/lib/global-agent/delegated-runtime");
  return { ...actual, startDelegatedOrchestrationRun: mocks.run };
});

import { POST as globalAgentPost } from "@/app/api/projects/[projectId]/global-agent/route";
import { PATCH as orchestrationPatch } from "@/app/api/projects/[projectId]/global-agent/[orchestrationId]/route";

beforeEach(() => vi.clearAllMocks());

describe("Global Agent runtime API", () => {
  it("plans on the server instead of exposing model planning to the canvas", async () => {
    const tasks = [{ title: "检查", instruction: "检查项目", allowedPathPrefixes: ["."] }];
    mocks.plan.mockResolvedValue(tasks);
    const request = new Request("http://localhost/api/projects/project-1/global-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "plan", goal: "检查项目", model: "provider:model", canvasContext: "context" }),
    });

    const response = await globalAgentPost(request, { params: Promise.resolve({ projectId: "project-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ tasks });
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      goal: "检查项目",
      model: "provider:model",
      canvasContext: "context",
    }));
  });

  it("runs orchestration through the unified server runtime", async () => {
    const orchestration = { id: "orchestration-1", status: "completed" };
    mocks.run.mockResolvedValue({ started: true, orchestration });
    const request = new Request("http://localhost/api/projects/project-1/global-agent/orchestration-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "run", model: "provider:model" }),
    });

    const response = await orchestrationPatch(request, {
      params: Promise.resolve({ projectId: "project-1", orchestrationId: "orchestration-1" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(orchestration);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      orchestrationId: "orchestration-1",
      model: "provider:model",
    }));
  });

  it("rejects missing planning and run models before entering either runtime", async () => {
    const planResponse = await globalAgentPost(new Request("http://localhost/api/projects/project-1/global-agent", {
      method: "POST",
      body: JSON.stringify({ action: "plan", goal: "检查项目" }),
    }), { params: Promise.resolve({ projectId: "project-1" }) });
    const runResponse = await orchestrationPatch(new Request("http://localhost/api/projects/project-1/global-agent/orchestration-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "run", model: "" }),
    }), { params: Promise.resolve({ projectId: "project-1", orchestrationId: "orchestration-1" }) });

    expect(planResponse.status).toBe(400);
    expect(runResponse.status).toBe(400);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
