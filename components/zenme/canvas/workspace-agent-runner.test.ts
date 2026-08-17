import { afterEach, describe, expect, it, vi } from "vitest";

import { runWorkspaceAgent } from "./workspace-agent-runner";

afterEach(() => vi.unstubAllGlobals());

describe("Workspace Agent server runtime", () => {
  it("delegates execution to the unified server-owned native tool loop", async () => {
    const response = { id: "execution-1", status: "succeeded" };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runWorkspaceAgent({
      projectId: "project/1",
      executionId: "execution 1",
      model: "provider:model",
    })).resolves.toMatchObject(response);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2F1/agent-executions/execution%201",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ action: "run", model: "provider:model" }),
      }),
    );
  });
});
