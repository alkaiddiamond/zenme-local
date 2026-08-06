"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
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
import { getModelIdFromReference } from "@/lib/ai/model-reference";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { InlineFormatToolbar } from "@/components/zenme/nodes/inline-format-toolbar";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { OverlayScrollbars } from "@/components/zenme/nodes/overlay-scrollbar";
import { renderHighlightedCode } from "@/components/zenme/nodes/renderers/code-highlight";
import { renderMarkdown } from "@/components/zenme/nodes/renderers/markdown";
import {
  escapeHtml,
  normalizeRichTextHtml,
  plainTextToRichTextHtml,
  plainTextToRichTextFragment,
  stripLegacyRichTextHtml,
} from "@/components/zenme/nodes/renderers/rich-text";
import { TextNodeComposer } from "@/components/zenme/nodes/text-node-composer";
import { ImageTaskTiming } from "@/components/zenme/nodes/image-task-timing";
import { getWordSelectionOffsets } from "@/components/zenme/nodes/text-selection";
import {
  getTextLines,
  getVisibleTextOffsets,
  normalizeVisualLineRects,
} from "@/components/zenme/nodes/text-line-numbers";
import {
  insertTabSpaces,
  TEXT_EDITOR_TAB_SPACES,
} from "@/components/zenme/nodes/text-editor-keyboard";
import { writeTextToClipboard } from "@/lib/clipboard";

type TextDisplayMode = "code" | "markdown" | "plain";

function syncScrollPositionByRatio(
  source: HTMLElement,
  target: HTMLElement,
) {
  const sourceMaxScrollLeft = source.scrollWidth - source.clientWidth;
  const sourceMaxScrollTop = source.scrollHeight - source.clientHeight;
  const targetMaxScrollLeft = target.scrollWidth - target.clientWidth;
  const targetMaxScrollTop = target.scrollHeight - target.clientHeight;

  target.scrollLeft = sourceMaxScrollLeft > 0
    ? (source.scrollLeft / sourceMaxScrollLeft) * targetMaxScrollLeft
    : 0;
  target.scrollTop = sourceMaxScrollTop > 0
    ? (source.scrollTop / sourceMaxScrollTop) * targetMaxScrollTop
    : 0;
}

