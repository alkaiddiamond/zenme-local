import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { Handle, Position, useViewport } from "@xyflow/react";
import { Plus } from "lucide-react";

import {
  NODE_ACTION_HANDLE_ID,
  NODE_CONTEXT_HANDLE_ID,
  NODE_CONTEXT_TARGET_HANDLE_ID,
  NODE_LEFT_HANDLE_ID,
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
      className={`zenme-node-handle-hit-area zenme-node-action-handle !absolute !-right-16 ${className} !z-10 !flex !size-20 !-translate-y-1/2 !items-center !justify-center !border-0 !bg-transparent !shadow-none`}
      data-node-action
      id={NODE_ACTION_HANDLE_ID}
      position={Position.Right}
      type="source"
    >
      <MagneticHandleContent side="right">
        <span
          className={`zenme-node-handle-plus zenme-node-handle-plus-right ${
            selected ? "zenme-node-handle-plus-visible" : ""
          }`}
        >
          <Plus
            className="size-6 rounded-full border border-zinc-400 bg-white text-zinc-500 transition-colors hover:border-zinc-900 hover:text-zinc-900"
            strokeWidth={1.5}
          />
        </span>
      </MagneticHandleContent>
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
      className={`zenme-node-handle-hit-area zenme-node-context-handle !absolute !-left-16 ${className} !z-10 !flex !size-20 !-translate-y-1/2 !items-center !justify-center !border-0 !bg-transparent !shadow-none`}
      data-node-context
      id={NODE_CONTEXT_HANDLE_ID}
      position={Position.Left}
      type="source"
    >
      <MagneticHandleContent side="left">
        <span
          className={`zenme-node-handle-plus zenme-node-handle-plus-left ${
            selected ? "zenme-node-handle-plus-visible" : ""
          }`}
        >
          <Plus
            className="size-6 rounded-full border border-zinc-400 bg-white text-zinc-500 transition-colors hover:border-zinc-900 hover:text-zinc-900"
            strokeWidth={1.5}
          />
        </span>
      </MagneticHandleContent>
    </Handle>
  );
}

const MAGNET_ENTER_TRANSITION =
  "transform 250ms cubic-bezier(0.34, 1.8, 0.64, 1)";
const MAGNET_RETURN_TRANSITION =
  "transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)";

function MagneticHandleContent({
  children,
  side,
}: {
  children: ReactNode;
  side: "left" | "right";
}) {
  const { zoom } = useViewport();
  const zoomRef = useRef(zoom);
  const hitAreaRef = useRef<HTMLSpanElement>(null);
  const motionRef = useRef<HTMLSpanElement>(null);
  const centerRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  const enteringRef = useRef(true);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const bounds =
    side === "right"
      ? { bottom: 40, left: 24, right: 40, top: 40 }
      : { bottom: 40, left: 40, right: 24, top: 40 };

  const returnToOrigin = useCallback(() => {
    const element = motionRef.current;
    if (!element) return;
    element.style.transition = MAGNET_RETURN_TRANSITION;
    element.style.transform = "translate3d(0, 0, 0)";
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const element = motionRef.current;
      const center = centerRef.current;
      if (!element || !center || !activeRef.current) return;

      const safeZoom = Math.max(zoomRef.current, 0.2);
      const offsetX = (event.clientX - center.x) / safeZoom;
      const offsetY = (event.clientY - center.y) / safeZoom;
      const isOutside =
        offsetX < -bounds.left ||
        offsetX > bounds.right ||
        offsetY < -bounds.top ||
        offsetY > bounds.bottom;

      if (isOutside) {
        returnToOrigin();
        return;
      }

      if (enteringRef.current) {
        element.style.transition = MAGNET_ENTER_TRANSITION;
        enteringRef.current = false;
        if (transitionTimerRef.current) {
          clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = setTimeout(() => {
          if (motionRef.current) {
            motionRef.current.style.transition = "none";
          }
        }, 250);
      }

      element.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
    },
    [bounds.bottom, bounds.left, bounds.right, bounds.top, returnToOrigin],
  );

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const handleMouseEnter = useCallback(() => {
    const hitArea = hitAreaRef.current;
    const motion = motionRef.current;
    if (!hitArea || !motion) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    motion.style.transition = "none";
    motion.style.transform = "translate3d(0, 0, 0)";
    const rect = hitArea.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    enteringRef.current = true;
    activeRef.current = true;
    window.removeEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  const handleMouseLeave = useCallback(() => {
    returnToOrigin();
    centerRef.current = null;
    activeRef.current = false;
    window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove, returnToOrigin]);

  useEffect(
    () => () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
    },
    [handleMouseMove],
  );

  return (
    <span
      className="relative flex size-20 items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={hitAreaRef}
    >
      <span
        className="zenme-node-handle-magnetic-content relative flex items-center justify-center will-change-transform"
        ref={motionRef}
      >
        {children}
      </span>
    </span>
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
          ? "zenme-connected-source-handle !border-zinc-300 !bg-white !opacity-0"
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
  id,
  largeHitArea = false,
  revealOnHover = true,
  visible = false,
}: {
  className?: string;
  id?: string;
  largeHitArea?: boolean;
  revealOnHover?: boolean;
  visible?: boolean;
}) {
  return (
    <Handle
      className={`zenme-node-connection-handle zenme-target-handle !absolute ${largeHitArea ? "!-left-5 !size-10" : "!-left-1.5 !size-3"} ${className} !z-20 !flex !-translate-y-1/2 !items-center !justify-center !border-0 !bg-transparent !shadow-none`}
      id={id}
      position={Position.Left}
      type="target"
    >
      <span
        className={`zenme-target-handle-dot block size-3 rounded-full border border-zinc-300 bg-white shadow-sm transition ${
          visible
            ? "zenme-connected-target-handle-dot opacity-0"
            : `opacity-0 ${revealOnHover ? "group-hover:opacity-100" : ""}`
        }`}
      />
    </Handle>
  );
}

export const STANDARD_NODE_TARGET_HANDLE_ID = NODE_LEFT_HANDLE_ID;

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
