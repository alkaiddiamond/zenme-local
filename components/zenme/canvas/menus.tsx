"use client";

import {
  BookOpen,
  Image as ImageIcon,
  MessageSquareText,
  MousePointer2,
  Type,
  Upload,
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

type CanvasAddMenuProps = {
  menu: CanvasAddMenuState;
  onClose: () => void;
  onCreateTextNode: (position: { x: number; y: number }) => void;
  onUploadFiles: (position: { x: number; y: number }) => void;
};

export function CanvasAddMenu({
  menu,
  onClose,
  onCreateTextNode,
  onUploadFiles,
}: CanvasAddMenuProps) {
  return (
    <FloatingMenu
      className="rounded-2xl"
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
    kind: "text" | "agent" | "textGeneration" | "imageEdit",
  ) => void;
  onOpenReadingWorkspace: () => void;
  onProcessWithAgent: () => void;
};

export function NodeActionMenu({
  actionNode,
  menu,
  onClose,
  onCreateConnectedPlaceholder,
  onOpenReadingWorkspace,
  onProcessWithAgent,
}: NodeActionMenuProps) {
  return (
    <FloatingMenu left={menu.x + 12} top={menu.y - 8}>
      <FloatingMenuHeader onClose={onClose} title="引用该节点生成" />
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
        onClick={() => onCreateConnectedPlaceholder("imageEdit")}
        title="图片编辑"
      />
    </FloatingMenu>
  );
}