export function TextNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const isAgent = nodeData.kind === "agent";
  const isTextNode = nodeData.kind === "text";
  const isTextExpanded = Boolean(nodeData.textExpanded);
  const lineNumbersVisible = Boolean(nodeData.textLineNumbers);
  const suppressFloatingControls = Boolean(nodeData.isMultiSelection);
  const displayMode = getTextDisplayMode(nodeData);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const markdownEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const markdownPreviewRef = useRef<HTMLDivElement | null>(null);
  const markdownVisualLineNumbersRef = useRef<HTMLDivElement | null>(null);
  const markdownVisualLineMeasureFrame = useRef<number | null>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const codeHighlightRef = useRef<HTMLDivElement | null>(null);
  const lineNumbersRef = useRef<HTMLDivElement | null>(null);
  const agentResponseRef = useRef<HTMLDivElement | null>(null);
  const editorSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const plainTextDirtyRef = useRef(false);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textScrollStateRef = useRef(nodeData.textScrollState ?? {});
  const updateTextNodeRef = useRef(nodeData.onUpdateTextNode);
  const isSwitchingMode = useRef(false);
  const initialRichTextHtml = useMemo(
    () =>
      normalizeRichTextHtml(
        nodeData.richTextHtml || plainTextToRichTextHtml(nodeData.plainText),
      ),
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
  const markdownPreviewContent = useMemo(
    () =>
      plainText.trim() ? (
        renderMarkdown(plainText)
      ) : (
        <p className="text-base leading-7 text-zinc-400">
          使用上方编辑按钮输入 Markdown
        </p>
      ),
    [plainText],
  );
  const highlightedCode = useMemo(
    () => renderHighlightedCode(plainText, codeLanguage, lineNumbersVisible),
    [codeLanguage, lineNumbersVisible, plainText],
  );
  const Icon = isAgent ? Bot : StickyNote;
  updateTextNodeRef.current = nodeData.onUpdateTextNode;

  function copyText(value?: string) {
    const text = value?.trim();
    if (!text) {
      return;
    }

    void writeTextToClipboard(text);
  }

  function selectAgentResponseWord(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.detail !== 2) {
      return;
    }

    const responseElement = event.currentTarget;
    const range = responseElement.ownerDocument.caretRangeFromPoint?.(
      event.clientX,
      event.clientY,
    );
    if (
      !range ||
      range.startContainer.nodeType !== Node.TEXT_NODE ||
      !responseElement.contains(range.startContainer)
    ) {
      return;
    }

    const text = range.startContainer.textContent ?? "";
    const offsets = getWordSelectionOffsets(text, range.startOffset);
    event.preventDefault();
    event.stopPropagation();
    if (offsets.start === offsets.end) {
      return;
    }

    range.setStart(range.startContainer, offsets.start);
    range.setEnd(range.startContainer, offsets.end);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
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

    if (!isEditing) {
      plainTextDirtyRef.current = false;
      latestTextRef.current = initialPlainText;
      setPlainText(initialPlainText);
      if (
        markdownEditorRef.current &&
        markdownEditorRef.current.value !== initialPlainText
      ) {
        markdownEditorRef.current.value = initialPlainText;
      }
      if (
        codeEditorRef.current &&
        codeEditorRef.current.value !== initialPlainText
      ) {
        codeEditorRef.current.value = initialPlainText;
      }
    }
  }, [displayMode, initialPlainText, isEditing]);

  useEffect(() => {
    setCodeLanguage(nodeData.codeLanguage ?? "python");
  }, [nodeData.codeLanguage]);

  useEffect(() => {
    if (!lineNumbersVisible || !lineNumbersRef.current) return;
    replaceLineNumberRows(lineNumbersRef.current, plainText, displayMode);
  }, [displayMode, isEditing, lineNumbersVisible, plainText]);

  useEffect(() => {
    if (!lineNumbersVisible || displayMode !== "plain" || !editorRef.current) {
      return;
    }

    const editor = editorRef.current;
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((mutation) => mutation.type === "childList")) return;
      if (lineNumbersRef.current) {
        replaceLineNumberRows(
          lineNumbersRef.current,
          editor.innerText,
          "plain",
        );
      }
    });
    observer.observe(editor, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [displayMode, lineNumbersVisible]);

  useEffect(() => {
    const preview = markdownPreviewRef.current;
    const rows = markdownVisualLineNumbersRef.current;
    if (
      !lineNumbersVisible ||
      displayMode !== "markdown" ||
      isEditing ||
      !preview ||
      !rows
    ) {
      return;
    }

    const update = () => {
      markdownVisualLineMeasureFrame.current = null;
      replaceMarkdownBlockNumbers(
        rows,
        measureRenderedMarkdownReadingNumbers(preview),
      );
    };
    const scheduleUpdate = () => {
      if (markdownVisualLineMeasureFrame.current !== null) return;
      markdownVisualLineMeasureFrame.current = window.requestAnimationFrame(update);
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(preview);
    scheduleUpdate();
    return () => {
      resizeObserver.disconnect();
      if (markdownVisualLineMeasureFrame.current !== null) {
        window.cancelAnimationFrame(markdownVisualLineMeasureFrame.current);
        markdownVisualLineMeasureFrame.current = null;
      }
    };
  }, [displayMode, isEditing, lineNumbersVisible, plainText]);

  useEffect(() => {
    textScrollStateRef.current = nodeData.textScrollState ?? {};
  }, [nodeData.textScrollState]);

  const savedScrollLeft = nodeData.textScrollState?.[displayMode]?.left;
  const savedScrollTop = nodeData.textScrollState?.[displayMode]?.top;
  useEffect(() => {
    if (isAgent || savedScrollLeft === undefined || savedScrollTop === undefined) return;
    const frame = window.requestAnimationFrame(() => {
      const targets = displayMode === "plain"
        ? [editorRef.current]
        : displayMode === "markdown"
          ? [markdownPreviewRef.current]
          : [codeEditorRef.current, codeHighlightRef.current];
      for (const target of targets) {
        if (!target) continue;
        target.scrollLeft = savedScrollLeft;
        target.scrollTop = savedScrollTop;
      }
      if (lineNumbersRef.current) {
        lineNumbersRef.current.style.transform = `translate3d(0, ${-savedScrollTop}px, 0)`;
      }
      if (markdownVisualLineNumbersRef.current) {
        markdownVisualLineNumbersRef.current.style.transform = `translate3d(0, ${-savedScrollTop}px, 0)`;
      }
      if (
        displayMode === "markdown" &&
        markdownPreviewRef.current &&
        markdownEditorRef.current
      ) {
        syncScrollPositionByRatio(
          markdownPreviewRef.current,
          markdownEditorRef.current,
        );
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    displayMode,
    isAgent,
    savedScrollLeft,
    savedScrollTop,
  ]);

  useEffect(() => {
    return () => {
      if (editorSyncTimer.current) {
        clearTimeout(editorSyncTimer.current);
        editorSyncTimer.current = null;
      }
      if (scrollSaveTimer.current) {
        clearTimeout(scrollSaveTimer.current);
        scrollSaveTimer.current = null;
      }
    };
  }, []);

  function rememberTextScroll(
    mode: TextDisplayMode,
    target: { scrollLeft: number; scrollTop: number },
  ) {
    if (isAgent) return;
    const currentPosition = textScrollStateRef.current[mode];
    if (
      currentPosition?.left === target.scrollLeft &&
      currentPosition.top === target.scrollTop
    ) return;
    const nextState = {
      ...textScrollStateRef.current,
      [mode]: {
        left: Math.max(0, target.scrollLeft),
        top: Math.max(0, target.scrollTop),
      },
    };
    textScrollStateRef.current = nextState;
    if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    scrollSaveTimer.current = setTimeout(() => {
      scrollSaveTimer.current = null;
      updateTextNodeRef.current?.(id, { textScrollState: nextState });
    }, 200);
  }

  function readEditorContent() {
    const editor = editorRef.current;

    return {
      plainText: editor?.innerText ?? "",
      richTextHtml: normalizeRichTextHtml(editor?.innerHTML),
    };
  }

  function rememberText(nextText: string) {
    latestTextRef.current = nextText;
    setPlainText(nextText);
  }

  function rememberTextInput(nextText: string) {
    latestTextRef.current = nextText;
    if (lineNumbersVisible && lineNumbersRef.current) {
      replaceLineNumberRows(lineNumbersRef.current, nextText, displayMode);
    }
  }

  function syncLineNumberScroll(scrollTop: number) {
    if (!lineNumbersVisible || !lineNumbersRef.current) return;
    lineNumbersRef.current.style.transform = `translate3d(0, ${-scrollTop}px, 0)`;
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
    if (!plainTextDirtyRef.current) {
      return;
    }

    if (isAgent) {
      return;
    }

    const nextContent = readEditorContent();
    plainTextDirtyRef.current = false;
    latestTextRef.current = nextContent.plainText;
    if (
      nextContent.plainText === (nodeData.plainText ?? "") &&
      nextContent.richTextHtml === (nodeData.richTextHtml ?? "")
    ) {
      return;
    }

    nodeData.onUpdateTextNode?.(id, nextContent);
  }

  function syncPlainTextContent(nextText = latestTextRef.current) {
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
    plainTextDirtyRef.current = false;
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

  function handlePlainTextInput(event?: FormEvent<HTMLDivElement>) {
    plainTextDirtyRef.current = true;
    const editor = event?.currentTarget ?? editorRef.current;
    if (lineNumbersVisible && lineNumbersRef.current && editor) {
      replaceLineNumberRows(
        lineNumbersRef.current,
        editor.innerText,
        "plain",
      );
    }
  }

  function applyTextCommand(command: "bold" | "italic" | "underline") {
    if (!editorRef.current) {
      return;
    }

    editorRef.current.focus();
    document.execCommand(command);
    plainTextDirtyRef.current = true;
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
    plainTextDirtyRef.current = true;
    syncEditorContent();
  }

  function createNodeFromSelection() {
    const selectedText =
      displayMode === "plain"
        ? window.getSelection()?.toString().trim()
        : displayMode === "markdown" && !isEditing
          ? getSelectionInside(markdownPreviewRef.current)
        : getTextareaSelectionText(
            displayMode === "code"
              ? codeEditorRef.current
              : markdownEditorRef.current,
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
    const currentText = editor.value;
    const selectedText = currentText.slice(start, end) || fallback;
    const inserted = `${prefix}${selectedText}${suffix}`;
    const nextMarkdown =
      currentText.slice(0, start) + inserted + currentText.slice(end);

    editor.value = nextMarkdown;
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
    event.stopPropagation();
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertHTML", false, plainTextToRichTextFragment(text));
    handlePlainTextInput();
  }

  function handleRichTextKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    document.execCommand("insertText", false, TEXT_EDITOR_TAB_SPACES);
    handlePlainTextInput();
  }

  function handleTextareaKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    const editor = event.currentTarget;
    const update = insertTabSpaces(
      editor.value,
      editor.selectionStart,
      editor.selectionEnd,
    );
    editor.value = update.value;
    rememberTextInput(update.value);
    schedulePlainTextSync(update.value);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(update.cursor, update.cursor);
    });
  }

  function focusPlainTextArea(editor: HTMLTextAreaElement | null) {
    if (!isEditing) {
      setIsEditing(true);
      window.getSelection()?.removeAllRanges();
      window.requestAnimationFrame(() => editor?.focus());
    }
  }

  function toggleMarkdownEditing(nextEditing: boolean) {
    const source = nextEditing
      ? markdownPreviewRef.current
      : markdownEditorRef.current;
    const target = nextEditing
      ? markdownEditorRef.current
      : markdownPreviewRef.current;

    if (source && target) {
      syncScrollPositionByRatio(source, target);
    }
    if (!nextEditing && markdownEditorRef.current) {
      markdownEditorRef.current.blur();
      return;
    }
    setIsEditing(nextEditing);
    window.getSelection()?.removeAllRanges();
    window.requestAnimationFrame(() => {
      if (nextEditing) {
        markdownEditorRef.current?.focus();
      } else if (markdownPreviewRef.current) {
        rememberTextScroll("markdown", markdownPreviewRef.current);
      }
    });
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
            lineNumbersVisible={lineNumbersVisible}
            markdownEditing={isEditing}
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
            onToggleLineNumbers={() =>
              nodeData.onUpdateTextNode?.(id, {
                textLineNumbers: !lineNumbersVisible,
              })
            }
            onToggleMarkdownEditing={toggleMarkdownEditing}
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
          {displayMode === "plain" ? (
            <>
              {lineNumbersVisible ? (
                <TextLineNumberOverlay
                  content={plainText}
                  mode="plain"
                  rowsRef={lineNumbersRef}
                />
              ) : null}
              <div
                autoCapitalize="off"
                autoCorrect="off"
                className={`zenme-overlay-scroll-container zenme-text-node-editor nodrag nowheel h-full min-h-[176px] overflow-auto rounded-xl py-5 text-base leading-7 text-zinc-800 outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)] ${
                  lineNumbersVisible
                    ? "whitespace-pre-wrap break-words pl-14 pr-6"
                    : "px-6"
                }`}
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
                onKeyDown={handleRichTextKeyDown}
                onPaste={handlePaste}
                onScroll={(event) => {
                  rememberTextScroll("plain", event.currentTarget);
                  syncLineNumberScroll(event.currentTarget.scrollTop);
                }}
                ref={editorRef}
                spellCheck={false}
                tabIndex={0}
                suppressContentEditableWarning
              />
              <OverlayScrollbars
                contentKey={initialRichTextHtml}
                scrollRef={editorRef}
              />
            </>
          ) : null}
          {displayMode === "markdown" ? (
            <>
              <div
                className={`zenme-overlay-scroll-container zenme-markdown-preview zenme-markdown-preview-interactive nodrag nowheel absolute inset-0 select-text overflow-auto pb-10 pt-5 text-base leading-7 ${
                  lineNumbersVisible ? "pl-14 pr-6" : "px-6"
                } ${
                  isEditing ? "pointer-events-none invisible" : ""
                }`}
                onScroll={(event) => {
                  if (isEditing) return;
                  rememberTextScroll("markdown", event.currentTarget);
                  if (markdownVisualLineNumbersRef.current) {
                    markdownVisualLineNumbersRef.current.style.transform =
                      `translate3d(0, ${-event.currentTarget.scrollTop}px, 0)`;
                  }
                  if (markdownEditorRef.current) {
                    syncScrollPositionByRatio(
                      event.currentTarget,
                      markdownEditorRef.current,
                    );
                  }
                }}
                ref={markdownPreviewRef}
              >
                {markdownPreviewContent}
              </div>
              {lineNumbersVisible && !isEditing ? (
                <MarkdownBlockNumberOverlay
                  rowsRef={markdownVisualLineNumbersRef}
                />
              ) : null}
              {lineNumbersVisible && isEditing ? (
                <TextLineNumberOverlay
                  content={plainText}
                  mode="markdown"
                  rowsRef={lineNumbersRef}
                />
              ) : null}
              <textarea
                aria-label="Markdown 文本"
                className={`zenme-overlay-scroll-container zenme-markdown-editor nodrag nowheel absolute inset-0 resize-none overflow-auto bg-transparent pb-10 pt-5 text-base leading-7 caret-zinc-950 outline-none ${
                  lineNumbersVisible ? "pl-14 pr-6" : "px-6"
                } ${
                  isEditing
                    ? "text-zinc-800"
                    : "pointer-events-none invisible"
                }`}
                onBlur={() => {
                  if (isSwitchingMode.current) {
                    return;
                  }
                  const nextText = markdownEditorRef.current?.value ?? latestTextRef.current;
                  setIsEditing(false);
                  rememberText(nextText);
                  syncPlainTextContent(nextText);
                  markdownEditorRef.current?.setSelectionRange(
                    markdownEditorRef.current.selectionEnd,
                    markdownEditorRef.current.selectionEnd,
                  );
                }}
                onChange={(event) => {
                  const nextText = event.target.value;
                  rememberTextInput(nextText);
                  schedulePlainTextSync(nextText);
                }}
                onFocus={() => setIsEditing(true)}
                onKeyDown={handleTextareaKeyDown}
                onScroll={(event) => {
                  if (!isEditing) return;
                  if (!markdownPreviewRef.current) {
                    return;
                  }

                  const editor = event.currentTarget;
                  const preview = markdownPreviewRef.current;
                  syncLineNumberScroll(editor.scrollTop);
                  syncScrollPositionByRatio(editor, preview);
                  rememberTextScroll("markdown", preview);
                }}
                ref={markdownEditorRef}
                spellCheck={false}
                defaultValue={plainText}
                wrap="soft"
              />
              <OverlayScrollbars
                contentKey={`${isEditing ? "edit" : "preview"}:${plainText}`}
                scrollRef={isEditing ? markdownEditorRef : markdownPreviewRef}
              />
            </>
          ) : null}
          {displayMode === "code" ? (
            <div className="relative h-full min-h-[176px] overflow-hidden bg-white">
              {lineNumbersVisible ? (
                <TextLineNumberOverlay
                  content={plainText}
                  mode="code"
                  rowsRef={lineNumbersRef}
                />
              ) : null}
              <div
                aria-hidden
                className={`zenme-overlay-scroll-container zenme-code-highlight absolute inset-0 overflow-auto py-3 font-mono text-[13px] leading-6 ${
                  lineNumbersVisible ? "pl-14 pr-4" : "px-4"
                } ${
                  isEditing ? "invisible" : ""
                }`}
                ref={codeHighlightRef}
              >
                {highlightedCode}
              </div>
              <textarea
                aria-label="代码内容"
                className={`zenme-overlay-scroll-container zenme-code-editor nodrag nowheel absolute inset-0 resize-none overflow-auto bg-transparent py-3 font-mono text-[13px] leading-6 caret-zinc-950 outline-none placeholder:text-zinc-400 ${
                  lineNumbersVisible ? "pl-14 pr-4" : "px-4"
                } ${
                  isEditing
                    ? "text-zinc-800"
                    : "cursor-text text-transparent selection:bg-transparent"
                }`}
                onBlur={() => {
                  if (isSwitchingMode.current) {
                    return;
                  }
                  const nextText = codeEditorRef.current?.value ?? latestTextRef.current;
                  setIsEditing(false);
                  rememberText(nextText);
                  syncPlainTextContent(nextText);
                }}
                onChange={(event) => {
                  const nextText = event.target.value;
                  rememberTextInput(nextText);
                  schedulePlainTextSync(nextText);
                }}
                onFocus={() => setIsEditing(true)}
                onKeyDown={handleTextareaKeyDown}
                onMouseDown={(event) => {
                  if (isEditing) {
                    return;
                  }

                  event.preventDefault();
                  focusPlainTextArea(codeEditorRef.current);
                }}
                onScroll={(event) => {
                  rememberTextScroll("code", event.currentTarget);
                  syncLineNumberScroll(event.currentTarget.scrollTop);
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
                defaultValue={plainText}
                wrap="soft"
              />
              <OverlayScrollbars
                contentKey={plainText}
                scrollRef={codeEditorRef}
              />
            </div>
          ) : null}
        </div>
        {isTextNode ? (
          <div className="zenme-text-node-floating-actions nodrag absolute right-3 top-3 z-30 flex items-center gap-1">
            <button
              aria-expanded={isTextExpanded}
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/80 text-zinc-400 opacity-55 backdrop-blur transition hover:bg-zinc-100 hover:text-zinc-900 hover:opacity-100 focus-visible:bg-zinc-100 focus-visible:text-zinc-900 focus-visible:opacity-100"
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
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/80 text-zinc-400 opacity-55 backdrop-blur transition hover:bg-zinc-100 hover:text-zinc-900 hover:opacity-100 focus-visible:bg-zinc-100 focus-visible:text-zinc-900 focus-visible:opacity-100"
              onClick={() => copyText(readCurrentTextContent())}
              title="复制文本"
              type="button"
            >
              <Copy className="size-4" />
            </button>
          </div>
        ) : null}
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
            className="zenme-node-drag-surface flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3 text-xs text-zinc-500"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="size-3.5 shrink-0" />
              <span className="truncate">
                {getModelIdFromReference(nodeData.aiModel) || "AI"}
              </span>
            </div>
            <div className="nodrag flex shrink-0 items-center gap-1">
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
          <div className="relative min-h-0 flex-1">
            <div
              className="zenme-overlay-scroll-container nodrag nowheel absolute inset-0 overflow-auto px-5 py-4"
              ref={agentResponseRef}
            >
              <div
                className="zenme-agent-response-text min-h-full rounded-lg bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-800"
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseDown={selectAgentResponseWord}
              >
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
            <OverlayScrollbars
              contentKey={nodeData.aiResponse || nodeData.plainText}
              scrollRef={agentResponseRef}
            />
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

function MarkdownBlockNumberOverlay({
  rowsRef,
}: {
  rowsRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      <div className="absolute inset-y-0 left-0 w-12 border-r border-zinc-100 bg-white/95" />
      <div className="absolute inset-0" ref={rowsRef} />
    </div>
  );
}

type MarkdownReadingNumber = { height: number; number: number; top: number };

function measureRenderedMarkdownReadingNumbers(
  preview: HTMLDivElement,
): MarkdownReadingNumber[] {
  const previewRect = preview.getBoundingClientRect();
  const lineRects = measureRenderedTextLineRects(preview, previewRect);
  return Array.from(
    preview.querySelectorAll<HTMLElement>("[data-markdown-block]"),
  )
    .map((block) => {
      const rect = block.getBoundingClientRect();
      const blockTop = rect.top - previewRect.top + preview.scrollTop;
      const blockBottom = rect.bottom - previewRect.top + preview.scrollTop;
      const lineIndex = lineRects.findIndex(
        (line) => line.top >= blockTop - 4 && line.top < blockBottom + 4,
      );
      const line = lineRects[lineIndex];
      return line
        ? {
            height: line.bottom - line.top,
            number: lineIndex + 1,
            top: line.top,
          }
        : null;
    })
    .filter((entry): entry is MarkdownReadingNumber => entry !== null);
}

function measureRenderedTextLineRects(
  preview: HTMLDivElement,
  previewRect: DOMRect,
) {
  const walker = preview.ownerDocument.createTreeWalker(
    preview,
    NodeFilter.SHOW_TEXT,
  );
  const rects: Array<{ bottom: number; top: number }> = [];
  const measuredMathElements = new Set<Element>();
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    const textOffsets = getVisibleTextOffsets(current.textContent ?? "");
    if (textOffsets && !parent?.closest('[aria-hidden="true"], script, style')) {
      const mathElement = parent?.closest(".katex");
      const range = preview.ownerDocument.createRange();
      if (mathElement && !measuredMathElements.has(mathElement)) {
        measuredMathElements.add(mathElement);
        range.selectNode(mathElement);
      } else if (mathElement) {
        current = walker.nextNode();
        continue;
      } else {
        range.setStart(current, textOffsets.start);
        range.setEnd(current, textOffsets.end);
      }
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) {
          rects.push({
            bottom: rect.bottom - previewRect.top + preview.scrollTop,
            top: rect.top - previewRect.top + preview.scrollTop,
          });
        }
      }
      range.detach();
    }
    current = walker.nextNode();
  }
  return normalizeVisualLineRects(rects);
}

function replaceMarkdownBlockNumbers(
  container: HTMLDivElement,
  entries: MarkdownReadingNumber[],
) {
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const number = document.createElement("span");
    number.className =
      "absolute left-0 flex w-12 items-center justify-end pr-2 font-mono text-[11px] leading-none text-zinc-400";
    number.style.height = `${entry.height}px`;
    number.style.top = `${entry.top}px`;
    number.textContent = String(entry.number);
    fragment.append(number);
  });
  container.replaceChildren(fragment);
}

