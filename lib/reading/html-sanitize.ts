const BLOCKED_TAGS = [
  "base",
  "button",
  "embed",
  "form",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "textarea",
];

const BLOCKED_TAG_PATTERN = new RegExp(
  `<\\s*(${BLOCKED_TAGS.join("|")})\\b[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`,
  "gi",
);
const SELF_CLOSING_BLOCKED_TAG_PATTERN = new RegExp(
  `<\\s*(${BLOCKED_TAGS.join("|")})\\b[^>]*\\/?>`,
  "gi",
);
const EVENT_HANDLER_ATTRIBUTE_PATTERN =
  /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL_ATTRIBUTE_PATTERN =
  /\s((?:xlink:)?(?:href|src))\s*=\s*(["'])\s*(?:javascript|vbscript):[\s\S]*?\2/gi;
const DANGEROUS_DATA_HTML_PATTERN =
  /\ssrc\s*=\s*(["'])\s*data:text\/html[\s\S]*?\1/gi;

export function sanitizeReadingHtml(html: string) {
  if (!html) {
    return "";
  }

  return html
    .replace(BLOCKED_TAG_PATTERN, "")
    .replace(SELF_CLOSING_BLOCKED_TAG_PATTERN, "")
    .replace(EVENT_HANDLER_ATTRIBUTE_PATTERN, "")
    .replace(DANGEROUS_URL_ATTRIBUTE_PATTERN, "")
    .replace(DANGEROUS_DATA_HTML_PATTERN, "");
}
