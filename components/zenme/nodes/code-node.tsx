"use client";

import { useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Code2, Copy } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import {
  NodeActionHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { renderHighlightedCode } from "@/components/zenme/nodes/renderers/code-highlight";
import { writeTextToClipboard } from "@/lib/clipboard";

const CODE_LANGUAGE_OPTIONS = [
  { label: "Python", value: "python" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "TSX", value: "tsx" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
  { label: "JSON", value: "json" },
  { label: "SQL", value: "sql" },
  { label: "Shell", value: "bash" },
  { label: "Go", value: "go" },
  { label: "Rust", value: "rust" },
  { label: "Java", value: "java" },
  { label: "C++", value: "cpp" },
  { label: "C#", value: "csharp" },
  { label: "Plain Text", value: "text" },
] as const;

export function CodeNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const [code, setCode] = useState(nodeData.codeContent ?? "");
  const [language, setLanguage] = useState(nodeData.codeLanguage ?? "python");
  const [isRenaming, setIsRenaming] = useState(false);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const codeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setCode(nodeData.codeContent ?? "");
  }, [nodeData.codeContent]);

  useEffect(() => {
    setLanguage(nodeData.codeLanguage ?? "python");
  }, [nodeData.codeLanguage]);

  useEffect(() => {
    return () => {
      if (codeSyncTimer.current) {
        clearTimeout(codeSyncTimer.current);
        codeSyncTimer.current = null;
      }
    };
  }, []);

  function syncCode(nextCode = code, nextLanguage = language) {
    if (codeSyncTimer.current) {
      clearTimeout(codeSyncTimer.current);
      codeSyncTimer.current = null;
    }

    nodeData.onUpdateCodeNode?.(id, {
      codeContent: nextCode,
      codeLanguage: nextLanguage,
    });
  }

  function scheduleCodeSync(nextCode: string, nextLanguage = language) {
    if (codeSyncTimer.current) {
      clearTimeout(codeSyncTimer.current);
    }

    codeSyncTimer.current = setTimeout(() => {
      syncCode(nextCode, nextLanguage);
    }, 300);
  }

  function copyCode() {
    const value = code.trim();
    if (!value) {
      return;
    }

    void writeTextToClipboard(value);
  }

  return (
    <div className={`zenme-code-node group relative h-full w-full ${isRenaming ? "zenme-node-renaming" : ""}`}>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextTargetHandle />
      <EditableNodeTitle
        fallbackTitle="代码"
        icon={<Code2 className="size-4" />}
        iconClassName="zenme-code-node-drag-handle"
        onCommit={(title) => nodeData.onUpdateCodeNode?.(id, { title })}
        onEditingChange={setIsRenaming}
        title={nodeData.title}
      />
      <div
        className={`zenme-shadow-node nodrag nowheel flex h-full min-h-[240px] w-full min-w-[420px] flex-col overflow-hidden rounded-xl border bg-white text-zinc-950 ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
      >
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-3">
          <select
            aria-label="选择编程语言"
            className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-600 outline-none transition hover:border-zinc-300 focus:border-zinc-400"
            onChange={(event) => {
              const nextLanguage = event.target.value;
              setLanguage(nextLanguage);
              syncCode(code, nextLanguage);
            }}
            value={language}
          >
            {CODE_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="flex size-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
            onClick={copyCode}
            title="复制代码"
            type="button"
          >
            <Copy className="size-4" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
          <div
            aria-hidden
            className="zenme-code-highlight absolute inset-0 overflow-auto px-4 py-3 font-mono text-[13px] leading-6"
            ref={highlightRef}
          >
            {renderHighlightedCode(code, language)}
          </div>
          <textarea
            aria-label="代码内容"
            className="zenme-code-editor absolute inset-0 resize-none overflow-auto bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-transparent caret-zinc-950 outline-none placeholder:text-zinc-400"
            onBlur={() => syncCode()}
            onChange={(event) => {
              const nextCode = event.target.value;
              setCode(nextCode);
              scheduleCodeSync(nextCode);
            }}
            onScroll={(event) => {
              if (!highlightRef.current) {
                return;
              }

              highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
              highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
            placeholder="在这里输入代码..."
            spellCheck={false}
            value={code}
          />
        </div>
      </div>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected)}
        lineClassName="zenme-text-resize-line"
        minHeight={240}
        minWidth={420}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
}
