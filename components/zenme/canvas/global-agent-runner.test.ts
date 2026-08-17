import { afterEach, describe, expect, it, vi } from "vitest";

import { planGlobalAgentTasks, runGlobalOrchestration } from "./global-agent-runner";

afterEach(() => vi.unstubAllGlobals());

describe("Global Agent server runtime", () => {
  it("plans through the server-owned planning runtime", async () => {
    const tasks = [{ title: "检查", instruction: "检查项目", allowedPathPrefixes: ["."] }];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tasks }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(planGlobalAgentTasks({
      projectId: "project-1",
      canvasContext: "context",
      goal: "检查项目",
      model: "provider:model",
    })).resolves.toEqual(tasks);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/global-agent",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "plan", canvasContext: "context", goal: "检查项目", model: "provider:model" }),
      }),
    );
  });

  it("runs orchestration entirely on the server", async () => {
    const orchestration = { id: "orchestration-1", status: "completed" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(orchestration), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runGlobalOrchestration({
      projectId: "project-1",
      orchestrationId: "orchestration-1",
      model: "provider:model",
    })).resolves.toMatchObject(orchestration);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/global-agent/orchestration-1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ action: "run", model: "provider:model" }) }),
    );
  });
});
