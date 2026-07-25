"use client";

import {
  BookOpen,
  FileText,
  ImagePlus,
  ListTodo,
  MessageSquareText,
  Music2,
  MousePointer2,
  NotebookTabs,
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
import type { MusicChildNodeKind } from "@/components/zenme/node-types";

type CanvasAddMenuProps = {
  menu: CanvasAddMenuState;
  onClose: () => void;
  onCreateImageGenerationNode: (position: { x: number; y: number }) => void;
  onCreateManagedTextNode: (position: { x: number; y: number }) => void;
  onCreateTaskNode: (position: { x: number; y: number }) => void;
  onCreateTextNode: (position: { x: number; y: number }) => void;
  onUploadFiles: (position: { x: number; y: number }) => void;
};

type NodeCreationMenuItemsProps = {
  includeUpload?: boolean;
  onCreateImageGenerationNode: () => void;
  onCreateManagedTextNode: () => void;
  onCreateTaskNode: () => void;
  onCreateTextNode: () => void;
  onUploadFiles: () => void;
};

function NodeCreationMenuItems({
  includeUpload = true,
  onCreateImageGenerationNode,
  onCreateManagedTextNode,
  onCreateTaskNode,
  onCreateTextNode,
  onUploadFiles,
}: NodeCreationMenuItemsProps) {
  return (
    <>
      <FloatingMenuItem
        description="记录、脚本、想法和说明"
        icon={Type}
        onClick={onCreateTextNode}
        primary
        title="文本"
      />
      <FloatingMenuItem
        description="根据提示词创建图片"
        icon={ImagePlus}
        onClick={onCreateImageGenerationNode}
        title="图片"
      />
      <FloatingMenuItem
        description="带名称、标签和创建时间的强管理节点"
        icon={NotebookTabs}
        onClick={onCreateManagedTextNode}
        title="管理"
      />
      <FloatingMenuItem
        description="跟踪状态、优先级、进度和子任务"
        icon={ListTodo}
        onClick={onCreateTaskNode}
        title="任务"
      />
      {includeUpload ? (
        <>
          <FloatingMenuSectionLabel>资源</FloatingMenuSectionLabel>
          <FloatingMenuItem
            description="从系统选择图片、书籍或文件"
            icon={Upload}
            onClick={onUploadFiles}
            title="上传"
          />
        </>
      ) : null}
    </>
  );
}

export function CanvasAddMenu({
  menu,
  onClose,
  onCreateImageGenerationNode,
  onCreateManagedTextNode,
  onCreateTaskNode,
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
      <NodeCreationMenuItems
        onCreateImageGenerationNode={() =>
          onCreateImageGenerationNode(menu.flowPosition)
        }
        onCreateManagedTextNode={() =>
          onCreateManagedTextNode(menu.flowPosition)
        }
        onCreateTaskNode={() => onCreateTaskNode(menu.flowPosition)}
        onCreateTextNode={() => onCreateTextNode(menu.flowPosition)}
        onUploadFiles={() => onUploadFiles(menu.flowPosition)}
      />
    </FloatingMenu>
  );
}

type NodeActionMenuProps = {
  actionNode?: CanvasNode;
  menu: NodeActionMenuState;
  onClose: () => void;
  onCreateConnectedPlaceholder: (
    kind:
      | "text"
      | "agent"
      | "managedText"
      | "task"
      | "textGeneration"
      | "imageGeneration",
  ) => void;
  onUploadConnectedFiles: () => void;
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
  onUploadConnectedFiles,
  onOpenReadingWorkspace,
  onProcessWithAgent,
  onCreateMusicPlayer,
  onCreateMusicChild,
}: NodeActionMenuProps) {
  if (
    actionNode?.data.kind === "text" ||
    actionNode?.data.kind === "agent"
  ) {
    return (
      <FloatingMenu left={menu.x + 12} top={menu.y - 8}>
        <FloatingMenuHeader onClose={onClose} title="添加节点" />
        <NodeCreationMenuItems
          includeUpload={false}
          onCreateImageGenerationNode={() =>
            onCreateConnectedPlaceholder("imageGeneration")
          }
          onCreateManagedTextNode={() =>
            onCreateConnectedPlaceholder("managedText")
          }
          onCreateTaskNode={() => onCreateConnectedPlaceholder("task")}
          onCreateTextNode={() => onCreateConnectedPlaceholder("text")}
          onUploadFiles={onUploadConnectedFiles}
        />
      </FloatingMenu>
    );
  }

  if (actionNode?.data.kind === "task") {
    return (
      <FloatingMenu left={menu.x + 12} top={menu.y - 8}>
        <FloatingMenuHeader onClose={onClose} title="添加节点" />
        <NodeCreationMenuItems
          onCreateImageGenerationNode={() =>
            onCreateConnectedPlaceholder("imageGeneration")
          }
          onCreateManagedTextNode={() =>
            onCreateConnectedPlaceholder("managedText")
          }
          onCreateTaskNode={() => onCreateConnectedPlaceholder("task")}
          onCreateTextNode={() => onCreateConnectedPlaceholder("text")}
          onUploadFiles={onUploadConnectedFiles}
        />
      </FloatingMenu>
    );
  }

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
        <FloatingMenuItem icon={FileText} onClick={() => onCreateMusicChild("lyrics")} primary title="歌词" />
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
    </FloatingMenu>
  );
}
