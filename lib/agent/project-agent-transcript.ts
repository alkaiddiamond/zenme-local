import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import type { ChatMessage, ChatToolCall } from "@/lib/ai/chat-message";

export function projectConversationEvents(
  events: readonly ProjectAgentEvent[],
  conversationId?: string,
  options: { compactedThroughSequence?: number } = {},
) {
  if (!conversationId) return [...events];
  const projected = collectConversationLineageEvents(events, conversationId, Number.POSITIVE_INFINITY, new Set());
  const compactedThroughSequence = Math.max(0, options.compactedThroughSequence ?? 0);
  return compactedThroughSequence
    ? projected.filter((event) => event.sequence > compactedThroughSequence)
    : projected;
}

function collectConversationLineageEvents(
  events: readonly ProjectAgentEvent[],
  conversationId: string,
  maxSequence: number,
  visitedConversationIds: Set<string>,
): ProjectAgentEvent[] {
  if (visitedConversationIds.has(conversationId)) return [];
  visitedConversationIds.add(conversationId);

  const taggedEvents = events.filter((event) =>
    event.conversationId === conversationId && event.sequence <= maxSequence
  );
  const turnIds = new Set(taggedEvents.map((event) => event.turnId));
  const ownEvents = events.filter((event) =>
    turnIds.has(event.turnId) && event.sequence <= maxSequence
  );
  const firstUserEvent = taggedEvents.find((event) => event.type === "user");
  const parentConversationIds = Array.isArray(firstUserEvent?.data?.parentConversationIds)
    ? firstUserEvent.data.parentConversationIds.filter((value): value is string => typeof value === "string")
    : [];
  const parentTurnId = firstUserEvent?.parentTurnId;

  let inheritedEvents: ProjectAgentEvent[] = [];
  if (parentConversationIds.length === 1 && parentTurnId) {
    const parentTurnSequence = events.reduce((maximum, event) =>
      event.turnId === parentTurnId ? Math.max(maximum, event.sequence) : maximum
    , 0);
    if (parentTurnSequence > 0) {
      inheritedEvents = collectConversationLineageEvents(
        events,
        parentConversationIds[0],
        parentTurnSequence,
        visitedConversationIds,
      );
    }
  }

  const byId = new Map<string, ProjectAgentEvent>();
  for (const event of [...inheritedEvents, ...ownEvents]) byId.set(event.id, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function projectAgentTranscript(events: readonly ProjectAgentEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let pendingToolCalls: ChatToolCall[] = [];

  const flushToolCalls = () => {
    if (!pendingToolCalls.length) return;
    messages.push({ role: "assistant", content: "", toolCalls: pendingToolCalls });
    pendingToolCalls = [];
  };

  for (const event of events) {
    if (event.type === "toolCall") {
      const name = typeof event.data?.name === "string" ? event.data.name : "";
      if (!name || event.data?.status === "superseded") continue;
      pendingToolCalls.push({
        id: event.id,
        name,
        arguments: event.data?.arguments ?? {},
      });
      continue;
    }

    flushToolCalls();

    if (event.type === "user" && event.content?.trim()) {
      messages.push({ role: "user", content: event.content });
      continue;
    }
    if (event.type === "assistant" && event.content?.trim()) {
      messages.push({ role: "assistant", content: event.content });
      continue;
    }
    if (event.type !== "toolResult" || !event.content?.trim()) continue;

    const toolCallId = typeof event.data?.toolCallEventId === "string"
      ? event.data.toolCallEventId
      : "";
    if (toolCallId) {
      messages.push({
        role: "tool",
        content: toolResultContent(event),
        toolCallId,
        ...(typeof event.data?.name === "string" ? { name: event.data.name } : {}),
      });
      continue;
    }

    if (
      event.data?.backgroundTaskNotification === true ||
      event.data?.queueMessageId ||
      event.data?.hookLifecycle === true
    ) {
      messages.push({ role: "user", content: event.content });
    }
  }

  flushToolCalls();
  return messages;
}

function toolResultContent(event: ProjectAgentEvent) {
  const output = event.data?.output;
  if (output === undefined) return event.content ?? "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output);
  } catch {
    return event.content ?? "";
  }
}
