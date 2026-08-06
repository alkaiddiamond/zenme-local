import type { ReactNode } from "react";
import katex from "katex";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";

export type MarkdownBlock = {
  alignments?: Array<"center" | "left" | "right">;
  content: string;
  headers?: string[];
  key: string;
  rows?: string[][];
  type: "blank" | "code" | "h1" | "h2" | "h3" | "list" | "math" | "p" | "quote" | "table";
};

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let codeBlock: string[] | null = null;
  let codeBlockIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      if (codeBlock) {
        blocks.push({
          content: codeBlock.join("\n"),
          key: `code-${codeBlockIndex}`,
          type: "code",
        });
        codeBlock = null;
        codeBlockIndex += 1;
      } else {
        codeBlock = [];
      }
      continue;
    }

    if (codeBlock) {
      codeBlock.push(line);
      continue;
    }

    const trimmed = line.trim();
    const mathBlock = readMathBlock(lines, index);
    if (mathBlock) {
      blocks.push({
        content: mathBlock.content,
        key: `math-${index}`,
        type: "math",
      });
      index = mathBlock.endIndex;
      continue;
    }
    const nextLine = lines[index + 1]?.trim() ?? "";
    if (isTableRow(trimmed) && isTableSeparator(nextLine)) {
      const headers = parseTableRow(trimmed);
      const alignments = parseTableAlignments(nextLine);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim())) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({
        alignments,
        content: "",
        headers,
        key: `table-${index - rows.length - 1}`,
        rows,
        type: "table",
      });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        content: heading[2],
        key: `heading-${index}`,
        type: `h${heading[1].length}` as MarkdownBlock["type"],
      });
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (quote) {
      blocks.push({
        content: quote[1],
        key: `quote-${index}`,
        type: "quote",
      });
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      blocks.push({
        content: listItem[1],
        key: `list-${index}`,
        type: "list",
      });
      continue;
    }

    blocks.push({
      content: line,
      key: `p-${index}`,
      type: trimmed ? "p" : "blank",
    });
  }

  const remainingCodeBlock = codeBlock as string[] | null;
  if (remainingCodeBlock) {
    blocks.push({
      content: remainingCodeBlock.join("\n"),
      key: `code-${codeBlockIndex}`,
      type: "code",
    });
  }

  return mergeConsecutiveParagraphLines(blocks);
}

function mergeConsecutiveParagraphLines(blocks: MarkdownBlock[]) {
  return blocks.reduce<MarkdownBlock[]>((result, block) => {
    const previous = result.at(-1);
    if (block.type === "p" && previous?.type === "p") {
      previous.content = `${previous.content}\n${block.content}`;
      return result;
    }
    result.push({ ...block });
    return result;
  }, []);
}

