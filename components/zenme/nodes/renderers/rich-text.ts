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

const URL_TEXT_PATTERN = /https?:\/\/[^\s<]+/gi;
const WRAPPABLE_URL_CLASS = "zenme-wrappable-url";

function wrapUrlText(value: string) {
  return value.replace(
    URL_TEXT_PATTERN,
    (url) => `<span class="${WRAPPABLE_URL_CLASS}">${url}</span>`,
  );
}

export function ensureUrlWrappingInRichTextHtml(html: string) {
  const protectedUrls: string[] = [];
  const protectedHtml = html.replace(
    /<span\s+class=(['"])(?:zenme-nowrap-url|zenme-wrappable-url)\1\s*>[\s\S]*?<\/span>/gi,
    (span) => {
      const canonicalSpan = span.replace(
        /zenme-nowrap-url/gi,
        WRAPPABLE_URL_CLASS,
      );
      const index = protectedUrls.push(canonicalSpan) - 1;
      return `\uE000${index}\uE001`;
    },
  );
  const wrappedHtml = protectedHtml
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith("<") ? part : wrapUrlText(part)))
    .join("");

  return wrappedHtml.replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
    protectedUrls[Number(index)] ?? "",
  );
}

export function plainTextToRichTextFragment(value: string) {
  return ensureUrlWrappingInRichTextHtml(escapeHtml(value)).replace(
    /\r\n?|\n/g,
    "<br>",
  );
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

function preserveFirstRootLineBreak(value: string) {
  const firstBlock = value.search(/<(?:p|div)\b/i);
  if (firstBlock <= 0) {
    return value;
  }

  const prefix = value.slice(0, firstBlock);
  if (!prefix.trim() || /<br\s*\/?>\s*$/i.test(prefix)) {
    return value;
  }

  return `${prefix}<br>${value.slice(firstBlock)}`;
}

export function normalizeRichTextHtml(html?: string) {
  if (!html) {
    return "";
  }

  const fragment = preserveFirstRootLineBreak(removeRedundantEditorSpans(html))
    .trim()
    .replace(/<br\s*\/?>\s*<\/(p|div)>(?=\s*<(?:p|div)\b)/gi, "</$1>")
    .replace(
      /<(p|div)(\s[^>]*)?>\s*<br\s*\/?>\s*<\/\1>/gi,
      "<$1$2></$1>",
    )
    .replace(/<(p|div)(?:\s[^>]*)?>/gi, "")
    .replace(/<\/(p|div)>/gi, "<br>")
    .replace(/<br\s*\/?>\s*$/i, "");

  return fragment ? `<p>${fragment}</p>` : "";
}

export function plainTextToRichTextHtml(value?: string) {
  const text = value ?? "";
  if (!text) {
    return "";
  }

  return `<p>${plainTextToRichTextFragment(text)}</p>`;
}
