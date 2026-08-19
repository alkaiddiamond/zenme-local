import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import type { ChatMessage, ChatToolCall } from "@/lib/ai/chat-message";

export function projectConversationEvents(
  events: readonly ProjectAgentEvent[],
  conversationId?: string,
) {
  if (!conversationId) return [...events];
  const turnIds = new Set(
    events
      .filter((event) => event.conversationId === conversationId)
      .map((event) => event.turnId),
  );
  return events.filter((event) => turnIds.has(event.turnId));
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
