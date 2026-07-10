import { describe, expect, it } from "vitest";

import { sanitizeReadingHtml } from "./html-sanitize";

describe("sanitizeReadingHtml", () => {
  it("removes executable and embedded tags", () => {
    expect(
      sanitizeReadingHtml(
        '<p>正文</p><script>alert(1)</script><iframe src="/x"></iframe><style>body{}</style>',
      ),
    ).toBe("<p>正文</p>");
  });

  it("removes event handler attributes", () => {
    expect(sanitizeReadingHtml('<img src="/cover.png" onerror="alert(1)">')).toBe(
      '<img src="/cover.png">',
    );
  });

  it("removes dangerous URL attributes", () => {
    expect(sanitizeReadingHtml('<a href="javascript:alert(1)">link</a>')).toBe(
      "<a>link</a>",
    );
    expect(sanitizeReadingHtml('<img src="data:text/html,<script>x</script>">')).toBe(
      "<img>",
    );
  });

  it("keeps ordinary reading markup and rewritten EPUB asset URLs", () => {
    const html =
      '<p class="chapter">文字 <em>强调</em></p><img src="/api/reading/assets/a/epub-asset?path=cover.png">';

    expect(sanitizeReadingHtml(html)).toBe(html);
  });
});
