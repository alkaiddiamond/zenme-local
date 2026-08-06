"use client";

import type { CSSProperties, ReactNode } from "react";
import { useViewport } from "@xyflow/react";
import {
  Bold,
  Code2,
  Eye,
  Italic,
  ListOrdered,
  Pencil,
  Plus,
  Underline,
} from "lucide-react";

type InlineFormatToolbarProps = {
  codeLanguage?: string;
  lineNumbersVisible?: boolean;
  mode?: "code" | "markdown" | "plain";
  markdownEditing?: boolean;
  onBold: () => void;
  onChangeCodeLanguage?: (language: string) => void;
  onChangeMode?: (mode: "code" | "markdown" | "plain") => void;
  onCode: () => void;
  onCreateNode: () => void;
  onItalic: () => void;
  onToggleLineNumbers?: () => void;
  onToggleMarkdownEditing?: (editing: boolean) => void;
  onUnderline: () => void;
};

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

export function InlineFormatToolbar({
  codeLanguage,
  lineNumbersVisible,
  mode,
  markdownEditing,
  onBold,
  onChangeCodeLanguage,
  onChangeMode,
  onCode,
  onCreateNode,
  onItalic,
  onToggleLineNumbers,
  onToggleMarkdownEditing,
  onUnderline,
}: InlineFormatToolbarProps) {
  const { zoom } = useViewport();
  const shouldShowModeControls = mode && onChangeMode;
  const toolbarScale = 1 / Math.max(zoom, 0.2);
  const toolbarStyle: CSSProperties = {
    top: `${-56 / Math.max(zoom, 0.2)}px`,
    transform: `translateX(-50%) scale(${toolbarScale})`,
    transformOrigin: "top center",
  };

  return (
    <div
      className="zenme-node-floating-control zenme-shadow-canvas nodrag nowheel absolute left-1/2 z-20 flex max-w-[calc(100vw-48px)] items-center gap-1 overflow-hidden rounded-full border border-zinc-200 bg-white/95 p-1.5 text-zinc-600 backdrop-blur"
      style={toolbarStyle}
    >
      <InlineFormatButton label="Bold" onPress={onBold}>
        <Bold className="size-4" />
      </InlineFormatButton>
      <InlineFormatButton label="Italic" onPress={onItalic}>
        <Italic className="size-4" />
      </InlineFormatButton>
      <InlineFormatButton label="Underline" onPress={onUnderline}>
        <Underline className="size-4" />
      </InlineFormatButton>
      <InlineFormatButton label="Mark as code" onPress={onCode}>
        <Code2 className="size-4" />
      </InlineFormatButton>
      <InlineFormatButton label="创建画布节点" onPress={onCreateNode}>
        <Plus className="size-4" />
      </InlineFormatButton>
      {onToggleLineNumbers ? (
        <InlineFormatButton
          active={lineNumbersVisible}
          label={lineNumbersVisible ? "隐藏行号" : "显示行号"}
          onPress={onToggleLineNumbers}
        >
          <ListOrdered className="size-4" />
        </InlineFormatButton>
      ) : null}
      {shouldShowModeControls ? (
        <>
          <span className="mx-1 h-6 w-px bg-zinc-200" />
          {mode === "markdown" && onToggleMarkdownEditing ? (
            <InlineFormatButton
              label={markdownEditing ? "预览 Markdown" : "编辑 Markdown 源码"}
              onPress={() => onToggleMarkdownEditing(!markdownEditing)}
            >
              {markdownEditing ? (
                <Eye className="size-4" />
              ) : (
                <Pencil className="size-4" />
              )}
            </InlineFormatButton>
          ) : null}
          <TextModeButton
            active={mode === "plain"}
            label="纯文本"
            onPress={() => onChangeMode("plain")}
          />
          <TextModeButton
            active={mode === "markdown"}
            label="Markdown"
            onPress={() => onChangeMode("markdown")}
          />
          <TextModeButton
            active={mode === "code"}
            label="代码"
            onPress={() => onChangeMode("code")}
          />
          {mode === "code" && onChangeCodeLanguage ? (
            <select
              aria-label="选择编程语言"
              className="ml-1 h-7 rounded-full border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-600 outline-none transition hover:border-zinc-300 focus:border-zinc-400"
              onChange={(event) => onChangeCodeLanguage(event.target.value)}
              onMouseDown={(event) => event.stopPropagation()}
              value={codeLanguage ?? "python"}
            >
              {CODE_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function InlineFormatButton({
  active = false,
  children,
  label,
  onPress,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex size-7 items-center justify-center rounded-full transition hover:bg-zinc-100 hover:text-zinc-950 ${
        active ? "bg-zinc-950 text-white hover:bg-zinc-800 hover:text-white" : ""
      }`}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function TextModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      className={`h-7 shrink-0 rounded-full px-3 text-xs font-medium transition ${
        active
          ? "bg-zinc-950 text-white"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
      }`}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      type="button"
    >
      {label}
    </button>
  );
}
