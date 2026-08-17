import type { AgentMessage } from "@/components/zenme/agent-types";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import { isProjectAgentShellCommandTool } from "@/lib/agent/project-context-policy";

const SETTLED_TURN_STAGES = new Set([
  "completed",
  "failed",
  "stopped",
  "waitingApproval",
  "waitingInput",
]);

export function hasActiveProjectAgentTurn(events: ProjectAgentEvent[]) {
  return Boolean(getActiveProjectAgentTurnId(events));
}

export function getActiveProjectAgentTurnId(events: ProjectAgentEvent[]) {
  const eventsByTurn = new Map<string, ProjectAgentEvent[]>();
  for (const event of events) {
    const turnEvents = eventsByTurn.get(event.turnId) ?? [];
    turnEvents.push(event);
    eventsByTurn.set(event.turnId, turnEvents);
  }

  for (const [turnId, turnEvents] of [...eventsByTurn.entries()].reverse()) {
    if (!turnEvents.some((event) => event.type === "user")) continue;
    const ordered = [...turnEvents].sort((left, right) => left.sequence - right.sequence);
    const latestStatus = ordered.findLast((event) => event.type === "status");
    if (!latestStatus || !SETTLED_TURN_STAGES.has(String(latestStatus.data?.stage ?? ""))) return turnId;
    if (ordered.some((event) => event.sequence > latestStatus.sequence && resumesSettledTurn(event))) return turnId;
  }
  return undefined;
}

function resumesSettledTurn(event: ProjectAgentEvent) {
  if (event.type === "toolCall") return true;
  if (event.type === "approval") return event.data?.status !== "pending";
  if (event.type === "status") return !SETTLED_TURN_STAGES.has(String(event.data?.stage ?? ""));
  return false;
}

export function hasPendingProjectAgentBackgroundTask(events: ProjectAgentEvent[]) {
  const pendingTaskIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "toolResult" || !event.data?.output || typeof event.data.output !== "object") continue;
    const output = event.data.output as { id?: unknown; status?: unknown };
    if (typeof output.id !== "string") continue;
    if (isProjectAgentShellCommandTool(event.data?.name) && output.status === "running") {
      pendingTaskIds.add(output.id);
    }
    if (event.data.backgroundTaskNotification === true) {
      pendingTaskIds.delete(output.id);
    }
  }
  return pendingTaskIds.size > 0;
}

export function hasPendingProjectAgentMemoryTask(events: ProjectAgentEvent[]) {
  const latestAutoDream = events.findLast((event) => event.type === "memory" && event.data?.source === "autoDream");
  return latestAutoDream?.data?.status === "running";
}

export function appendAgentUserMessage(
  messages: AgentMessage[],
  content: string,
): AgentMessage[] {
  return [...messages, { role: "user", content }];
}

export function appendEmptyAssistantMessage(
  messages: AgentMessage[],
): AgentMessage[] {
  return [...messages, { role: "assistant", content: "" }];
}

export function appendAgentAssistantMessage(
  messages: AgentMessage[],
  content: string,
): AgentMessage[] {
  return [...messages, { role: "assistant", content }];
}

export function applyAssistantMessageContent(
  messages: AgentMessage[],
  content: string,
): AgentMessage[] {
  const next = [...messages];
  const last = next[next.length - 1];

  if (last?.role !== "assistant") {
    return next;
  }

  next[next.length - 1] = {
    role: "assistant",
    content,
  };

  return next;
}
