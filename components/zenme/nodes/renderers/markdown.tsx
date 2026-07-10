import type { ReactNode } from "react";

export type MarkdownBlock = {
  content: string;
  key: string;
  type: "blank" | "code" | "h1" | "h2" | "h3" | "list" | "p" | "quote";
};

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let codeBlock: string[] | null = null;
  let codeBlockIndex = 0;

  lines.forEach((line, index) => {
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
      return;
    }

    if (codeBlock) {
      codeBlock.push(line);
      return;
    }

    const trimmed = line.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        content: heading[2],
        key: `heading-${index}`,
        type: `h${heading[1].length}` as MarkdownBlock["type"],
      });
      return;
    }

    const quote = /^>\s?(.+)$/.exec(trimmed);
    if (quote) {
      blocks.push({
        content: quote[1],
        key: `quote-${index}`,
        type: "quote",
      });
      return;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      blocks.push({
        content: listItem[1],
        key: `list-${index}`,
        type: "list",
      });
      return;
    }

    blocks.push({
      content: line,
      key: `p-${index}`,
      type: trimmed ? "p" : "blank",
    });
  });

  const remainingCodeBlock = codeBlock as string[] | null;
  if (remainingCodeBlock) {
    blocks.push({
      content: remainingCodeBlock.join("\n"),
      key: `code-${codeBlockIndex}`,
      type: "code",
    });
  }

  return blocks;
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
          key={block.key}
        >
          <code>{block.content || " "}</code>
        </pre>
      );
    }

    if (block.type === "h1") {
      return (
        <h1 className="mb-2 text-2xl font-semibold text-zinc-950" key={block.key}>
          {renderMarkdownInline(block.content)}
        </h1>
      );
    }

    if (block.type === "h2") {
      return (
        <h2 className="mb-2 text-xl font-semibold text-zinc-950" key={block.key}>
          {renderMarkdownInline(block.content)}
        </h2>
      );
    }

    if (block.type === "h3") {
      return (
        <h3 className="mb-1.5 text-lg font-semibold text-zinc-950" key={block.key}>
          {renderMarkdownInline(block.content)}
        </h3>
      );
    }

    if (block.type === "quote") {
      return (
        <blockquote
          className="my-1 border-l-2 border-zinc-300 pl-3 text-zinc-500"
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
          key={block.key}
        >
          <li>{renderMarkdownInline(block.content)}</li>
        </ul>
      );
    }

    return (
      <p className="mb-2 text-base leading-7 text-zinc-800" key={block.key}>
        {renderMarkdownInline(block.content)}
      </p>
    );
  });
}

function renderMarkdownInline(text: string) {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|<u>.*?<\/u>|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    const value = match[0];
    const key = `${index}-${value}`;

    if (value.startsWith("**")) {
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
