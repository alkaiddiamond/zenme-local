"use client";

import { AlertTriangle, FolderOpen, GitBranch, HardDrive, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  getWorkspaceBindingFromApi,
  unbindWorkspaceFromApi,
} from "@/lib/zenme-api";
import type { WorkspaceBinding } from "@/lib/workspace/types";

type DesktopWorkspaceApi = {
  bindProjectWorkspace?: (projectId: string) => Promise<{
    binding?: WorkspaceBinding;
    canceled: boolean;
  }>;
  setProjectWorkspaceWriteAccess?: (
    projectId: string,
    allowed: boolean,
  ) => Promise<WorkspaceBinding>;
  setProjectWorkspaceDeleteAccess?: (
    projectId: string,
    allowed: boolean,
  ) => Promise<WorkspaceBinding>;
  setProjectWorkspaceExecuteAccess?: (
    projectId: string,
    allowed: boolean,
  ) => Promise<WorkspaceBinding>;
  setProjectWorkspaceGitWriteAccess?: (
    projectId: string,
    allowed: boolean,
  ) => Promise<WorkspaceBinding>;
};

export function WorkspaceBindingDialog({
  onClose,
  projectId,
}: {
  onClose: () => void;
  projectId: string;
}) {
  const [binding, setBinding] = useState<WorkspaceBinding | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [confirmDeleteCapability, setConfirmDeleteCapability] = useState(false);
  const [confirmExecuteCapability, setConfirmExecuteCapability] = useState(false);
  const [confirmGitWriteCapability, setConfirmGitWriteCapability] = useState(false);

  const loadBinding = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setBinding(await getWorkspaceBindingFromApi(projectId));
    } catch {
      setError("Workspace 状态加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadBinding();
  }, [loadBinding]);

  async function bindWorkspace() {
    const desktop = getDesktopWorkspaceApi();
    if (!desktop?.bindProjectWorkspace) {
      setError("Workspace 绑定仅支持 Zenme 桌面应用");
      return;
    }
    setIsMutating(true);
    setError("");
    try {
      const result = await desktop.bindProjectWorkspace(projectId);
      if (!result.canceled && result.binding) {
        setBinding(result.binding);
        setConfirmUnbind(false);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Workspace 绑定失败");
    } finally {
      setIsMutating(false);
    }
  }

  async function unbindWorkspace() {
    if (!confirmUnbind) {
      setConfirmUnbind(true);
      return;
    }
    setIsMutating(true);
    setError("");
    try {
      await unbindWorkspaceFromApi(projectId);
      setBinding(null);
      setConfirmUnbind(false);
    } catch {
      setError("Workspace 解除失败");
    } finally {
      setIsMutating(false);
    }
  }

  async function setWriteAccess(allowed: boolean) {
    const desktop = getDesktopWorkspaceApi();
    if (!desktop?.setProjectWorkspaceWriteAccess) {
      setError("Workspace 写入授权仅支持 Zenme 桌面应用");
      return;
    }
    setIsMutating(true);
    setError("");
    try {
      setBinding(await desktop.setProjectWorkspaceWriteAccess(projectId, allowed));
    } catch {
      setError("Workspace 写入权限更新失败");
    } finally {
      setIsMutating(false);
    }
  }

  async function setDeleteAccess(allowed: boolean) {
    if (allowed && !confirmDeleteCapability) {
      setConfirmDeleteCapability(true);
      return;
    }
    const desktop = getDesktopWorkspaceApi();
    if (!desktop?.setProjectWorkspaceDeleteAccess) {
      setError("删除与重命名授权仅支持 Zenme 桌面应用");
      return;
    }
    setIsMutating(true);
    try {
      setBinding(await desktop.setProjectWorkspaceDeleteAccess(projectId, allowed));
      setConfirmDeleteCapability(false);
    } catch {
      setError("删除与重命名权限更新失败");
    } finally {
      setIsMutating(false);
    }
  }

  async function setExecuteAccess(allowed: boolean) {
    if (allowed && !confirmExecuteCapability) {
      setConfirmExecuteCapability(true);
      return;
    }
    const desktop = getDesktopWorkspaceApi();
    if (!desktop?.setProjectWorkspaceExecuteAccess) {
      setError("命令执行授权仅支持 Zenme 桌面应用");
      return;
    }
    setIsMutating(true);
    setError("");
    try {
      setBinding(await desktop.setProjectWorkspaceExecuteAccess(projectId, allowed));
      setConfirmExecuteCapability(false);
    } catch {
      setError("命令执行权限更新失败");
    } finally {
      setIsMutating(false);
    }
  }

  async function setGitWriteAccess(allowed: boolean) {
    if (allowed && !confirmGitWriteCapability) {
      setConfirmGitWriteCapability(true);
      return;
    }
    const desktop = getDesktopWorkspaceApi();
    if (!desktop?.setProjectWorkspaceGitWriteAccess) {
      setError("Git 写操作授权仅支持 Zenme 桌面应用");
      return;
    }
    setIsMutating(true);
    setError("");
    try {
      setBinding(await desktop.setProjectWorkspaceGitWriteAccess(projectId, allowed));
      setConfirmGitWriteCapability(false);
    } catch {
      setError("Git 写操作权限更新失败");
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/15 pt-20"
      data-desktop-no-drag
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="workspace-dialog-title"
        aria-modal="true"
        className="zenme-shadow-dropdown w-[520px] rounded-xl border border-[var(--color-border)] bg-white p-5"
        role="dialog"
      >
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-[var(--color-text-primary)]" id="workspace-dialog-title">
              项目 Workspace
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              一个项目绑定一个本地目录；读取与写入能力分别授权。
            </p>
          </div>
          <button
            aria-label="关闭"
            className="flex size-8 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>

        {isLoading ? (
          <div className="rounded-lg bg-[var(--color-surface-container-low)] p-5 text-sm text-[var(--color-text-secondary)]">
            正在检查 Workspace...
          </div>
        ) : binding ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--color-border)] p-4">
              <div className="flex items-start gap-3">
                <HardDrive className="mt-0.5 size-5 shrink-0 text-[var(--color-text-secondary)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {binding.displayName}
                    </span>
                    <WorkspaceStatusBadge status={binding.status} />
                  </div>
                  <p className="mt-1 break-all text-xs text-[var(--color-text-tertiary)]">
                    {binding.rootPath}
                  </p>
                </div>
              </div>
              {binding.status !== "resolved" ? (
                <div className="mt-3 flex gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-800">
                  <AlertTriangle className="size-4 shrink-0" />
                  {binding.status === "missing"
                    ? "原目录不存在或不可访问，请重新选择移动后的目录。"
                    : "当前路径的目录身份已经变化，所有 Workspace 能力已暂停。"}
                </div>
              ) : null}
              <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <GitBranch className="size-3.5" />
                {binding.git.available
                  ? `${binding.git.branch ?? "detached HEAD"}${binding.git.dirty ? " · 有未提交改动" : " · 工作区干净"}`
                  : "未检测到 Git 仓库"}
              </div>
              <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                {binding.status === "resolved"
                  ? `权限：读取已允许；写入${binding.permissions.write ? "已允许" : "未授权"}；删除/重命名${binding.permissions.delete ? "已允许" : "未授权"}；命令${binding.permissions.execute ? "已允许" : "未授权"}；Git 写操作${binding.permissions.gitWrite ? "已允许" : "未授权"}`
                  : "权限：目录身份恢复前全部暂停（原授权：读取）"}
              </div>
              {(binding.additionalRoots?.length ?? 0) > 0 ? (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">附加 Workspace roots</p>
                  <div className="mt-2 space-y-1.5">
                    {binding.additionalRoots?.map((root) => (
                      <div className="flex items-center gap-2 rounded-md bg-[var(--color-surface-container-low)] px-2.5 py-2 text-xs" key={root.id}>
                        <FolderOpen className="size-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
                        <span className="min-w-0 flex-1 truncate" title={root.rootPath}>{root.rootPath}</span>
                        <WorkspaceStatusBadge status={root.status} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {binding.status === "resolved" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] disabled:opacity-50" disabled={isMutating} onClick={() => void setWriteAccess(!binding.permissions.write)} type="button">{binding.permissions.write ? "关闭文件编辑" : "启用文件编辑"}</button>
                  <button className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-red-50 disabled:opacity-50" disabled={isMutating} onClick={() => void setDeleteAccess(!binding.permissions.delete)} type="button">{binding.permissions.delete ? "关闭删除/重命名" : confirmDeleteCapability ? "再次点击确认启用" : "启用删除/重命名"}</button>
                  <button className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-amber-50 disabled:opacity-50" disabled={isMutating} onClick={() => void setExecuteAccess(!binding.permissions.execute)} type="button">{binding.permissions.execute ? "关闭命令执行" : confirmExecuteCapability ? "再次点击确认启用" : "启用命令执行"}</button>
                  <button className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-amber-50 disabled:opacity-50" disabled={isMutating} onClick={() => void setGitWriteAccess(!binding.permissions.gitWrite)} type="button">{binding.permissions.gitWrite ? "关闭 Git 写操作" : confirmGitWriteCapability ? "再次点击确认启用" : "启用 Git 写操作"}</button>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between">
              <button
                className="rounded-md px-3 py-2 text-sm text-[var(--color-danger)] hover:bg-red-50 disabled:opacity-50"
                disabled={isMutating}
                onClick={() => void unbindWorkspace()}
                type="button"
              >
                {confirmUnbind ? "再次点击确认解除" : "解除绑定"}
              </button>
              <button
                className="flex items-center gap-2 rounded-md bg-[var(--color-text-primary)] px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={isMutating}
                onClick={() => void bindWorkspace()}
                type="button"
              >
                <FolderOpen className="size-4" />
                {isMutating ? "处理中..." : "重新关联"}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center">
            <FolderOpen className="mx-auto size-8 text-[var(--color-text-tertiary)]" />
            <p className="mt-3 text-sm text-[var(--color-text-primary)]">尚未绑定 Workspace</p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              选择一个现有本地项目目录。Zenme 不会复制或删除其中的文件。
            </p>
            <button
              className="mt-4 rounded-md bg-[var(--color-text-primary)] px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={isMutating}
              onClick={() => void bindWorkspace()}
              type="button"
            >
              {isMutating ? "正在绑定..." : "选择 Workspace"}
            </button>
          </div>
        )}

        {error ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function WorkspaceStatusBadge({ status }: { status: WorkspaceBinding["status"] }) {
  const label = status === "resolved"
    ? "已连接"
    : status === "missing"
      ? "目录缺失"
      : "身份不匹配";
  return (
    <span className={status === "resolved"
      ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
      : "rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800"}
    >
      {label}
    </span>
  );
}

function getDesktopWorkspaceApi() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { zenmeDesktop?: DesktopWorkspaceApi }).zenmeDesktop;
}
