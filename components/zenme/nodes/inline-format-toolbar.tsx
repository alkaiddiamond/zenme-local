"use client";

import {
  Archive,
  Bold,
  Code2,
  Eye,
  Italic,
  ListOrdered,
  Pencil,
  Plus,
  Underline,
} from "lucide-react";

import {
  ZenmeNodeToolbar,
  ZenmeNodeToolbarButton,
  ZenmeNodeToolbarDivider,
} from "@/components/zenme/nodes/node-toolbar";

type InlineFormatToolbarProps = {
  codeLanguage?: string;
  lineNumbersVisible?: boolean;
  mode?: "code" | "markdown" | "plain";
  markdownEditing?: boolean;
  onBold: () => void;
  onArchive?: () => void;
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
  onArchive,
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
  const shouldShowModeControls = mode && onChangeMode;

  return (
    <ZenmeNodeToolbar>
      <ZenmeNodeToolbarButton label="Bold" onPress={onBold}>
        <Bold className="size-4" />
      </ZenmeNodeToolbarButton>
      <ZenmeNodeToolbarButton label="Italic" onPress={onItalic}>
        <Italic className="size-4" />
      </ZenmeNodeToolbarButton>
      <ZenmeNodeToolbarButton label="Underline" onPress={onUnderline}>
        <Underline className="size-4" />
      </ZenmeNodeToolbarButton>
      <ZenmeNodeToolbarButton label="Mark as code" onPress={onCode}>
        <Code2 className="size-4" />
      </ZenmeNodeToolbarButton>
      <ZenmeNodeToolbarButton label="创建画布节点" onPress={onCreateNode}>
        <Plus className="size-4" />
      </ZenmeNodeToolbarButton>
      {onToggleLineNumbers ? (
        <ZenmeNodeToolbarButton
          active={lineNumbersVisible}
          label={lineNumbersVisible ? "隐藏行号" : "显示行号"}
          onPress={onToggleLineNumbers}
        >
          <ListOrdered className="size-4" />
        </ZenmeNodeToolbarButton>
      ) : null}
      {shouldShowModeControls ? (
        <>
          <ZenmeNodeToolbarDivider />
          {mode === "markdown" && onToggleMarkdownEditing ? (
            <ZenmeNodeToolbarButton
              label={markdownEditing ? "预览 Markdown" : "编辑 Markdown 源码"}
              onPress={() => onToggleMarkdownEditing(!markdownEditing)}
            >
              {markdownEditing ? (
                <Eye className="size-4" />
              ) : (
                <Pencil className="size-4" />
              )}
            </ZenmeNodeToolbarButton>
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
      {onArchive ? (
        <>
          <ZenmeNodeToolbarDivider />
          <ZenmeNodeToolbarButton label="归档" onPress={onArchive}>
            <Archive className="size-4" />
          </ZenmeNodeToolbarButton>
        </>
      ) : null}
    </ZenmeNodeToolbar>
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
