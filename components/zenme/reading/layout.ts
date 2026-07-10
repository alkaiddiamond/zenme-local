import type { ReadingFormat } from "@/lib/reading/types";

import { TOC_COLLAPSED_WIDTH } from "./constants";
import { clampContentScale } from "./utils";

export function getNormalizedContentScale(nextScale: number) {
  return Math.round(clampContentScale(nextScale) * 10) / 10;
}

export function supportsReadingContentScale(format: ReadingFormat | undefined) {
  return format === "pdf" || format === "epub";
}

export function getReadingGridColumns(input: {
  notesWidth: number;
  nodeMode: boolean;
  tocCollapsed: boolean;
  tocWidth: number;
}) {
  const tocColumn = input.tocCollapsed
    ? `${TOC_COLLAPSED_WIDTH}px`
    : `${input.tocWidth}px`;
  const notesColumn = `${input.notesWidth}px`;

  return `${tocColumn} minmax(0,1fr) ${notesColumn}`;
}

export function getQuickNotePanelCopy(input: {
  assetFormat: ReadingFormat | undefined;
  hasPdfAnnotationDraft: boolean;
  quickNoteText: string;
}) {
  return {
    actionLabel: input.hasPdfAnnotationDraft
      ? "保存标注"
      : input.quickNoteText
        ? "保存选区笔记"
        : "保存页面备注",
    hint: input.quickNoteText
      ? input.quickNoteText
      : input.assetFormat === "pdf"
        ? "文本型 PDF 请直接选择文字；图片型 PDF 请拖拽区域。也可以在这里记录当前页备注。"
        : "在正文中选择文字，或直接输入当前章节备注。",
  };
}
