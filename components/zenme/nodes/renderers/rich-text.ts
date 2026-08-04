export function stripLegacyRichTextHtml(html?: string) {
  if (!html) {
    return "";
  }

  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function plainTextToRichTextFragment(value: string) {
  return escapeHtml(value).replace(/\r\n?|\n/g, "<br>");
}

function removeRedundantEditorSpans(value: string) {
  const redundantEditorSpan =
    /<span\s+style=(["'])([^"']*)\1\s*>((?:(?!<\/?span\b)[\s\S])*)<\/span>/gi;

  return value.replace(
    redundantEditorSpan,
    (match, _quote: string, style: string, content: string) => {
      const declarations = style
        .split(";")
        .map((declaration) =>
          declaration.trim().toLowerCase().replace(/\s*:\s*/, ":"),
        )
        .filter(Boolean);
      const isRedundant =
        declarations.length > 0 &&
        declarations.every(
          (declaration) =>
            declaration === "font-size:1rem" ||
            declaration === "caret-color:currentcolor",
        );

      return isRedundant ? content : match;
    },
  );
}

export function normalizeRichTextHtml(html?: string) {
  if (!html) {
    return "";
  }

  const fragment = removeRedundantEditorSpans(html)
    .trim()
    .replace(/<br\s*\/?>\s*<\/(p|div)>/gi, "</$1>")
    .replace(/<(p|div)(?:\s[^>]*)?>/gi, "")
    .replace(/<\/(p|div)>/gi, "<br>")
    .replace(/^(?:\s*<br\s*\/?>)+/gi, "")
    .replace(/(?:<br\s*\/?>\s*)+$/gi, "");

  return fragment ? `<p>${fragment}</p>` : "";
}

export function plainTextToRichTextHtml(value?: string) {
  const text = value ?? "";
  if (!text) {
    return "";
  }

  return `<p>${plainTextToRichTextFragment(text)}</p>`;
}
