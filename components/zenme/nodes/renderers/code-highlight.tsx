const CODE_KEYWORDS = new Set([
  "and",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "def",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "except",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "interface",
  "let",
  "match",
  "new",
  "none",
  "null",
  "or",
  "package",
  "pass",
  "private",
  "protected",
  "public",
  "return",
  "select",
  "static",
  "struct",
  "switch",
  "then",
  "throw",
  "true",
  "try",
  "type",
  "undefined",
  "use",
  "var",
  "where",
  "while",
  "with",
  "yield",
]);

export type CodeToken = {
  kind: "comment" | "keyword" | "number" | "plain" | "string";
  text: string;
};

export function renderHighlightedCode(
  code: string,
  language: string,
  wrapLines = false,
) {
  const lines = code ? code.split("\n") : [""];

  return lines.map((line, lineIndex) => (
    <div
      className={`min-h-6 ${
        wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"
      }`}
      key={`${lineIndex}-${line}`}
    >
      {tokenizeCodeLine(line, language).map((token, tokenIndex) => (
        <span
          className={codeTokenClassName(token.kind)}
          key={`${lineIndex}-${tokenIndex}`}
        >
          {token.text}
        </span>
      ))}
    </div>
  ));
}

export function tokenizeCodeLine(line: string, language: string): CodeToken[] {
  if (!line) {
    return [{ kind: "plain", text: " " }];
  }

  const commentIndex = getCommentIndex(line, language);
  const codePart = commentIndex >= 0 ? line.slice(0, commentIndex) : line;
  const commentPart = commentIndex >= 0 ? line.slice(commentIndex) : "";
  const tokens = tokenizeCodePart(codePart);

  if (commentPart) {
    tokens.push({ kind: "comment", text: commentPart });
  }

  return tokens.length ? tokens : [{ kind: "plain", text: " " }];
}

function getCommentIndex(line: string, language: string) {
  if (language === "python" || language === "bash") {
    return line.indexOf("#");
  }

  if (language === "sql") {
    return line.indexOf("--");
  }

  return line.indexOf("//");
}

function tokenizeCodePart(value: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const pattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ kind: "plain", text: value.slice(cursor, index) });
    }

    const text = match[0];
    const lowerText = text.toLowerCase();
    const kind: CodeToken["kind"] =
      text.startsWith('"') || text.startsWith("'") || text.startsWith("`")
        ? "string"
        : /^\d/.test(text)
          ? "number"
          : CODE_KEYWORDS.has(lowerText)
            ? "keyword"
            : "plain";

    tokens.push({ kind, text });
    cursor = index + text.length;
  }

  if (cursor < value.length) {
    tokens.push({ kind: "plain", text: value.slice(cursor) });
  }

  return tokens;
}

function codeTokenClassName(kind: CodeToken["kind"]) {
  if (kind === "comment") {
    return "text-zinc-400";
  }

  if (kind === "keyword") {
    return "font-semibold text-blue-600";
  }

  if (kind === "number") {
    return "text-fuchsia-600";
  }

  if (kind === "string") {
    return "text-emerald-600";
  }

  return "text-zinc-800";
}
