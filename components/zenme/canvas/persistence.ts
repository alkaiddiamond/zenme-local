import type React from "react";
import type { Edge } from "@xyflow/react";
import { toCanvas } from "html-to-image";

import {
  refreshFileSignedUrlsFromApi,
  saveCanvasSnapshotToApi,
} from "@/lib/zenme-api";

import {
  inspectCanvasPerf,
  measureCanvasPerf,
  measureCanvasPerfAsync,
} from "./performance";
import type { CanvasNode, CanvasSnapshot, Viewport } from "./types";

// 云端模式下重签已上传图片节点的签名 URL，避免签名过期导致图片 403。
export async function refreshImageNodeUrls(
  currentNodes: CanvasNode[],
  setNodes: React.Dispatch<React.SetStateAction<CanvasNode[]>>,
  isRefreshing: React.MutableRefObject<boolean>,
) {
  const targets = currentNodes.filter(
    (node) => node.data.kind === "image" && node.data.fileId,
  );

  if (targets.length === 0) {
    return;
  }

  isRefreshing.current = true;

  try {
    const refreshed: Record<
      string,
      { originalUrl: string; previewUrl?: string }
    > = {};

    await Promise.all(
      targets.map(async (node) => {
        try {
          const urls = await refreshFileSignedUrlsFromApi(node.data.fileId as string);
          if (urls) {
            refreshed[node.id] = urls;
          }
        } catch {
          // 单个文件重签失败不影响其他节点。
        }
      }),
    );

    if (Object.keys(refreshed).length === 0) {
      return;
    }

    setNodes((previous) =>
      previous.map((node) => {
        const refreshedUrls = refreshed[node.id];
        if (!refreshedUrls) {
          return node;
        }
        return {
          ...node,
          data: {
            ...node.data,
            previewUrl: refreshedUrls.previewUrl ?? node.data.previewUrl,
            originalUrl: refreshedUrls.originalUrl ?? node.data.originalUrl,
          },
        };
      }),
    );
  } finally {
    isRefreshing.current = false;
  }
}

export async function createCanvasThumbnail(element: HTMLElement | null) {
  if (!element) {
    return null;
  }

  try {
    const captureBounds = element.getBoundingClientRect();
    return await measureCanvasPerfAsync("thumbnail toBlob", async () => {
      const canvas = await toCanvas(element, {
        cacheBust: true,
        filter: (node) => {
          if (!(node instanceof Element)) {
            return true;
          }

          if (node === element) {
            return true;
          }

          if (
            node.classList.contains("react-flow__node") ||
            node.classList.contains("react-flow__edge")
          ) {
            return intersectsCanvasThumbnailBounds(
              node.getBoundingClientRect(),
              captureBounds,
            );
          }

          return !node.closest(
            [
              "[data-thumbnail-hidden='true']",
              ".react-flow__attribution",
              ".react-flow__background",
              ".react-flow__controls",
              ".react-flow__minimap",
              ".react-flow__panel",
            ].join(","),
          );
        },
        pixelRatio: 0.5,
        backgroundColor: "#ffffff",
        // 项目缩略图不需要内嵌字体文件；扫描和编码字体会显著放大大画布截图成本。
        skipFonts: true,
      });

      return canvasToWebpBlob(canvas);
    });
  } catch {
    return null;
  }
}

export function intersectsCanvasThumbnailBounds(
  rect: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  bounds: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  overscan = 80,
) {
  return (
    rect.right >= bounds.left - overscan &&
    rect.left <= bounds.right + overscan &&
    rect.bottom >= bounds.top - overscan &&
    rect.top <= bounds.bottom + overscan
  );
}

export function canvasToWebpBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob?.type === "image/webp" ? blob : null),
      "image/webp",
      0.82,
    );
  });
}

export async function saveCanvasSnapshot(input: {
  edges: Edge[];
  nodes: CanvasNode[];
  projectId: string;
  thumbnail: Blob | null;
  viewport: Viewport;
}) {
  const snapshot = measureCanvasPerf(
    "save snapshot build",
    () =>
      ({
        version: 3,
        nodes: getPersistableCanvasNodes(input.nodes),
        edges: input.edges,
        viewport: input.viewport,
        updatedAt: new Date().toISOString(),
      }) satisfies CanvasSnapshot,
    {
      edges: input.edges.length,
      nodes: input.nodes.length,
    },
  );
  inspectCanvasPerf(
    () =>
      measureCanvasPerf(
        "save snapshot size",
        () => JSON.stringify(snapshot).length,
        {
          edges: snapshot.edges.length,
          nodes: snapshot.nodes.length,
        },
      ),
    0,
  );

  await measureCanvasPerfAsync("local snapshot save", () =>
    saveCanvasSnapshotToApi({
      projectId: input.projectId,
      snapshot,
      thumbnail: input.thumbnail,
    }),
  );

  return snapshot;
}

export function getPersistableCanvasNodes(nodes: CanvasNode[]) {
  return nodes.map((node) => {
    const persistedNode = { ...node } as CanvasNode & {
      dragging?: boolean;
      measured?: unknown;
      resizing?: boolean;
      selected?: boolean;
    };
    delete persistedNode.dragging;
    delete persistedNode.measured;
    delete persistedNode.resizing;
    delete persistedNode.selected;

    const persistedData = Object.fromEntries(
      Object.entries(node.data).filter(
        ([key, value]) =>
          key !== "hasIncomingEdge" &&
          key !== "hasOutgoingEdge" &&
          key !== "isMultiSelection" &&
          key !== "canvasContentActive" &&
          key !== "taskParentName" &&
          key !== "taskParentOptions" &&
          key !== "musicCurrentTime" &&
          key !== "musicIsPlaying" &&
          key !== "musicLyricsOverlayOpen" &&
          key !== "musicSources" &&
          typeof value !== "function",
      ),
    ) as CanvasNode["data"];

    return {
      ...persistedNode,
      data: persistedData,
    } satisfies CanvasNode;
  });
}