function TextLineNumberOverlay({
  content,
  mode,
  rowsRef,
}: {
  content: string;
  mode: TextDisplayMode;
  rowsRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      <div className="absolute inset-y-0 left-0 w-12 border-r border-zinc-100 bg-white/95" />
      <div className={getLineNumberRowsClassName(mode)} ref={rowsRef}>
        {getTextLines(content).map((line, index) => (
          <LineNumberRow index={index} key={index} line={line} mode={mode} />
        ))}
      </div>
    </div>
  );
}

function LineNumberRow({
  index,
  line,
  mode,
}: {
  index: number;
  line: string;
  mode: TextDisplayMode;
}) {
  return (
    <div className={getLineNumberRowClassName(mode)}>
      <span className="absolute left-0 top-0 w-12 pr-2 text-right font-mono text-[11px] text-zinc-400">
        {index + 1}
      </span>
      <span className="invisible">{line || "\u00a0"}</span>
    </div>
  );
}

function getLineNumberRowsClassName(mode: TextDisplayMode) {
  return mode === "code"
    ? "py-3 font-mono text-[13px] leading-6"
    : "py-5 text-base leading-7";
}

function getLineNumberRowClassName(mode: TextDisplayMode) {
  return `relative whitespace-pre-wrap break-words ${
    mode === "code" ? "min-h-6 pl-14 pr-4" : "min-h-7 pl-14 pr-6"
  }`;
}

