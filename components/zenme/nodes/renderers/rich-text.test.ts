import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  normalizeRichTextHtml,
  plainTextToRichTextHtml,
  plainTextToRichTextFragment,
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

  it("creates an inline paste fragment without browser block elements", () => {
    expect(plainTextToRichTextFragment("第一行\n第二行 <内容>")).toBe(
      "第一行<br>第二行 &lt;内容&gt;",
    );
  });

  it("normalizes browser-created paragraph and div blocks into explicit breaks", () => {
    expect(
      normalizeRichTextHtml(
        "<p>小学时失去一块橡皮，</p><div>初中时失去一场篮球赛。</div><div><strong>高中</strong>时失去一个人</div>",
      ),
    ).toBe(
      "<p>小学时失去一块橡皮，<br>初中时失去一场篮球赛。<br><strong>高中</strong>时失去一个人</p>",
    );
    expect(normalizeRichTextHtml("<p>第一行<br>第二行</p>")).toBe(
      "<p>第一行<br>第二行</p>",
    );
  });

  it("does not count browser block placeholders as extra line breaks", () => {
    expect(
      normalizeRichTextHtml(
        "<p>第一行<br></p><p><br></p><p>第二行</p>",
      ),
    ).toBe("<p>第一行<br><br>第二行</p>");
    expect(
      normalizeRichTextHtml(
        "<div>第一行</div><div><br></div><div>第二行</div>",
      ),
    ).toBe("<p>第一行<br><br>第二行</p>");
  });

  it("removes redundant browser formatting spans that create false wrap points", () => {
    expect(
      normalizeRichTextHtml(
        '<p>小学时失去一块橡皮，<span style="font-size: 1rem; caret-color: currentcolor;">初</span><span style="font-size: 1rem; caret-color: currentcolor;">中时失去一场篮球赛</span></p>',
      ),
    ).toBe("<p>小学时失去一块橡皮，初中时失去一场篮球赛</p>");

    expect(
      normalizeRichTextHtml(
        '<p><span style="color: red;">保留样式</span></p>',
      ),
    ).toBe('<p><span style="color: red;">保留样式</span></p>');
  });
});
