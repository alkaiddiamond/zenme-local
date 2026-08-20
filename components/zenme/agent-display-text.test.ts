import { describe, expect, it } from "vitest";

import { normalizeAgentDisplayText } from "@/components/zenme/agent-display-text";

describe("Agent display text", () => {
  it("removes terminal control sequences from legacy persisted output", () => {
    expect(normalizeAgentDisplayText("\u001b[32mready\u001b[39m\rprogress")).toBe("ready\nprogress");
    expect(normalizeAgentDisplayText("title\u001b]0;secret\u0007done")).toBe("titledone");
  });

  it("preserves normal Unicode and existing line breaks", () => {
    expect(normalizeAgentDisplayText("开发服务已启动\r\nhttp://127.0.0.1:5173/"))
      .toBe("开发服务已启动\r\nhttp://127.0.0.1:5173/");
  });
});
