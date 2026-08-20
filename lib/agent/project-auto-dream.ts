import { appendProjectAgentEvent, getProjectAgentSession } from "@/lib/agent/project-session-store";
import type { ProjectAgentModelResponse, callProjectAgentModel } from "@/lib/agent/project-agent-model";
import { createProjectMemory } from "@/lib/memory/repository";
import { getLocalSettings } from "@/lib/local/settings";

const MIN_TEXT_EVENTS = 12;
const activeProjects = new Set<string>();

export async function scheduleProjectAutoDream(input: {
  projectId: string;
  model: string;
  callModel: typeof callProjectAgentModel;
  dataDir: string;
}) {
  if (activeProjects.has(input.projectId)) return { status: "alreadyRunning" as const };
  const prepared = await prepareProjectAutoDream(input);
  if (prepared.status !== "ready") return prepared;
  activeProjects.add(input.projectId);
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: prepared.sourceTurnId,
    type: "memory",
    content: "正在从近期会话整理 Project Memory 候选。",
    data: { source: "autoDream", status: "running" },
  }, input.dataDir);
  queueMicrotask(() => void createProjectAutoDream(input, prepared)
    .then(async (result) => {
      if (result.status !== "invalidOutput") return;
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: prepared.sourceTurnId,
        type: "memory",
        content: "自动做梦未生成有效的记忆候选，不影响当前会话。",
        data: { source: "autoDream", status: "failed", error: "invalidOutput" },
      }, input.dataDir);
    })
    .catch(async (error) => {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: prepared.sourceTurnId,
        type: "memory",
        content: "自动做梦整理失败，不影响当前会话。",
        data: {
          source: "autoDream",
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 2_000) : "unknown",
        },
      }, input.dataDir).catch(() => undefined);
    })
    .finally(() => activeProjects.delete(input.projectId)));
  return { status: "scheduled" as const };
}

export async function runProjectAutoDream(input: {
  projectId: string;
  model: string;
  callModel: (input: { context: string; model: string; prompt: string; thinkingEnabled?: boolean }) => Promise<ProjectAgentModelResponse>;
  dataDir: string;
}) {
  const prepared = await prepareProjectAutoDream(input);
  if (prepared.status !== "ready") return prepared;
  return createProjectAutoDream(input, prepared);
}

async function prepareProjectAutoDream(input: {
  projectId: string;
  model: string;
  callModel: typeof callProjectAgentModel;
  dataDir: string;
}) {
  const settings = await getLocalSettings(input.dataDir);
  if (!settings.autoDreamEnabled) return { status: "disabled" as const };
  const session = await getProjectAgentSession(input.projectId, input.dataDir);
  const lastDreamSequence = session.events.findLast((event) =>
    event.type === "memory" && event.data?.source === "autoDream" && event.data?.status !== "running",
  )?.sequence ?? 0;
  const textEvents = session.events.filter((event) =>
    event.sequence > lastDreamSequence && (event.type === "user" || event.type === "assistant") && event.content?.trim(),
  );
  if (textEvents.length < MIN_TEXT_EVENTS) return { status: "belowThreshold" as const };
  return {
    status: "ready" as const,
    sourceTurnId: textEvents.at(-1)!.turnId,
    textEvents,
    thinkingEnabled: settings.thinkingEnabled,
  };
}

async function createProjectAutoDream(
  input: {
    projectId: string;
    model: string;
    callModel: typeof callProjectAgentModel;
    dataDir: string;
  },
  prepared: Extract<Awaited<ReturnType<typeof prepareProjectAutoDream>>, { status: "ready" }>,
) {
  const response = await input.callModel({
    model: input.model,
    thinkingEnabled: prepared.thinkingEnabled,
    context: JSON.stringify(prepared.textEvents.slice(-40).map(({ type, content, turnId }) => ({ type, content, turnId }))),
    prompt: "从这些项目会话中提炼一个值得长期保留的记忆候选。只返回 JSON：{\"title\":\"...\",\"content\":\"...\",\"kind\":\"decision|architecture|file|todo\"}。不要添加未经证实的信息。",
  });
  const candidate = parseDreamCandidate(response.text);
  if (!candidate) return { status: "invalidOutput" as const };
  const memory = await createProjectMemory({
    projectId: input.projectId,
    createdBy: "agent",
    status: "candidate",
    ...candidate,
    reason: "Auto-dream 根据近期 Project Agent 会话整理，等待用户确认",
    sources: [{ kind: "execution", id: prepared.sourceTurnId, label: "Project Agent session" }],
  }, input.dataDir);
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: prepared.sourceTurnId,
    type: "memory",
    content: `自动做梦生成候选记忆：${memory.title}`,
    data: { source: "autoDream", memoryId: memory.id, status: "candidate" },
  }, input.dataDir);
  return { status: "created" as const, memory };
}

function parseDreamCandidate(value: string) {
  try {
    const parsed = JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as Record<string, unknown>;
    if (typeof parsed.title !== "string" || typeof parsed.content !== "string" ||
      !["decision", "architecture", "file", "todo"].includes(String(parsed.kind))) return null;
    return {
      title: parsed.title.slice(0, 500),
      content: parsed.content.slice(0, 100_000),
      kind: parsed.kind as "decision" | "architecture" | "file" | "todo",
    };
  } catch {
    return null;
  }
}
