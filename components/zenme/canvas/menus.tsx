"use client";

import {
  BookOpen,
  BarChart3,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  MessageSquareText,
  Music2,
  MousePointer2,
  Type,
  Upload,
  WandSparkles,
} from "lucide-react";

import {
  FloatingMenu,
  FloatingMenuHeader,
  FloatingMenuItem,
  FloatingMenuSectionLabel,
} from "@/components/zenme/canvas/floating-menu";
import type {
  CanvasAddMenuState,
  CanvasNode,
  NodeActionMenuState,
} from "@/components/zenme/canvas/types";
import type { MusicChildNodeKind } from "@/components/zenme/node-types";

type CanvasAddMenuProps = {
  menu: CanvasAddMenuState;
  onClose: () => void;
  onCreateImageGenerationNode: (position: { x: number; y: number }) => void;
  onCreateTextNode: (position: { x: number; y: number }) => void;
  onUploadFiles: (position: { x: number; y: number }) => void;
};

export function CanvasAddMenu({
  menu,
  onClose,
  onCreateImageGenerationNode,
  onCreateTextNode,
  onUploadFiles,
}: CanvasAddMenuProps) {
  return (
    <FloatingMenu
      className="rounded-lg"
      left={menu.x + 12}
      top={menu.y - 8}
    >
      <FloatingMenuHeader onClose={onClose} title="添加节点" />
      <FloatingMenuItem
        description="记录、脚本、想法和说明"
        icon={Type}
        onClick={() => onCreateTextNode(menu.flowPosition)}
        primary
        title="文本"
      />
      <FloatingMenuItem
        description="根据提示词创建图片"
        icon={ImagePlus}
        onClick={() => onCreateImageGenerationNode(menu.flowPosition)}
        title="图片生成"
      />
      <FloatingMenuSectionLabel>资源</FloatingMenuSectionLabel>
      <FloatingMenuItem
        description="从系统选择图片、书籍或文件"
        icon={Upload}
        onClick={() => onUploadFiles(menu.flowPosition)}
        title="上传"
      />
    </FloatingMenu>
  );
}

type NodeActionMenuProps = {
  actionNode?: CanvasNode;
  menu: NodeActionMenuState;
  onClose: () => void;
  onCreateConnectedPlaceholder: (
    kind: "text" | "agent" | "textGeneration" | "imageGeneration",
  ) => void;
  onOpenReadingWorkspace: () => void;
  onProcessWithAgent: () => void;
  onCreateMusicPlayer: () => void;
  onCreateMusicChild: (kind: MusicChildNodeKind) => void;
};

export function NodeActionMenu({
  actionNode,
  menu,
  onClose,
  onCreateConnectedPlaceholder,
  onOpenReadingWorkspace,
  onProcessWithAgent,
  onCreateMusicPlayer,
  onCreateMusicChild,
}: NodeActionMenuProps) {
  return (
    <FloatingMenu left={menu.x + 12} top={menu.y - 8}>
      <FloatingMenuHeader onClose={onClose} title="引用该节点生成" />
      {actionNode?.data.kind === "music" ? (
        <FloatingMenuItem
          disabled={Boolean(actionNode.data.musicPlayerNodeId)}
          icon={Music2}
          onClick={onCreateMusicPlayer}
          primary
          title={actionNode.data.musicPlayerNodeId ? "播放器已创建" : "创建播放器"}
        />
      ) : null}
      {actionNode?.data.kind === "musicPlayer" ? (
        <>
          <FloatingMenuItem icon={FileText} onClick={() => onCreateMusicChild("lyrics")} primary title="歌词与结构" />
          <FloatingMenuItem icon={BarChart3} onClick={() => onCreateMusicChild("musicAnalysis")} title="综合分析" />
          <FloatingMenuItem icon={WandSparkles} onClick={() => onCreateMusicChild("sunoPrompt")} title="Suno 提示词" />
        </>
      ) : null}
      <FloatingMenuItem
        icon={MessageSquareText}
        onClick={onProcessWithAgent}
        title={
          actionNode?.data.kind === "note" ? "让 Agent 处理笔记" : "让 Agent 处理"
        }
      />
      {actionNode?.data.kind === "book" ? (
        <FloatingMenuItem
          icon={BookOpen}
          onClick={onOpenReadingWorkspace}
          title="在阅读器中打开"
        />
      ) : null}
      <FloatingMenuItem
        icon={MousePointer2}
        onClick={() => onCreateConnectedPlaceholder("text")}
        title="创建关联节点"
      />
      <FloatingMenuItem
        disabled={
          actionNode?.data.kind !== "image" ||
          (!actionNode.data.originalUrl && !actionNode.data.previewUrl)
        }
        icon={ImageIcon}
        onClick={() => onCreateConnectedPlaceholder("imageGeneration")}
        title="图片生成"
      />
    </FloatingMenu>
  );
}
