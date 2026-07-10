import type { AgentMessage } from "@/components/zenme/agent-types";

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
