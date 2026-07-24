"use client";

import { memo } from "react";

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

export type { CanvasNodeData } from "@/components/zenme/node-types";
export {
  NODE_ACTION_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
} from "@/components/zenme/node-types";

export const nodeTypes = {
  group: memo(GroupNode),
  image: memo(ImageNode),
  imageGeneration: memo(ImageGenerationNode),
  file: memo(FileNode),
  music: memo(MusicNode),
  musicPlayer: memo(MusicPlayerNode),
  lyrics: memo(LyricsNode),
  book: memo(BookNode),
  code: memo(TextNode),
  markdown: memo(TextNode),
  note: memo(NoteNode),
  reader: memo(ReaderNode),
  text: memo(TextNode),
  managedText: memo(ManagedTextNode),
  task: memo(TaskNode),
  textGeneration: memo(TextGenerationNode),
  agent: memo(TextNode),
};
