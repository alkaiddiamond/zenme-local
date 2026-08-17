import crypto from "node:crypto";

import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";

export type ProjectAgentMessagePriority = "now" | "next" | "later";
export type ProjectAgentQueuedMessage = {
  id: string;
  turnId: string;
  kind: "user" | "task-notification";
  priority: ProjectAgentMessagePriority;
  content: string;
  createdAt: string;
  dedupeKey?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProjectAgentMessageQueue = {
  version: 1;
  messages: ProjectAgentQueuedMessage[];
  [key: string]: unknown;
};

const locks = new Map<string, Promise<unknown>>();
const priorityOrder: Record<ProjectAgentMessagePriority, number> = { now: 0, next: 1, later: 2 };

export async function enqueueProjectAgentMessage(input: {
  projectId: string;
  turnId: string;
  kind: ProjectAgentQueuedMessage["kind"];
  content: string;
  priority?: ProjectAgentMessagePriority;
  dedupeKey?: string;
  data?: Record<string, unknown>;
}, dataDir = getZenmeDataDir()) {
  validateInput(input.projectId, input.turnId, input.content);
  return mutateQueue(input.projectId, dataDir, (queue) => {
    if (input.dedupeKey) {
      const existing = queue.messages.find((message) => message.dedupeKey === input.dedupeKey);
      if (existing) return { queue, value: existing };
    }
    const message: ProjectAgentQueuedMessage = {
      id: crypto.randomUUID(),
      turnId: input.turnId,
      kind: input.kind,
      priority: input.priority ?? (input.kind === "task-notification" ? "later" : "next"),
      content: input.content,
      createdAt: new Date().toISOString(),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      ...(input.data ? { data: input.data } : {}),
    };
    queue.messages.push(message);
    return { queue, value: message };
  });
}

export async function dequeueProjectAgentMessage(
  projectId: string,
  options: { turnId?: string; maxPriority?: ProjectAgentMessagePriority } = {},
  dataDir = getZenmeDataDir(),
) {
  return mutateQueue(projectId, dataDir, (queue) => {
    const threshold = priorityOrder[options.maxPriority ?? "later"];
    let selectedIndex = -1;
    let selectedPriority = Number.POSITIVE_INFINITY;
    for (const [index, message] of queue.messages.entries()) {
      if (options.turnId && message.turnId !== options.turnId) continue;
      const priority = priorityOrder[message.priority];
      if (priority > threshold || priority >= selectedPriority) continue;
      selectedIndex = index;
      selectedPriority = priority;
    }
    if (selectedIndex < 0) return { queue, value: undefined };
    const [message] = queue.messages.splice(selectedIndex, 1);
    return { queue, value: message };
  });
}

export function listProjectAgentMessages(projectId: string, dataDir = getZenmeDataDir()) {
  return readQueue(projectId, dataDir).then((queue) => [...queue.messages].sort((left, right) =>
    priorityOrder[left.priority] - priorityOrder[right.priority] || left.createdAt.localeCompare(right.createdAt)));
}

async function mutateQueue<T>(
  projectId: string,
  dataDir: string,
  mutate: (queue: ProjectAgentMessageQueue) => { queue: ProjectAgentMessageQueue; value: T },
) {
  const filePath = queuePath(projectId, dataDir);
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const result = mutate(await readQueue(projectId, dataDir));
    await writeJsonFile(filePath, result.queue);
    return result.value;
  });
  locks.set(filePath, next);
  return next.finally(() => {
    if (locks.get(filePath) === next) locks.delete(filePath);
  }) as Promise<T>;
}

function readQueue(projectId: string, dataDir: string) {
  return readJsonFile<ProjectAgentMessageQueue>(queuePath(projectId, dataDir), {
    defaultValue: { version: 1, messages: [] },
    normalize: normalizeQueue,
  });
}

function normalizeQueue(value: unknown): ProjectAgentMessageQueue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.messages)) return null;
  const messages = record.messages.filter(isQueuedMessage);
  return { ...record, version: 1, messages };
}

function isQueuedMessage(value: unknown): value is ProjectAgentQueuedMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return typeof message.id === "string" && typeof message.turnId === "string" &&
    (message.kind === "user" || message.kind === "task-notification") &&
    (message.priority === "now" || message.priority === "next" || message.priority === "later") &&
    typeof message.content === "string" && typeof message.createdAt === "string";
}

function validateInput(projectId: string, turnId: string, content: string) {
  assertSafePathSegment(projectId, "项目 ID");
  if (!turnId.trim() || turnId.length > 200 || !content.trim() || content.length > 500_000) {
    throw new Error("Agent 队列消息无效");
  }
}

function queuePath(projectId: string, dataDir: string) {
  assertSafePathSegment(projectId, "项目 ID");
  return resolveInside(getProjectDir(projectId, dataDir), "agent", "message-queue.json");
}
