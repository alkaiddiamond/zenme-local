"use client";

import {
  type ClipboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import {
  Bot,
  Copy,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Sparkles,
  StickyNote,
} from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  NodeActionHandle,
  NodeContextHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { InlineFormatToolbar } from "@/components/zenme/nodes/inline-format-toolbar";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { renderHighlightedCode } from "@/components/zenme/nodes/renderers/code-highlight";
import { renderMarkdown } from "@/components/zenme/nodes/renderers/markdown";
import {
  escapeHtml,
  plainTextToRichTextHtml,
  stripLegacyRichTextHtml,
} from "@/components/zenme/nodes/renderers/rich-text";
import { TextNodeComposer } from "@/components/zenme/nodes/text-node-composer";
import { ImageTaskTiming } from "@/components/zenme/nodes/image-task-timing";
import { writeTextToClipboard } from "@/lib/clipboard";

type TextDisplayMode = "code" | "markdown" | "plain";

export function TextNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const isAgent = nodeData.kind === "agent";
  const isTextNode = nodeData.kind === "text";
  const isTextExpanded = Boolean(nodeData.textExpanded);
  const suppressFloatingControls = Boolean(nodeData.isMultiSelection);
  const displayMode = getTextDisplayMode(nodeData);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const markdownEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const codeHighlightRef = useRef<HTMLDivElement | null>(null);
  const editorSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSwitchingMode = useRef(false);
  const initialRichTextHtml = useMemo(
    () =>
      nodeData.richTextHtml ||
      plainTextToRichTextHtml(nodeData.plainText) ||
      "",
    [nodeData.plainText, nodeData.richTextHtml],
  );
  const initialPlainText = useMemo(
    () =>
      nodeData.plainText ??
      nodeData.codeContent ??
      stripLegacyRichTextHtml(nodeData.richTextHtml),
    [nodeData.codeContent, nodeData.plainText, nodeData.richTextHtml],
  );
  const latestTextRef = useRef(initialPlainText);
  const [isEditing, setIsEditing] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [plainText, setPlainText] = useState(initialPlainText);
  const [codeLanguage, setCodeLanguage] = useState(
    nodeData.codeLanguage ?? "python",
  );
  const Icon = isAgent ? Bot : StickyNote;

  function copyText(value?: string) {
    const text = value?.trim();
    if (!text) {
      return;
    }

    void writeTextToClipboard(text);
  }

  useEffect(() => {
    const editor = editorRef.current;
    if (isAgent || isEditing || !editor) {
      return;
    }

    if (editor.innerHTML !== initialRichTextHtml) {
      editor.innerHTML = initialRichTextHtml;
    }
  }, [initialRichTextHtml, isAgent, isEditing]);

  useEffect(() => {
    if (isSwitchingMode.current) {
      return;
    }

    latestTextRef.current = initialPlainText;
    if (!isEditing || displayMode === "plain") {
      setPlainText(initialPlainText);
    }
  }, [displayMode, initialPlainText, isEditing]);

  useEffect(() => {
    setCodeLanguage(nodeData.codeLanguage ?? "python");
  }, [nodeData.codeLanguage]);

  useEffect(() => {
    return () => {
      if (editorSyncTimer.current) {
        clearTimeout(editorSyncTimer.current);
        editorSyncTimer.current = null;
      }
    };
  }, []);

  function readEditorContent() {
    const editor = editorRef.current;

    return {
      plainText: editor?.innerText ?? "",
      richTextHtml: editor?.innerHTML ?? "",
    };
  }

  function rememberText(nextText: string) {
    latestTextRef.current = nextText;
    setPlainText(nextText);
  }

  function readCurrentTextContent() {
    let currentText: string;
    if (displayMode === "markdown") {
      currentText = markdownEditorRef.current?.value ?? plainText;
    } else if (displayMode === "code") {
      currentText = codeEditorRef.current?.value ?? plainText;
    } else {
      currentText = editorRef.current?.innerText ?? nodeData.plainText ?? plainText;
    }

    return currentText || latestTextRef.current;
  }

  function syncEditorContent() {
    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
      editorSyncTimer.current = null;
    }

    if (isAgent) {
      return;
    }

    const nextContent = readEditorContent();
    latestTextRef.current = nextContent.plainText;
    if (
      nextContent.plainText === (nodeData.plainText ?? "") &&
      nextContent.richTextHtml === (nodeData.richTextHtml ?? "")
    ) {
      return;
    }

    nodeData.onUpdateTextNode?.(id, nextContent);
  }

  function syncPlainTextContent(nextText = plainText) {
    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
      editorSyncTimer.current = null;
    }

    const nextCodeContent = displayMode === "code" ? nextText : undefined;
    latestTextRef.current = nextText;
    if (
      nextText === (nodeData.plainText ?? "") &&
      (displayMode !== "code" || nextCodeContent === nodeData.codeContent)
    ) {
      return;
    }

    nodeData.onUpdateTextNode?.(id, {
      codeContent: nextCodeContent,
      plainText: nextText,
      richTextHtml: "",
    });
  }

  function schedulePlainTextSync(nextText: string) {
    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
    }

    editorSyncTimer.current = setTimeout(() => {
      syncPlainTextContent(nextText);
    }, 500);
  }

  function changeDisplayMode(nextMode: TextDisplayMode) {
    if (nextMode === displayMode) {
      return;
    }

    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
      editorSyncTimer.current = null;
    }

    isSwitchingMode.current = true;
    const currentText = readCurrentTextContent();
    nodeData.onUpdateTextNode?.(id, {
      codeContent: nextMode === "code" ? currentText : undefined,
      codeLanguage: nextMode === "code" ? codeLanguage : nodeData.codeLanguage,
      plainText: currentText,
      richTextHtml: nextMode === "plain" ? plainTextToRichTextHtml(currentText) : "",
      textMode: nextMode,
    });
    rememberText(currentText);
    setIsEditing(false);
    window.getSelection()?.removeAllRanges();
    if (nextMode === "plain") {
      const nextRichTextHtml = plainTextToRichTextHtml(currentText);
      window.requestAnimationFrame(() => {
        if (editorRef.current && editorRef.current.innerHTML !== nextRichTextHtml) {
          editorRef.current.innerHTML = nextRichTextHtml;
        }
      });
    }
    window.requestAnimationFrame(() => {
      isSwitchingMode.current = false;
    });
  }

  function changeCodeLanguage(nextLanguage: string) {
    setCodeLanguage(nextLanguage);
    const currentText = readCurrentTextContent();
    nodeData.onUpdateTextNode?.(id, {
      codeContent: currentText,
      codeLanguage: nextLanguage,
      plainText: currentText,
      textMode: "code",
    });
  }

  function scheduleEditorContentSync() {
    if (editorSyncTimer.current) {
      clearTimeout(editorSyncTimer.current);
    }

    editorSyncTimer.current = setTimeout(() => {
      syncEditorContent();
    }, 500);
  }

  function handlePlainTextInput() {
    latestTextRef.current = readEditorContent().plainText;
    scheduleEditorContentSync();
  }

  function applyTextCommand(command: "bold" | "italic" | "underline") {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.focus();
    document.execCommand(command);
    syncEditorContent();
  }

  function applyCodeMark() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const selectedText = selection.toString();
    document.execCommand(
      "insertHTML",
      false,
      `<code>${escapeHtml(selectedText)}</code>`,
    );
    syncEditorContent();
  }

  function createNodeFromSelection() {
    const selectedText =
      displayMode === "plain"
        ? window.getSelection()?.toString().trim()
        : getTextareaSelectionText(
            displayMode === "code"
              ? codeEditorRef.current
              : markdownEditorRef.current,
            plainText,
          );

    if (!selectedText) {
      return;
    }

    nodeData.onCreateTextChildNode?.(id, selectedText);
  }

  function insertMarkdownMarkup(prefix: string, suffix: string, fallback: string) {
    const editor = markdownEditorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = plainText.slice(start, end) || fallback;
    const inserted = `${prefix}${selectedText}${suffix}`;
    const nextMarkdown =
      plainText.slice(0, start) + inserted + plainText.slice(end);

    rememberText(nextMarkdown);
    syncPlainTextContent(nextMarkdown);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selectedText.length,
      );
    });
  }

  function clearEditorSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    handlePlainTextInput();
  }

  function focusPlainTextArea(editor: HTMLTextAreaElement | null) {
    if (!isEditing) {
      setIsEditing(true);
      window.getSelection()?.removeAllRanges();
      window.requestAnimationFrame(() => editor?.focus());
    }
  }

  if (!isAgent) {
    return (
      <div className={`zenme-text-node group relative h-full w-full ${isRenaming ? "zenme-node-renaming" : ""}`}>
        <NodeTargetHandle
          revealOnHover={false}
          visible={Boolean(nodeData.hasIncomingEdge)}
        />
        <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
        <NodeContextHandle selected={Boolean(selected)} />
        <NodeContextTargetHandle />
        <EditableNodeTitle
          displayFallback="请输入标题"
          fallbackTitle="文本"
          icon={<FileText className="size-4" />}
          onCommit={(title) => nodeData.onUpdateTextNode?.(id, { title })}
          onEditingChange={setIsRenaming}
          title={nodeData.title}
        />
        {!suppressFloatingControls && (selected || isEditing) ? (
          <InlineFormatToolbar
            codeLanguage={codeLanguage}
            mode={displayMode}
            onBold={() =>
              displayMode === "markdown"
                ? insertMarkdownMarkup("**", "**", "粗体文本")
                : applyTextCommand("bold")
            }
            onChangeCodeLanguage={changeCodeLanguage}
            onChangeMode={changeDisplayMode}
            onCode={() =>
              displayMode === "markdown"
                ? insertMarkdownMarkup("`", "`", "code")
                : applyCodeMark()
            }
            onCreateNode={createNodeFromSelection}
            onItalic={() =>
              displayMode === "markdown"
                ? insertMarkdownMarkup("*", "*", "斜体文本")
                : applyTextCommand("italic")
            }
            onUnderline={() =>
              displayMode === "markdown"
                ? insertMarkdownMarkup("<u>", "</u>", "下划线文本")
                : applyTextCommand("underline")
            }
          />
        ) : null}
        <div
          className={`zenme-shadow-node relative h-full min-h-[176px] w-full overflow-hidden rounded-xl border bg-white text-zinc-950 ${
            selected ? "border-zinc-900" : "border-zinc-200"
          }`}
        >
          {isTextNode ? (
            <div className="nodrag absolute right-3 top-3 z-20 flex items-center gap-1">
              <button
                aria-expanded={isTextExpanded}
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/90 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:bg-zinc-100 focus-visible:text-zinc-900"
                onClick={() =>
                  nodeData.onToggleTextExpanded?.(id, !isTextExpanded)
                }
                title={isTextExpanded ? "收起文本" : "展开为 A4 阅读面板"}
                type="button"
              >
                {isTextExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>
              <button
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/90 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:bg-zinc-100 focus-visible:text-zinc-900"
                onClick={() => copyText(readCurrentTextContent())}
                title="复制文本"
                type="button"
              >
                <Copy className="size-4" />
              </button>
            </div>
          ) : null}
          {displayMode === "plain" ? (
            <div
              className="zenme-text-node-editor nodrag nowheel h-full min-h-[176px] overflow-auto rounded-xl px-6 py-5 pr-24 text-base leading-7 text-zinc-800 outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]"
              contentEditable
              data-placeholder={isEditing ? "" : "点击此处编辑文本"}
              onBlur={() => {
                if (isSwitchingMode.current) {
                  return;
                }
                setIsEditing(false);
                syncEditorContent();
                clearEditorSelection();
              }}
              onFocus={() => setIsEditing(true)}
              onInput={handlePlainTextInput}
              onPaste={handlePaste}
              ref={editorRef}
              tabIndex={0}
              suppressContentEditableWarning
            />
          ) : null}
          {displayMode === "markdown" ? (
            <>
              {!isEditing ? (
                <div
                  aria-hidden
                  className="zenme-markdown-preview pointer-events-none absolute inset-0 overflow-auto px-6 pb-10 pr-24 pt-5 text-base leading-7"
                  ref={markdownPreviewRef}
                >
                  {plainText.trim() ? (
                    renderMarkdown(plainText)
                  ) : (
                    <p className="text-base leading-7 text-zinc-400">
                      点击此处编辑 Markdown
                    </p>
                  )}
                </div>
              ) : null}
              <textarea
                aria-label="Markdown 文本"
                className={`zenme-markdown-editor nodrag nowheel absolute inset-0 resize-none overflow-auto bg-transparent px-6 pb-10 pr-24 pt-5 text-base leading-7 caret-zinc-950 outline-none ${
                  isEditing
                    ? "text-zinc-800"
                    : "cursor-text text-transparent selection:bg-transparent"
                }`}
                onBlur={() => {
                  if (isSwitchingMode.current) {
                    return;
                  }
                  setIsEditing(false);
                  syncPlainTextContent(markdownEditorRef.current?.value ?? plainText);
                  markdownEditorRef.current?.setSelectionRange(
                    markdownEditorRef.current.selectionEnd,
                    markdownEditorRef.current.selectionEnd,
                  );
                }}
                onChange={(event) => {
                  const nextText = event.target.value;
                  rememberText(nextText);
                  schedulePlainTextSync(nextText);
                }}
                onFocus={() => setIsEditing(true)}
                onMouseDown={(event) => {
                  if (isEditing) {
                    return;
                  }

                  event.preventDefault();
                  focusPlainTextArea(markdownEditorRef.current);
                }}
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
                ref={markdownEditorRef}
                spellCheck={false}
                value={plainText}
              />
            </>
          ) : null}
          {displayMode === "code" ? (
            <div className="relative h-full min-h-[176px] overflow-hidden bg-white">
              <div
                aria-hidden
                className="zenme-code-highlight absolute inset-0 overflow-auto px-4 py-3 pr-24 font-mono text-[13px] leading-6"
                ref={codeHighlightRef}
              >
                {renderHighlightedCode(plainText, codeLanguage)}
              </div>
              <textarea
                aria-label="代码内容"
                className={`zenme-code-editor nodrag nowheel absolute inset-0 resize-none overflow-auto bg-transparent px-4 py-3 pr-24 font-mono text-[13px] leading-6 caret-zinc-950 outline-none placeholder:text-zinc-400 ${
                  isEditing
                    ? "text-transparent"
                    : "cursor-text text-transparent selection:bg-transparent"
                }`}
                onBlur={() => {
                  if (isSwitchingMode.current) {
                    return;
                  }
                  setIsEditing(false);
                  syncPlainTextContent();
                }}
                onChange={(event) => {
                  const nextText = event.target.value;
                  rememberText(nextText);
                  schedulePlainTextSync(nextText);
                }}
                onFocus={() => setIsEditing(true)}
                onMouseDown={(event) => {
                  if (isEditing) {
                    return;
                  }

                  event.preventDefault();
                  focusPlainTextArea(codeEditorRef.current);
                }}
                onScroll={(event) => {
                  if (!codeHighlightRef.current) {
                    return;
                  }

                  codeHighlightRef.current.scrollLeft =
                    event.currentTarget.scrollLeft;
                  codeHighlightRef.current.scrollTop =
                    event.currentTarget.scrollTop;
                }}
                placeholder="在这里输入代码..."
                ref={codeEditorRef}
                spellCheck={false}
                value={plainText}
              />
            </div>
          ) : null}
        </div>
        {selected && !suppressFloatingControls ? (
          <TextNodeComposer nodeData={nodeData} nodeId={id} />
        ) : null}
        <NodeResizer
          color="#a1a1aa"
          handleClassName="zenme-text-resize-handle"
          isVisible={Boolean(selected || isEditing)}
          lineClassName="zenme-text-resize-line"
          minHeight={176}
          minWidth={320}
        />
        <NodeActionHandle selected={Boolean(selected)} />
      </div>
    );
  }

  if (nodeData.aiPrompt || nodeData.aiResponse || nodeData.aiStatus) {
    const isGenerating = nodeData.aiStatus === "generating";
    const isResponseExpanded = Boolean(nodeData.aiResponseExpanded);
    const createdAt = nodeData.aiCreatedAt
      ? new Date(nodeData.aiCreatedAt)
      : null;
    const createdAtLabel =
      createdAt && !Number.isNaN(createdAt.getTime())
        ? createdAt.toLocaleString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            month: "2-digit",
            day: "2-digit",
          })
        : null;

    return (
      <div className="zenme-agent-response-node group relative h-full w-full">
        <ImageTaskTiming
          className="pointer-events-none absolute -top-8 right-1 z-10 text-[11px] font-medium tabular-nums text-zinc-500"
          durationMs={nodeData.aiTaskDurationMs}
          running={isGenerating}
          startedAt={nodeData.aiTaskStartedAt}
        />
        <NodeTargetHandle
          revealOnHover={false}
          visible={Boolean(nodeData.hasIncomingEdge)}
        />
        <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
        <NodeContextTargetHandle />
        <div className="zenme-node-title-bar absolute -top-8 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
          <span className="zenme-node-title-icon-hitbox">
            <Bot className="size-4" />
          </span>
          AI 回复
        </div>
        <div
          className={`zenme-shadow-node flex h-full min-h-[220px] w-full flex-col overflow-hidden rounded-xl border bg-white text-zinc-950 ${
            selected ? "border-zinc-900" : "border-zinc-200"
          }`}
        >
          <div
            className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 text-xs text-zinc-500"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="size-3.5 shrink-0" />
              <span className="truncate">{nodeData.aiModel ?? "AI"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {createdAtLabel ? (
                <span className="mr-1 tabular-nums">{createdAtLabel}</span>
              ) : null}
              <button
                aria-expanded={isResponseExpanded}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:bg-zinc-100 focus-visible:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={isGenerating || (!nodeData.aiResponse && !nodeData.plainText)}
                onClick={() => {
                  nodeData.onToggleAiResponseExpanded?.(
                    id,
                    !isResponseExpanded,
                  );
                }}
                title={isResponseExpanded ? "收起回复" : "展开全部回复"}
                type="button"
              >
                {isResponseExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>
              <button
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:bg-zinc-100 focus-visible:text-zinc-900"
                disabled={!nodeData.aiResponse && !nodeData.plainText}
                onClick={() =>
                  copyText(nodeData.aiResponse || nodeData.plainText)
                }
                title="复制回复"
                type="button"
              >
                <Copy className="size-4" />
              </button>
            </div>
          </div>
          <div
            className="nodrag nowheel min-h-0 flex-1 overflow-auto px-5 py-4"
          >
            <div className="zenme-agent-response-text min-h-full rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-800">
              {isGenerating ? (
                <div className="flex min-h-[160px] items-center justify-center gap-2 text-zinc-500">
                  <Loader2 className="size-4 animate-spin" />
                  AI 正在生成回复...
                </div>
              ) : nodeData.aiStatus === "failed" ? (
                <div className="rounded-md bg-red-50 px-3 py-2 text-red-600">
                  {nodeData.aiError || "文本生成失败，请稍后重试"}
                </div>
              ) : (
                renderMarkdown(
                  nodeData.aiResponse || nodeData.plainText || "暂无回复",
                )
              )}
            </div>
          </div>
        </div>
        {selected && !suppressFloatingControls ? (
          <TextNodeComposer nodeData={nodeData} nodeId={id} />
        ) : null}
        <NodeResizer
          color="#a1a1aa"
          handleClassName="zenme-text-resize-handle"
          isVisible={Boolean(selected)}
          lineClassName="zenme-text-resize-line"
          minHeight={180}
          minWidth={360}
        />
        <NodeActionHandle selected={Boolean(selected)} />
      </div>
    );
  }

  return (
    <NodeFrame className="w-72 p-4" selected={Boolean(selected)}>
      <NodeTargetHandle
        revealOnHover={false}
        visible={Boolean(nodeData.hasIncomingEdge)}
      />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <div className="zenme-node-title-bar mb-3 flex items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <Icon className="size-4" />
        </span>
        Agent 占位
      </div>
      <p className="text-sm font-medium text-zinc-950">{nodeData.title}</p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">
        后续可承载 Agent 输出、总结或任务结果。
      </p>
      {selected && !suppressFloatingControls ? (
        <TextNodeComposer nodeData={nodeData} nodeId={id} />
      ) : null}
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function getTextDisplayMode(nodeData: CanvasNodeData): TextDisplayMode {
  if (nodeData.textMode) {
    return nodeData.textMode;
  }

  if (nodeData.kind === "markdown") {
    return "markdown";
  }

  if (nodeData.kind === "code") {
    return "code";
  }

  return "plain";
}

function getTextareaSelectionText(
  editor: HTMLTextAreaElement | null,
  value: string,
) {
  if (!editor) {
    return "";
  }

  return value.slice(editor.selectionStart, editor.selectionEnd).trim();
}
