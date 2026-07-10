import { describe, expect, it } from "vitest";

import {
  appendAgentUserMessage,
  appendEmptyAssistantMessage,
  applyAssistantMessageContent,
} from "./agent-message-state";
import type { AgentMessage } from "./agent-types";

describe("agent message state helpers", () => {
  it("appends user and assistant messages without mutating previous messages", () => {
    const initial: AgentMessage[] = [{ role: "assistant", content: "你好" }];

    const withUser = appendAgentUserMessage(initial, "继续");
    const withAssistant = appendEmptyAssistantMessage(withUser);

    expect(initial).toEqual([{ role: "assistant", content: "你好" }]);
    expect(withUser).toEqual([
      { role: "assistant", content: "你好" },
      { role: "user", content: "继续" },
    ]);
    expect(withAssistant).toEqual([
      { role: "assistant", content: "你好" },
      { role: "user", content: "继续" },
      { role: "assistant", content: "" },
    ]);
  });

  it("updates only the latest assistant placeholder", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "写一句" },
      { role: "assistant", content: "" },
    ];

    expect(applyAssistantMessageContent(messages, "完成")).toEqual([
      { role: "user", content: "写一句" },
      { role: "assistant", content: "完成" },
    ]);
    expect(messages[1].content).toBe("");
  });

  it("does not rewrite history when the last message is not assistant", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "等待中" }];

    expect(applyAssistantMessageContent(messages, "不应写入")).toEqual(messages);
  });
});
