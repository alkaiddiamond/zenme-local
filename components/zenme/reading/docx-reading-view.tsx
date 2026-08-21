"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import type { ReadingSection } from "@/lib/reading/types";

import {
  DOCX_RENDER_OPTIONS,
  paginateRenderedDocx,
} from "./docx-rendering";
import type { PdfOutlineSection } from "./types";

type DocxReadingViewProps = {
  assetId: string;
  contentScale: number;
  onError: (message: string | null) => void;
  onOutline: (sections: PdfOutlineSection[]) => void;
  onPageCount: (count: number) => void;
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  sections: ReadingSection[];
};

export const DocxReadingView = memo(function DocxReadingView({
  assetId,
  contentScale,
  onError,
  onOutline,
  onPageCount,
  pageRefs,
  sections,
}: DocxReadingViewProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const styleRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const body = bodyRef.current;
    const styleContainer = styleRef.current;

    if (!body || !styleContainer) return;
    const renderBody = body;
    const renderStyles = styleContainer;
    renderBody.replaceChildren();
    renderStyles.replaceChildren();
    pageRefs.current = {};
    setIsLoading(true);
    setRenderError(null);
    onOutline([]);
    onPageCount(0);

    async function renderDocx() {
      try {
        const response = await fetch(`/api/reading/assets/${assetId}/file`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`DOCX 文件加载失败（${response.status}）`);
        }
        const file = await response.blob();
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        await renderAsync(file, renderBody, renderStyles, DOCX_RENDER_OPTIONS);
        if (cancelled) return;
        const result = await paginateRenderedDocx({
          container: renderBody,
          pageRefs,
          sections,
        });
        if (cancelled) return;
        if (result.pageCount === 0) {
          throw new Error("DOCX 中没有可渲染的页面");
        }
        onOutline(result.outline);
        onPageCount(result.pageCount);
        onError(null);
        setIsLoading(false);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        const message =
          error instanceof Error ? error.message : "DOCX 阅读器加载失败";
        setRenderError(message);
        setIsLoading(false);
        onError(message);
      }
    }

    void renderDocx();

    return () => {
      cancelled = true;
      controller.abort();
      renderBody.replaceChildren();
      renderStyles.replaceChildren();
      pageRefs.current = {};
    };
  }, [assetId, onError, onOutline, onPageCount, pageRefs, sections]);

  const scaleStyle = {
    "--zenme-docx-scale": String(contentScale),
  } as CSSProperties;

  return (
    <div className="zenme-docx-renderer relative mx-auto w-full" style={scaleStyle}>
      <div aria-hidden className="hidden" ref={styleRef} />
      {isLoading ? (
        <div className="flex min-h-[520px] items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          正在渲染 DOCX 原始版式并分页
        </div>
      ) : null}
      {renderError ? (
        <div className="flex min-h-[320px] items-center justify-center gap-2 text-sm text-red-600">
          <AlertCircle className="size-4" />
          {renderError}
        </div>
      ) : null}
      <div
        className={
          renderError
            ? "hidden"
            : `zenme-docx-scale ${
                isLoading
                  ? "pointer-events-none invisible absolute left-0 top-0 w-full"
                  : ""
              }`
        }
      >
        <div ref={bodyRef} />
      </div>
    </div>
  );
});