export function renderMarkdown(markdown: string) {
  return parseMarkdownBlocks(markdown).map((block) => {
    if (block.type === "blank") {
      return <div className="h-4" key={block.key} />;
    }

    if (block.type === "code") {
      return (
        <pre
          className="my-2 overflow-hidden rounded-md bg-zinc-100 px-3 py-2 font-mono text-sm leading-6 text-zinc-800"
          data-markdown-block
          key={block.key}
        >
          <code>{block.content || " "}</code>
        </pre>
      );
    }

    if (block.type === "math") {
      return renderKatex(block.content, true, block.key);
    }

    if (block.type === "table") {
      return (
        <OverlayScrollArea
          className="my-3 max-w-full rounded-md border border-zinc-200"
          contentKey={`${block.headers?.length ?? 0}:${block.rows?.length ?? 0}`}
          data-markdown-block
          key={block.key}
          viewportClassName="overflow-x-auto"
        >
          <table className="w-full table-fixed border-collapse text-left text-sm text-zinc-800">
            <thead className="bg-zinc-100 text-zinc-950">
              <tr>
                {block.headers?.map((header, index) => (
                  <th
                    className="break-words border-b border-r border-zinc-200 px-3 py-2 font-semibold [overflow-wrap:anywhere] last:border-r-0"
                    key={`header-${index}`}
                    style={{ textAlign: block.alignments?.[index] ?? "left" }}
                  >
                    {renderMarkdownInline(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows?.map((row, rowIndex) => (
                <tr className="border-b border-zinc-200 last:border-b-0" key={`row-${rowIndex}`}>
                  {(block.headers ?? []).map((_, columnIndex) => (
                    <td
                      className="break-words border-r border-zinc-200 px-3 py-2 align-top [overflow-wrap:anywhere] last:border-r-0"
                      key={`cell-${rowIndex}-${columnIndex}`}
                      style={{ textAlign: block.alignments?.[columnIndex] ?? "left" }}
                    >
                      {renderMarkdownInline(row[columnIndex] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </OverlayScrollArea>
      );
    }

    if (block.type === "h1") {
      return (
        <h1 className="mb-2 text-2xl font-semibold text-zinc-950" data-markdown-block key={block.key}>
          {renderMarkdownInline(block.content)}
        </h1>
      );
    }

    if (block.type === "h2") {
      return (
        <h2 className="mb-2 text-xl font-semibold text-zinc-950" data-markdown-block key={block.key}>
          {renderMarkdownInline(block.content)}
        </h2>
      );
    }

    if (block.type === "h3") {
      return (
        <h3 className="mb-1.5 text-lg font-semibold text-zinc-950" data-markdown-block key={block.key}>
          {renderMarkdownInline(block.content)}
        </h3>
      );
    }

    if (block.type === "quote") {
      return (
        <blockquote
          className="my-1 border-l-2 border-zinc-300 pl-3 text-zinc-500"
          data-markdown-block
          key={block.key}
        >
          {renderMarkdownInline(block.content)}
        </blockquote>
      );
    }

    if (block.type === "list") {
      return (
        <ul
          className="my-1 list-disc pl-5 text-base leading-7 text-zinc-800"
          data-markdown-block
          key={block.key}
        >
          <li>{renderMarkdownInline(block.content)}</li>
        </ul>
      );
    }

    return (
      <p className="mb-2 text-base leading-7 text-zinc-800" data-markdown-block key={block.key}>
        {renderMarkdownInline(block.content)}
      </p>
    );
  });
}

function isTableRow(line: string) {
  return line.includes("|") && parseTableRow(line).length > 1;
}

function isTableSeparator(line: string) {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function parseTableAlignments(line: string): Array<"center" | "left" | "right"> {
  return parseTableRow(line).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });
}

function readMathBlock(lines: string[], startIndex: number) {
  const trimmed = lines[startIndex].trim();
  const delimiters = trimmed.startsWith("\\[")
    ? { close: "\\]", open: "\\[" }
    : trimmed.startsWith("$$")
      ? { close: "$$", open: "$$" }
      : undefined;
  if (!delimiters) return undefined;

  const firstLine = trimmed.slice(delimiters.open.length);
  const firstCloseIndex = firstLine.indexOf(delimiters.close);
  if (firstCloseIndex >= 0) {
    return {
      content: firstLine.slice(0, firstCloseIndex).trim(),
      endIndex: startIndex,
    };
  }

  const content = firstLine ? [firstLine] : [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const closeIndex = lines[index].indexOf(delimiters.close);
    if (closeIndex >= 0) {
      content.push(lines[index].slice(0, closeIndex));
      return {
        content: content.join("\n").trim(),
        endIndex: index,
      };
    }
    content.push(lines[index]);
  }

  return undefined;
}

function renderMarkdownInline(text: string) {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\\\((?:\\.|[^\\])*?\\\)|(?<!\\)\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)(?<!\\)\$|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<u>.*?<\/u>|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    const value = match[0];
    const key = `${index}-${value}`;

    if (value.startsWith("\\(") || value.startsWith("$")) {
      nodes.push(renderKatex(
        value.startsWith("\\(") ? value.slice(2, -2) : value.slice(1, -1),
        false,
        key,
      ));
    } else if (value.startsWith("**")) {
      nodes.push(<strong key={key}>{value.slice(2, -2)}</strong>);
    } else if (value.startsWith("*")) {
      nodes.push(<em key={key}>{value.slice(1, -1)}</em>);
    } else if (value.startsWith("`")) {
      nodes.push(
        <code
          className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] text-zinc-800"
          key={key}
        >
          {value.slice(1, -1)}
        </code>,
      );
    } else if (value.startsWith("<u>")) {
      nodes.push(<u key={key}>{value.slice(3, -4)}</u>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
      nodes.push(
        <span className="text-blue-600 underline underline-offset-2" key={key}>
          {link?.[1] ?? value}
        </span>,
      );
    }

    cursor = index + value.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes.length ? nodes : " ";
}

function renderKatex(content: string, displayMode: boolean, key: string) {
  const html = katex.renderToString(content, {
    displayMode,
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });
  if (displayMode) {
    return (
      <OverlayScrollArea
        className="my-3 max-w-full"
        contentKey={content}
        data-markdown-block
        key={key}
        viewportClassName="overflow-x-auto overflow-y-hidden py-1 text-center"
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </OverlayScrollArea>
    );
  }
  return (
    <span
      className="inline-block max-w-full align-middle"
      dangerouslySetInnerHTML={{ __html: html }}
      key={key}
    />
  );
}
