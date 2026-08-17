import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runProjectAutoDream, scheduleProjectAutoDream } from "@/lib/agent/project-auto-dream";
import { appendProjectAgentEvent, getProjectAgentSession } from "@/lib/agent/project-session-store";
import { createLocalProject } from "@/lib/local/project-repository";
import { updateLocalSettings } from "@/lib/local/settings";
import { listProjectMemories } from "@/lib/memory/repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-auto-dream-"));
  projectId = (await createLocalProject({ name: "Dream", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => fs.rm(dataDir, { force: true, recursive: true }));

describe("project auto dream", () => {
  it("stays off by default and creates only a candidate after enough conversation", async () => {
    const callModel = async () => ({
      text: JSON.stringify({ title: "技术决策", content: "项目采用本地优先架构。", kind: "decision" }),
      usage: null,
    });
    await seedConversation();
    await expect(runProjectAutoDream({ projectId, model: "test", callModel, dataDir }))
      .resolves.toEqual({ status: "disabled" });

    await updateLocalSettings({ autoDreamEnabled: true, thinkingEnabled: false }, dataDir);
    await expect(runProjectAutoDream({ projectId, model: "test", callModel, dataDir }))
      .resolves.toMatchObject({ status: "created", memory: { status: "candidate" } });
    expect(await listProjectMemories(projectId, dataDir)).toEqual([
      expect.objectContaining({ status: "candidate", title: "技术决策" }),
    ]);
    expect((await getProjectAgentSession(projectId, dataDir)).events.at(-1)).toMatchObject({
      type: "memory",
      data: { source: "autoDream", status: "candidate" },
    });
  });

  it("persists a running event before background generation and then records the candidate", async () => {
    await seedConversation();
    await updateLocalSettings({ autoDreamEnabled: true, thinkingEnabled: false }, dataDir);
    let resolveModel!: (value: { text: string; usage: null }) => void;
    const modelResult = new Promise<{ text: string; usage: null }>((resolve) => { resolveModel = resolve; });

    await expect(scheduleProjectAutoDream({ projectId, model: "test", callModel: async () => modelResult, dataDir }))
      .resolves.toEqual({ status: "scheduled" });
    expect((await getProjectAgentSession(projectId, dataDir)).events.at(-1)).toMatchObject({
      type: "memory",
      data: { source: "autoDream", status: "running" },
    });

    resolveModel({ text: JSON.stringify({ title: "后台候选", content: "记忆内容", kind: "architecture" }), usage: null });
    await waitFor(async () => (await getProjectAgentSession(projectId, dataDir)).events.some((event) =>
      event.type === "memory" && event.data?.status === "candidate",
    ));
    expect((await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.type === "memory").map((event) => event.data?.status))
      .toEqual(["running", "candidate"]);
  });
});

async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for auto-dream");
}

async function seedConversation() {
  for (let index = 0; index < 6; index += 1) {
    const turnId = `turn-${index}`;
    await appendProjectAgentEvent({ projectId, turnId, type: "user", content: `问题 ${index}` }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId, type: "assistant", content: `回答 ${index}` }, dataDir);
  }
}
