import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as getKnowledge,
  POST as mutateKnowledge,
} from "@/app/api/projects/[projectId]/knowledge/route";
import {
  GET as getMemories,
  POST as createMemory,
} from "@/app/api/projects/[projectId]/memories/route";
import {
  DELETE as deleteMemory,
  PATCH as updateMemory,
} from "@/app/api/projects/[projectId]/memories/[memoryId]/route";
import { createLocalProject, saveLocalCanvasSnapshot } from "@/lib/local/project-repository";
import { updateLocalSettings } from "@/lib/local/settings";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";
import { createVolcengineAgentPlanProvider } from "@/lib/ai/provider-presets";
import { getProviderModelSelections } from "@/lib/ai/provider-model-resolution";

let dataDir: string;
let projectId: string;
let workspaceRoot: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-memory-knowledge-api-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-memory-knowledge-workspace-"));
  process.env.ZENME_DATA_DIR = dataDir;
  await fs.mkdir(path.join(workspaceRoot, "src"));
  await fs.writeFile(path.join(workspaceRoot, "src", "policy.ts"), "export const policy = 'reviewed';\n", "utf8");
  projectId = (await createLocalProject({ name: "Memory API", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
  await saveLocalCanvasSnapshot({
    projectId,
    snapshot: {
      version: 3,
      nodes: [{
        id: "task-policy",
        type: "task",
        position: { x: 0, y: 0 },
        data: { kind: "task", title: "Review policy", nodeLifecycle: "knowledge" },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date().toISOString(),
    },
  }, dataDir);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
});

describe("Project Memory and Knowledge APIs", () => {
  it("keeps agent memory as a candidate until confirmation and supports pin, revise, and delete", async () => {
    const params = { params: Promise.resolve({ projectId }) };
    const createResponse = await createMemory(new Request(
      `http://localhost/api/projects/${projectId}/memories`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "decision",
          title: "Policy decision",
          content: "Use the reviewed policy.",
          createdBy: "agent",
          status: "confirmed",
          sources: [{ kind: "workspaceFile", id: "src/policy.ts", label: "Policy", relativePath: "src/policy.ts" }],
        }),
      },
    ), params);
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: string; status: string };
    expect(created.status).toBe("candidate");

    const memoryParams = { params: Promise.resolve({ projectId, memoryId: created.id }) };
    const confirmResponse = await updateMemory(new Request("http://localhost/memory", {
      method: "PATCH", body: JSON.stringify({ action: "confirm" }),
    }), memoryParams);
    expect(confirmResponse.status).toBe(200);
    const pinResponse = await updateMemory(new Request("http://localhost/memory", {
      method: "PATCH", body: JSON.stringify({ action: "pin" }),
    }), memoryParams);
    await expect(pinResponse.json()).resolves.toMatchObject({ pinned: true });
    const reviseResponse = await updateMemory(new Request("http://localhost/memory", {
      method: "PATCH", body: JSON.stringify({ action: "revise", title: "Validated policy decision", content: "Use the reviewed policy after validation.", reason: "Clarified" }),
    }), memoryParams);
    await expect(reviseResponse.json()).resolves.toMatchObject({ currentRevision: 2, status: "candidate" });

    const contextResponse = await getMemories(new Request(
      `http://localhost/api/projects/${projectId}/memories?context=1`,
    ), params);
    await expect(contextResponse.json()).resolves.toEqual({ memories: [] });
    expect((await deleteMemory(new Request("http://localhost/memory", { method: "DELETE" }), memoryParams)).status).toBe(200);
    await expect(fs.readFile(path.join(workspaceRoot, "src", "policy.ts"), "utf8")).resolves.toContain("reviewed");
  });

  it("rebuilds, queries, pauses, clears, and safely reports the derived knowledge index", async () => {
    const params = { params: Promise.resolve({ projectId }) };
    const rebuildResponse = await mutateKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge`,
      { method: "POST", body: JSON.stringify({ action: "rebuild" }) },
    ), params);
    expect(rebuildResponse.status).toBe(200);
    await expect(rebuildResponse.json()).resolves.toMatchObject({ status: "ready" });

    const queryResponse = await getKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge?query=reviewed%20policy`,
    ), params);
    const query = await queryResponse.json() as { results: Array<{ entity: { id: string } }> };
    expect(query.results.some((result) => result.entity.id === "file:src/policy.ts")).toBe(true);

    const pauseResponse = await mutateKnowledge(new Request("http://localhost/knowledge", {
      method: "POST", body: JSON.stringify({ action: "pause" }),
    }), params);
    await expect(pauseResponse.json()).resolves.toMatchObject({ status: "paused" });
    const pausedQuery = await getKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge?query=policy`,
    ), params);
    expect(pausedQuery.status).toBe(409);
    await expect(pausedQuery.json()).resolves.toMatchObject({ code: "index_paused" });

    const clearResponse = await mutateKnowledge(new Request("http://localhost/knowledge", {
      method: "POST", body: JSON.stringify({ action: "clear" }),
    }), params);
    await expect(clearResponse.json()).resolves.toEqual({ ok: true });
    const clearedStatus = await getKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge`,
    ), params);
    await expect(clearedStatus.json()).resolves.toMatchObject({ status: "missing", diskBytes: 0 });
    await expect(fs.readFile(path.join(workspaceRoot, "src", "policy.ts"), "utf8")).resolves.toContain("reviewed");
  });

  it("builds with an authorized configured embedding model and reuses it for automatic search", async () => {
    const provider = createVolcengineAgentPlanProvider();
    provider.apiKey = "embedding-secret";
    await updateLocalSettings({ modelProviders: [provider] }, dataDir);
    const selection = getProviderModelSelections([provider], "embedding")[0];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return new Response(JSON.stringify({
        data: body.input.map((text, index) => ({
          index,
          embedding: text.toLocaleLowerCase().includes("policy") ? [1, 0] : [0, 1],
        })),
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const params = { params: Promise.resolve({ projectId }) };

    const rebuildResponse = await mutateKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge`,
      {
        method: "POST",
        body: JSON.stringify({
          action: "rebuild",
          embeddingModel: selection.id,
          cloudAuthorized: true,
        }),
      },
    ), params);
    expect(rebuildResponse.status).toBe(200);
    await expect(rebuildResponse.json()).resolves.toMatchObject({
      status: "ready",
      embeddingProvider: {
        id: selection.id,
        kind: "cloud",
        dimension: 2,
        authorizedAt: expect.any(String),
      },
    });

    const statusResponse = await getKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge`,
    ), params);
    const statusText = await statusResponse.text();
    expect(statusText).toContain(selection.id);
    expect(statusText).not.toContain("embedding-secret");

    const queryResponse = await getKnowledge(new Request(
      `http://localhost/api/projects/${projectId}/knowledge?query=reviewed%20policy`,
    ), params);
    expect(queryResponse.status).toBe(200);
    const query = await queryResponse.json() as {
      embeddingProvider: { id: string };
      results: Array<{ entity: { id: string } }>;
    };
    expect(query.embeddingProvider.id).toBe(selection.id);
    expect(query.results.some((result) => result.entity.id === "file:src/policy.ts")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([input]) => String(input).endsWith("/embeddings"))).toBe(true);
  });
});
