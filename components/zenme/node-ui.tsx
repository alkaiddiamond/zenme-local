import { Handle, Position } from "@xyflow/react";
import { Plus } from "lucide-react";

import {
  NODE_ACTION_HANDLE_ID,
  NODE_CONTEXT_HANDLE_ID,
  NODE_CONTEXT_TARGET_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
  type CanvasNodeData,
} from "@/components/zenme/node-types";

export function uploadStatusLabel(status: CanvasNodeData["uploadStatus"]) {
  if (status === "uploaded") {
    return "已上传";
  }

  if (status === "failed") {
    return "上传失败";
  }

  return "本地";
}

export function uploadStatusClassName(status: CanvasNodeData["uploadStatus"]) {
  if (status === "uploaded") {
    return "text-emerald-600";
  }

  if (status === "failed") {
    return "text-red-600";
  }

  return "text-zinc-500";
}

export function NodeActionHandle({
  className = "!top-1/2",
  selected,
}: {
  className?: string;
  selected: boolean;
}) {
  return (
    <Handle
      className={`zenme-node-floating-control zenme-node-action-handle !absolute !-right-14 ${className} !z-10 !flex !size-8 !-translate-y-1/2 !items-center !justify-center !rounded-full !border !border-zinc-300 !bg-white !text-zinc-700 !shadow-sm !backdrop-blur !transition group-hover:!opacity-100 ${
        selected ? "opacity-100" : "opacity-0"
      }`}
      data-node-action
      id={NODE_ACTION_HANDLE_ID}
      position={Position.Right}
      type="source"
    >
      <Plus className="size-4" />
    </Handle>
  );
}

export function NodeContextHandle({
  className = "!top-1/2",
  selected,
}: {
  className?: string;
  selected: boolean;
}) {
  return (
    <Handle
      className={`zenme-node-floating-control zenme-node-context-handle !absolute !-left-14 ${className} !z-10 !flex !size-8 !-translate-y-1/2 !items-center !justify-center !rounded-full !border !border-zinc-300 !bg-white !text-zinc-700 !shadow-sm !backdrop-blur !transition group-hover:!opacity-100 ${
        selected ? "opacity-100" : "opacity-0"
      }`}
      data-node-context
      id={NODE_CONTEXT_HANDLE_ID}
      position={Position.Left}
      type="source"
    >
      <Plus className="size-4" />
    </Handle>
  );
}

export function NodeEdgeSourceHandle({
  className = "",
  visible = false,
}: {
  className?: string;
  visible?: boolean;
}) {
  return (
    <Handle
      className={`zenme-node-connection-handle !z-20 !h-3 !w-3 !shadow-sm ${className} ${
        visible
          ? "!border-zinc-300 !bg-white !opacity-100"
          : "!border-transparent !bg-transparent !opacity-0"
      }`}
      id={NODE_RIGHT_HANDLE_ID}
      position={Position.Right}
      type="source"
    />
  );
}

export function NodeTargetHandle({
  className = "!top-1/2",
  revealOnHover = true,
  visible = false,
}: {
  className?: string;
  revealOnHover?: boolean;
  visible?: boolean;
}) {
  return (
    <Handle
      className={`zenme-node-connection-handle zenme-target-handle !absolute !-left-1.5 ${className} !z-20 !flex !size-3 !-translate-y-1/2 !items-center !justify-center !border-0 !bg-transparent !shadow-none`}
      position={Position.Left}
      type="target"
    >
      <span
        className={`zenme-target-handle-dot block size-3 rounded-full border border-zinc-300 bg-white shadow-sm transition ${
          visible
            ? "opacity-100"
            : `opacity-0 ${revealOnHover ? "group-hover:opacity-100" : ""}`
        }`}
      />
    </Handle>
  );
}

export function NodeContextTargetHandle({
  revealOnHover = false,
  visible = false,
}: {
  revealOnHover?: boolean;
  visible?: boolean;
}) {
  return (
    <Handle
      className="zenme-node-floating-control zenme-context-target-handle !absolute !-right-5 !top-1/2 !z-30 !flex !size-10 !-translate-y-1/2 !items-center !justify-center !border-0 !bg-transparent !shadow-none"
      id={NODE_CONTEXT_TARGET_HANDLE_ID}
      isConnectableStart={false}
      position={Position.Right}
      type="target"
    >
      <span
        className={`zenme-context-target-handle-dot block size-3 rounded-full border border-zinc-300 bg-white shadow-sm transition ${
          visible
            ? "opacity-100"
            : `opacity-0 ${revealOnHover ? "group-hover:opacity-100" : ""}`
        }`}
      />
    </Handle>
  );
}
