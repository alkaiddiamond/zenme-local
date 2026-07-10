import type { LucideIcon } from "lucide-react";

import type { SaveStatus } from "./types";

type CanvasProjectStatusProps = {
  lastSavedAt?: string;
  saveStatus: SaveStatus;
  statusIcon: LucideIcon;
  statusTone: string;
};

export function CanvasProjectStatus({
  lastSavedAt,
  saveStatus,
  statusIcon: StatusIcon,
  statusTone,
}: CanvasProjectStatusProps) {
  return (
    <div
      className="pointer-events-none absolute left-5 top-4 z-20 flex select-none items-center gap-2 caret-transparent"
      data-thumbnail-hidden="true"
    >
      <p className={`flex select-none items-center gap-1 text-xs caret-transparent ${statusTone}`}>
        <StatusIcon
          className={`size-3 ${saveStatus === "保存中" ? "animate-spin" : ""}`}
        />
        {getLocalSaveStatusLabel(saveStatus)}
        {lastSavedAt
          ? ` · ${new Date(lastSavedAt).toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : ""}
      </p>
    </div>
  );
}

function getLocalSaveStatusLabel(saveStatus: SaveStatus) {
  if (saveStatus === "保存中") return "正在保存到本地";
  if (saveStatus === "已保存") return "已保存到本地";
  if (saveStatus === "保存失败") return "本地保存失败";
  if (saveStatus === "离线") return "本地服务不可用";
  return "未保存到本地";
}
