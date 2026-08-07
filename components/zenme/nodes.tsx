"use client";

import { type ComponentType, memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { Plus } from "lucide-react";

import { BookNode } from "@/components/zenme/nodes/book-node";
import { FileNode } from "@/components/zenme/nodes/file-node";
import { GroupNode } from "@/components/zenme/nodes/group-node";
import { ImageNode } from "@/components/zenme/nodes/image-node";
import { ImageGenerationNode } from "@/components/zenme/nodes/image-edit-node";
import { NoteNode } from "@/components/zenme/nodes/note-node";
import { ReaderNode } from "@/components/zenme/nodes/reader-node";
import { TextNode } from "@/components/zenme/nodes/text-node";
import { TextGenerationNode } from "@/components/zenme/nodes/text-generation-node";
import { MusicNode } from "@/components/zenme/nodes/music-node";
import { MusicFolderNode } from "@/components/zenme/nodes/music-folder-node";
import { MusicPlayerNode } from "@/components/zenme/nodes/music-player-node";
import { LyricsNode } from "@/components/zenme/nodes/lyrics-node";
import { ManagedTextNode } from "@/components/zenme/nodes/managed-text-node";
import { TaskNode } from "@/components/zenme/nodes/task-node";
import { VideoNode } from "@/components/zenme/nodes/video-node";
import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";

export type { CanvasNodeData } from "@/components/zenme/node-types";
export {
  NODE_ACTION_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
} from "@/components/zenme/node-types";

function NodeDragBorder() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[1] rounded-xl"
    >
      <span className="zenme-node-drag-border pointer-events-auto absolute inset-x-2 top-0 h-2" />
      <span className="zenme-node-drag-border pointer-events-auto absolute inset-x-2 bottom-0 h-2" />
      <span className="zenme-node-drag-border zenme-node-drag-border-side pointer-events-auto absolute inset-y-2 left-0 w-2" />
      <span className="zenme-node-drag-border zenme-node-drag-border-side pointer-events-auto absolute inset-y-2 right-0 w-2" />
    </div>
  );
}

type CanvasContentBoundaryOptions = {
  actionHandle?: boolean;
  contextHandle?: boolean;
  dragBorder?: boolean;
};

function CanvasNodeShellFloatingHandle({
  selected,
  side,
}: {
  selected: boolean;
  side: "left" | "right";
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute top-1/2 z-10 flex size-20 -translate-y-1/2 items-center justify-center ${
        side === "left" ? "-left-16" : "-right-16"
      }`}
      data-canvas-shell-floating-handle={side}
    >
      <span
        className={`zenme-node-handle-plus zenme-node-handle-plus-${side} ${
          selected ? "zenme-node-handle-plus-visible" : ""
        }`}
      >
        <Plus
          className="size-6 rounded-full border border-zinc-400 bg-white text-zinc-500"
          strokeWidth={1.5}
        />
      </span>
    </div>
  );
}

function CanvasNodeContentShell({
  data,
  options,
  selected,
}: NodeProps & { options: CanvasContentBoundaryOptions }) {
  const nodeData = data as CanvasNodeData;
  const isGroup = nodeData.kind === "group";
  const label = nodeData.title || nodeData.name || getCanvasNodeKindLabel(
    nodeData.kind,
  );

  return (
    <div
      className={`zenme-shadow-node group relative h-full w-full rounded-xl border bg-white text-zinc-950 ${
        selected ? "border-zinc-900" : "border-zinc-200"
      } ${isGroup ? "pointer-events-none bg-zinc-50/25" : ""}`}
      data-canvas-content-shell
    >
      {!isGroup ? (
        <>
          <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
          <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
          {options.contextHandle ? (
            <CanvasNodeShellFloatingHandle
              selected={Boolean(selected)}
              side="left"
            />
          ) : null}
          {options.actionHandle ? (
            <CanvasNodeShellFloatingHandle
              selected={Boolean(selected)}
              side="right"
            />
          ) : null}
        </>
      ) : null}
      <div
        className={`zenme-node-title-bar absolute ${isGroup ? "-top-7" : "-top-8"} left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500`}
      >
        <span className="truncate">{label}</span>
      </div>
    </div>
  );
}

function getCanvasNodeKindLabel(kind: CanvasNodeData["kind"]) {
  const labels: Partial<Record<CanvasNodeData["kind"], string>> = {
    agent: "AI 回复",
    book: "书籍",
    code: "代码",
    file: "文件",
    group: "分组",
    image: "图片",
    imageGeneration: "图片生成",
    lyrics: "歌词",
    managedText: "强管理节点",
    markdown: "Markdown",
    music: "音乐",
    musicFolder: "文件夹",
    musicPlayer: "音乐播放器",
    note: "摘录",
    reader: "阅读器",
    task: "任务",
    text: "文本",
    textGeneration: "文本生成",
    video: "视频",
    videoGeneration: "视频生成",
  };
  return labels[kind] ?? "未命名节点";
}

function withCanvasContentBoundary(
  NodeComponent: ComponentType<NodeProps>,
  options: CanvasContentBoundaryOptions = {},
) {
  return memo(function NodeWithCanvasContentBoundary(props: NodeProps) {
    const nodeData = props.data as CanvasNodeData;
    const content = nodeData.canvasContentActive === false
      ? <CanvasNodeContentShell {...props} options={options} />
      : <NodeComponent {...props} />;

    return (
      <div className="contents">
        {content}
        {options.dragBorder ? <NodeDragBorder /> : null}
      </div>
    );
  });
}

function withNodeDragBorder(NodeComponent: ComponentType<NodeProps>) {
  return withCanvasContentBoundary(NodeComponent, {
    actionHandle: true,
    dragBorder: true,
  });
}

export const nodeTypes = {
  group: withCanvasContentBoundary(GroupNode),
  image: withNodeDragBorder(ImageNode),
  imageGeneration: withCanvasContentBoundary(ImageGenerationNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  videoGeneration: withCanvasContentBoundary(VideoNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  video: withCanvasContentBoundary(VideoNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  file: withNodeDragBorder(FileNode),
  music: withNodeDragBorder(MusicNode),
  musicFolder: withNodeDragBorder(MusicFolderNode),
  musicPlayer: withNodeDragBorder(MusicPlayerNode),
  lyrics: withCanvasContentBoundary(LyricsNode, {
    actionHandle: true,
    dragBorder: true,
  }),
  book: withCanvasContentBoundary(BookNode, {
    actionHandle: true,
    dragBorder: true,
  }),
  code: withCanvasContentBoundary(TextNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  markdown: withCanvasContentBoundary(TextNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  note: withCanvasContentBoundary(NoteNode, {
    actionHandle: true,
    dragBorder: true,
  }),
  reader: withCanvasContentBoundary(ReaderNode, {
    actionHandle: true,
    dragBorder: true,
  }),
  text: withCanvasContentBoundary(TextNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  managedText: withCanvasContentBoundary(ManagedTextNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  task: withCanvasContentBoundary(TaskNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  textGeneration: withCanvasContentBoundary(TextGenerationNode, {
    actionHandle: true,
    contextHandle: true,
    dragBorder: true,
  }),
  agent: withCanvasContentBoundary(TextNode, {
    actionHandle: true,
    dragBorder: true,
  }),
};