const lineNumberContentCache = new WeakMap<
  HTMLDivElement,
  { content: string; mode: TextDisplayMode }
>();

function replaceLineNumberRows(
  container: HTMLDivElement,
  content: string,
  mode: TextDisplayMode,
) {
  const cached = lineNumberContentCache.get(container);
  if (cached?.content === content && cached.mode === mode) return;

  const lines = getTextLines(content);
  const rowClassName = getLineNumberRowClassName(mode);
  while (container.children.length > lines.length) {
    container.lastElementChild?.remove();
  }

  lines.forEach((line, index) => {
    let row = container.children.item(index) as HTMLDivElement | null;
    if (!row) {
      row = document.createElement("div");
      const number = document.createElement("span");
      number.className =
        "absolute left-0 top-0 w-12 pr-2 text-right font-mono text-[11px] text-zinc-400";
      number.textContent = String(index + 1);
      const mirror = document.createElement("span");
      mirror.className = "invisible";
      row.append(number, mirror);
      container.append(row);
    }

    if (row.className !== rowClassName) row.className = rowClassName;
    const mirror = row.lastElementChild;
    const nextText = line || "\u00a0";
    if (mirror && mirror.textContent !== nextText) mirror.textContent = nextText;
  });

  lineNumberContentCache.set(container, { content, mode });
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
) {
  if (!editor) {
    return "";
  }

  return editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
}

function getSelectionInside(container: HTMLElement | null) {
  const selection = window.getSelection();
  if (
    !container ||
    !selection ||
    selection.rangeCount === 0 ||
    selection.isCollapsed ||
    !container.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    return "";
  }

  return selection.toString().trim();
}
