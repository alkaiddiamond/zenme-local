export type ChatToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ChatMessage =
  | {
      role: "user" | "assistant" | "system";
      content: string;
      toolCalls?: ChatToolCall[];
    }
  | {
      role: "tool";
      content: string;
      toolCallId: string;
      name?: string;
    };

