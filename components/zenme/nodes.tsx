"use client";

import { type ComponentType, memo } from "react";
import type { NodeProps } from "@xyflow/react";

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
import { MusicPlayerNode } from "@/components/zenme/nodes/music-player-node";
import { LyricsNode } from "@/components/zenme/nodes/lyrics-node";
import { ManagedTextNode } from "@/components/zenme/nodes/managed-text-node";
import { TaskNode } from "@/components/zenme/nodes/task-node";
import { VideoNode } from "@/components/zenme/nodes/video-node";

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

function withNodeDragBorder(NodeComponent: ComponentType<NodeProps>) {
  return memo(function NodeWithDragBorder(props: NodeProps) {
    return (
      <div className="contents">
        <NodeComponent {...props} />
        <NodeDragBorder />
      </div>
    );
  });
}

export const nodeTypes = {
  group: memo(GroupNode),
  image: withNodeDragBorder(ImageNode),
  imageGeneration: withNodeDragBorder(ImageGenerationNode),
  videoGeneration: withNodeDragBorder(VideoNode),
  video: withNodeDragBorder(VideoNode),
  file: withNodeDragBorder(FileNode),
  music: withNodeDragBorder(MusicNode),
  musicPlayer: withNodeDragBorder(MusicPlayerNode),
  lyrics: withNodeDragBorder(LyricsNode),
  book: withNodeDragBorder(BookNode),
  code: withNodeDragBorder(TextNode),
  markdown: withNodeDragBorder(TextNode),
  note: withNodeDragBorder(NoteNode),
  reader: withNodeDragBorder(ReaderNode),
  text: withNodeDragBorder(TextNode),
  managedText: withNodeDragBorder(ManagedTextNode),
  task: withNodeDragBorder(TaskNode),
  textGeneration: withNodeDragBorder(TextGenerationNode),
  agent: withNodeDragBorder(TextNode),
};
