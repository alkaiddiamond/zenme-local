"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { InlineFormatToolbar } from "@/components/zenme/nodes/inline-format-toolbar";
import {
  NodeActionHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { renderMarkdown } from "@/components/zenme/nodes/renderers/markdown";
import { stripLegacyRichTextHtml } from "@/components/zenme/nodes/renderers/rich-text";

export function MarkdownNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null);
  const editorSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMarkdown = useMemo(
    () => nodeData.plainText ?? stripLegacyRichTextHtml(nodeData.richTextHtml),
    [nodeData.plainText, nodeData.richTextHtml],
  );
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [isEditing, setIsEditing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    setMarkdown(initialMarkdown);
  }, [initialMarkdown, isEditing]);

  useEffect(() => {
    return () => {
      if (editorSyncTimer.current) {
        clearTimeout(editorSyncTimer.current);
        editorSyncTimer.current = null;
      }
    };
  }, []);

  function syncMarkdownContent(nextMarkdown = markdown) {
    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
      editorSyncTimer.current = null;
    }

    if (
      nextMarkdown === (nodeData.plainText ?? "") &&
      (nodeData.richTextHtml ?? "") === ""
    ) {
      return;
    }

    nodeData.onUpdateTextNode?.(id, {
      plainText: nextMarkdown,
      richTextHtml: "",
    });
  }

  function scheduleMarkdownSync(nextMarkdown: string) {
    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
    }

    editorSyncTimer.current = setTimeout(() => {
      syncMarkdownContent(nextMarkdown);
    }, 500);
  }

  function insertMarkdownMarkup(prefix: string, suffix: string, fallback: string) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = markdown.slice(start, end) || fallback;
    const inserted = `${prefix}${selectedText}${suffix}`;
    const nextMarkdown =
      markdown.slice(0, start) + inserted + markdown.slice(end);

    setMarkdown(nextMarkdown);
    syncMarkdownContent(nextMarkdown);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selectedText.length,
      );
    });
  }

  function createNodeFromSelection() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const selectedText = markdown
      .slice(editor.selectionStart, editor.selectionEnd)
      .trim();

    if (!selectedText) {
      return;
    }

    nodeData.onCreateTextChildNode?.(id, selectedText);
  }

  function clearEditorSelection() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.setSelectionRange(editor.selectionEnd, editor.selectionEnd);
  }

  return (
    <div className={`zenme-markdown-node group relative h-full w-full ${isRenaming ? "zenme-node-renaming" : ""}`}>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextTargetHandle />
      <EditableNodeTitle
        fallbackTitle="Markdown"
        icon={<FileText className="size-4" />}
        onCommit={(title) => nodeData.onUpdateTextNode?.(id, { title })}
        onEditingChange={setIsRenaming}
        title={nodeData.title}
      />
      {selected || isEditing ? (
        <InlineFormatToolbar
          onBold={() => insertMarkdownMarkup("**", "**", "粗体文本")}
          onCode={() => insertMarkdownMarkup("`", "`", "code")}
          onCreateNode={createNodeFromSelection}
          onItalic={() => insertMarkdownMarkup("*", "*", "斜体文本")}
          onUnderline={() => insertMarkdownMarkup("<u>", "</u>", "下划线文本")}
        />
      ) : null}
      <div
        className={`zenme-shadow-node relative h-full min-h-[180px] w-full overflow-hidden rounded-xl border bg-white text-zinc-950 ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
      >
        {!isEditing ? (
          <div
            aria-hidden
            className="zenme-markdown-preview pointer-events-none absolute inset-0 overflow-auto px-6 pb-10 pt-5 text-base leading-7"
            ref={markdownPreviewRef}
          >
            {markdown.trim() ? (
              renderMarkdown(markdown)
            ) : (
              <p className="text-base leading-7 text-zinc-400">
                点击此处编辑 Markdown
              </p>
            )}
          </div>
        ) : null}
        <textarea
          aria-label="Markdown 文本"
          className={`zenme-markdown-editor nodrag nowheel absolute inset-0 resize-none overflow-auto bg-transparent px-6 pb-10 pt-5 text-base leading-7 caret-zinc-950 outline-none ${
            isEditing ? "text-zinc-800" : "text-transparent"
          }`}
          onBlur={() => {
            setIsEditing(false);
            syncMarkdownContent(editorRef.current?.value ?? markdown);
            clearEditorSelection();
          }}
          onChange={(event) => {
            const nextMarkdown = event.target.value;
            setMarkdown(nextMarkdown);
            scheduleMarkdownSync(nextMarkdown);
          }}
          onFocus={() => setIsEditing(true)}
          onScroll={(event) => {
            if (!markdownPreviewRef.current) {
              return;
            }

            const editor = event.currentTarget;
            const preview = markdownPreviewRef.current;
            const editorMaxScrollTop = editor.scrollHeight - editor.clientHeight;
            const previewMaxScrollTop = preview.scrollHeight - preview.clientHeight;

            preview.scrollLeft = editor.scrollLeft;
            preview.scrollTop = editorMaxScrollTop > 0
              ? (editor.scrollTop / editorMaxScrollTop) * previewMaxScrollTop
              : 0;
          }}
          ref={editorRef}
          spellCheck={false}
          value={markdown}
        />
      </div>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected || isEditing)}
        lineClassName="zenme-text-resize-line"
        minHeight={180}
        minWidth={320}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
}
