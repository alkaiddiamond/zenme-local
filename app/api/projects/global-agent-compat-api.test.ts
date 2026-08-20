import { describe, expect, it } from "vitest";

import { PATCH as orchestrationPatch } from "@/app/api/projects/[projectId]/global-agent/[orchestrationId]/route";

describe("legacy Global Agent compatibility API", () => {
  it.each(["run", "dispatch", "retry"])("rejects retired %s actions", async (action) => {
    const response = await orchestrationPatch(new Request("http://localhost/api/projects/project-1/global-agent/orchestration-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, model: "provider:model", subtaskId: "task-1" }),
    }), {
      params: Promise.resolve({ projectId: "project-1", orchestrationId: "orchestration-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Global Agent 操作参数无效" });
  });
});
