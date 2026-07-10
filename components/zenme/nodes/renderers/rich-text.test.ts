import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  plainTextToRichTextHtml,
  stripLegacyRichTextHtml,
} from "./rich-text";

describe("rich text renderer helpers", () => {
  it("strips legacy rich text HTML into plain text", () => {
    expect(stripLegacyRichTextHtml("<p>A&nbsp;&amp;&lt;&gt;</p><div>B</div>")).toBe(
      "A &<>\nB",
    );
  });

  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml(`A&B<"'>`)).toBe("A&amp;B&lt;&quot;&#039;&gt;");
  });

  it("converts plain text into paragraph HTML", () => {
    expect(plainTextToRichTextHtml("第一行\n第二行")).toBe(
      "<p>第一行<br>第二行</p>",
    );
    expect(plainTextToRichTextHtml("")).toBe("");
  });
});
