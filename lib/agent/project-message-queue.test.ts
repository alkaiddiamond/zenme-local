import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dequeueProjectAgentMessage,
  enqueueProjectAgentMessage,
  listProjectAgentMessages,
} from "@/lib/agent/project-message-queue";
import { createLocalProject } from "@/lib/local/project-repository";
import { getProjectDir } from "@/lib/local/data-dir";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-message-queue-"));
  projectId = (await createLocalProject({ name: "Queue", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("project agent message queue", () => {
  it("dequeues now before next before later while preserving FIFO", async () => {
    await enqueueProjectAgentMessage({ projectId, turnId: "turn", kind: "task-notification", content: "later 1" }, dataDir);
    await enqueueProjectAgentMessage({ projectId, turnId: "turn", kind: "user", content: "next 1" }, dataDir);
    await enqueueProjectAgentMessage({ projectId, turnId: "turn", kind: "task-notification", content: "later 2" }, dataDir);
    await enqueueProjectAgentMessage({ projectId, turnId: "turn", kind: "user", content: "now", priority: "now" }, dataDir);

    const drained = [];
    for (;;) {
      const message = await dequeueProjectAgentMessage(projectId, {}, dataDir);
      if (!message) break;
      drained.push(message.content);
    }
    expect(drained).toEqual(["now", "next 1", "later 1", "later 2"]);
  });

  it("deduplicates terminal task notifications across process reconciliation", async () => {
    const first = await enqueueProjectAgentMessage({
      projectId,
      turnId: "turn",
      kind: "task-notification",
      content: "completed",
      dedupeKey: "background:task-1",
    }, dataDir);
    const duplicate = await enqueueProjectAgentMessage({
      projectId,
      turnId: "turn",
      kind: "task-notification",
      content: "completed again",
      dedupeKey: "background:task-1",
    }, dataDir);

    expect(duplicate.id).toBe(first.id);
    await expect(listProjectAgentMessages(projectId, dataDir)).resolves.toHaveLength(1);
  });

  it("keeps messages for other Turns queued", async () => {
    await enqueueProjectAgentMessage({ projectId, turnId: "a", kind: "user", content: "A" }, dataDir);
    await enqueueProjectAgentMessage({ projectId, turnId: "b", kind: "user", content: "B" }, dataDir);

    await expect(dequeueProjectAgentMessage(projectId, { turnId: "b" }, dataDir))
      .resolves.toMatchObject({ content: "B" });
    await expect(listProjectAgentMessages(projectId, dataDir))
      .resolves.toEqual([expect.objectContaining({ content: "A" })]);
  });

  it("preserves unknown queue and message fields during forward-compatible writes", async () => {
    const queuePath = path.join(getProjectDir(projectId, dataDir), "agent", "message-queue.json");
    await fs.mkdir(path.dirname(queuePath), { recursive: true });
    await fs.writeFile(queuePath, JSON.stringify({
      version: 1,
      futureQueueField: { enabled: true },
      messages: [{
        id: "existing",
        turnId: "turn",
        kind: "user",
        priority: "next",
        content: "existing",
        createdAt: "2026-08-16T00:00:00.000Z",
        futureMessageField: 42,
      }],
    }), "utf8");

    await enqueueProjectAgentMessage({ projectId, turnId: "turn", kind: "user", content: "new" }, dataDir);
    const persisted = JSON.parse(await fs.readFile(queuePath, "utf8")) as {
      futureQueueField?: unknown;
      messages: Array<{ futureMessageField?: unknown }>;
    };
    expect(persisted.futureQueueField).toEqual({ enabled: true });
    expect(persisted.messages[0].futureMessageField).toBe(42);
  });
});
