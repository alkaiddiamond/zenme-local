import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/projects/[projectId]/agent-session/route";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-agent-session-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  projectId = (await createLocalProject({ name: "Agent API", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("project agent session API", () => {
  it("appends waterfall events and reads the stable project session", async () => {
    const params = Promise.resolve({ projectId });
    const created = await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "appendEvent", type: "user", content: "分析这个项目", turnId: "turn-1" }),
    }), { params });
    expect(created.status).toBe(201);

    const response = await GET(new Request(`http://localhost/api/projects/${projectId}/agent-session`), { params });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      projectId,
      events: [{ type: "user", content: "分析这个项目", turnId: "turn-1", sequence: 1 }],
    });
  });

  it("persists a permission override on the project session instead of global settings", async () => {
    const params = Promise.resolve({ projectId });
    const updated = await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "updateContext", permissionMode: "neverAsk" }),
    }), { params });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ context: { permissionMode: "neverAsk" } });

    const response = await GET(new Request(`http://localhost/api/projects/${projectId}/agent-session`), { params });
    await expect(response.json()).resolves.toMatchObject({ context: { permissionMode: "neverAsk" } });
  });

  it("returns only summary and post-boundary messages for effective context", async () => {
    const params = Promise.resolve({ projectId });
    for (const content of ["旧问题", "旧回答"]) {
      await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "appendEvent", type: content === "旧问题" ? "user" : "assistant", content }),
      }), { params });
    }
    await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "appendEvent", type: "user", content: "新问题" }),
    }), { params });
    const compacted = await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "compact", summary: "早期对话摘要", compactedThroughSequence: 2, sourceTokenEstimate: 8_000 }),
    }), { params });
    expect(compacted.status).toBe(201);

    const response = await GET(new Request(
      `http://localhost/api/projects/${projectId}/agent-session?effectiveContext=1`,
    ), { params });
    await expect(response.json()).resolves.toEqual({
      summary: "早期对话摘要",
      compactedThroughSequence: 2,
      events: [expect.objectContaining({ type: "user", content: "新问题" })],
    });
  });

  it("returns a thinned model projection without changing the session waterfall", async () => {
    const params = Promise.resolve({ projectId });
    for (let index = 0; index < 7; index += 1) {
      await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "appendEvent",
          type: "toolResult",
          turnId: `turn-${index}`,
          content: `result-${index}`,
          data: { name: "read_file", toolCallId: `tool-${index}`, output: "x".repeat(10_000) },
        }),
      }), { params });
    }
    await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "appendEvent", type: "user", turnId: "current", content: "继续" }),
    }), { params });

    const projected = await GET(new Request(
      `http://localhost/api/projects/${projectId}/agent-session?modelContext=1`,
    ), { params });
    const modelContext = await projected.json();
    expect(modelContext.clearedToolResultEventIds).toHaveLength(2);
    expect(modelContext.events[0].content).toBe("[Old tool result content cleared]");

    const durable = await GET(new Request(`http://localhost/api/projects/${projectId}/agent-session`), { params });
    expect((await durable.json()).events[0].content).toBe("result-0");
  });

  it("validates the project-level background task stop action", async () => {
    const params = Promise.resolve({ projectId });
    const invalid = await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stopBackgroundTask", taskId: "" }),
    }), { params });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "后台任务参数无效" });

    const missing = await POST(new Request(`http://localhost/api/projects/${projectId}/agent-session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stopBackgroundTask", taskId: "missing-task" }),
    }), { params });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: "后台任务不存在或当前不可停止", code: "invalid_status" });
  });
});
