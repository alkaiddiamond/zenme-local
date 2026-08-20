"use client";

import { Folder, FolderPlus, Loader2, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import type { ZenmeProject } from "@/lib/zenme";

export const OPEN_CREATE_PROJECT_DIALOG_EVENT = "zenme:open-create-project-dialog";

type WorkspaceSelection = {
  displayName: string;
  displayPath: string;
  selectionId: string;
};

type DesktopProjectApi = {
  createProjectWithWorkspace?: (input: {
    name: string;
    selectionId: string;
  }) => Promise<{ project: ZenmeProject }>;
  selectProjectWorkspace?: () => Promise<{
    canceled: boolean;
    selection?: WorkspaceSelection;
  }>;
};

export function openCreateProjectDialog() {
  window.dispatchEvent(new Event(OPEN_CREATE_PROJECT_DIALOG_EVENT));
}

export function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: ZenmeProject) => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [error, setError] = useState("");
  const [isSelecting, setIsSelecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isCreating) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isCreating, onClose]);

  async function selectFolder() {
    const desktop = getDesktopProjectApi();
    if (!desktop?.selectProjectWorkspace) {
      setError("选择项目文件夹仅支持 Zenme 桌面应用");
      return;
    }
    setIsSelecting(true);
    setError("");
    try {
      const result = await desktop.selectProjectWorkspace();
      if (!result.canceled && result.selection) setSelection(result.selection);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文件夹选择失败");
    } finally {
      setIsSelecting(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || !selection || isCreating) return;
    const desktop = getDesktopProjectApi();
    if (!desktop?.createProjectWithWorkspace) {
      setError("创建 Workspace 项目仅支持 Zenme 桌面应用");
      return;
    }
    setIsCreating(true);
    setError("");
    try {
      const result = await desktop.createProjectWithWorkspace({
        name: projectName,
        selectionId: selection.selectionId,
      });
      await onCreated(result.project);
    } catch (nextError) {
      setSelection(null);
      setError(nextError instanceof Error ? nextError.message : "项目创建失败");
    } finally {
      setIsCreating(false);
    }
  }

  const busy = isCreating || isSelecting;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 p-6 backdrop-blur-[1px]"
      data-desktop-no-drag
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        aria-labelledby="create-project-title"
        aria-modal="true"
        className="zenme-shadow-overlay w-[min(640px,90vw)] rounded-2xl border border-[var(--color-border)] bg-white p-6"
        onSubmit={createProject}
        role="dialog"
      >
        <header className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold leading-7 tracking-tight text-[var(--color-text-primary)]" id="create-project-title">
            创建项目
          </h2>
          <button aria-label="关闭" className="flex size-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]" disabled={busy} onClick={onClose} type="button">
            <X className="size-5" />
          </button>
        </header>

        <div className="flex h-14 overflow-hidden rounded-xl border border-[var(--color-border)] bg-white focus-within:border-[var(--color-brand)] focus-within:shadow-[var(--shadow-focus-ring)]">
          <span className="flex w-14 shrink-0 items-center justify-center border-r border-[var(--color-border)] text-[var(--color-text-secondary)]">
            <Folder className="size-5" />
          </span>
          <Input
            aria-label="项目名称"
            className="h-full flex-1 rounded-none border-0 bg-transparent px-4 text-base shadow-none focus-visible:ring-0"
            disabled={isCreating}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            placeholder="项目名称"
            ref={inputRef}
            value={name}
          />
        </div>

        <label className="mb-2 mt-5 block text-sm font-medium leading-5 text-[var(--color-text-primary)]">源文件夹</label>
        <button
          className="flex min-h-[144px] w-full flex-col items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-6 text-center transition hover:border-[var(--color-brand)] hover:bg-[var(--color-surface-container-low)] disabled:cursor-wait disabled:opacity-60"
          disabled={busy}
          onClick={() => void selectFolder()}
          type="button"
        >
          {isSelecting ? <Loader2 className="size-6 animate-spin text-[var(--color-text-secondary)]" /> : <FolderPlus className="size-7 text-[var(--color-text-secondary)]" />}
          {selection ? (
            <>
              <span className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">{selection.displayName}</span>
              <span className="mt-1 max-w-full truncate text-xs text-[var(--color-text-tertiary)]">{selection.displayPath}</span>
              <span className="mt-2 text-xs text-[var(--color-brand)]">点击更换文件夹</span>
            </>
          ) : (
            <span className="mt-3 text-sm text-[var(--color-text-secondary)]">添加 Zenme 可读取和编辑的文件夹</span>
          )}
        </button>

        {error ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">{error}</p> : null}

        <footer className="mt-6 flex justify-end gap-2">
          <button className="h-10 rounded-lg px-4 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] disabled:opacity-50" disabled={busy} onClick={onClose} type="button">取消</button>
          <button className="h-10 rounded-lg bg-zinc-950 px-5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40" disabled={!name.trim() || !selection || busy} type="submit">
            {isCreating ? "正在创建..." : "创建项目"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function getDesktopProjectApi() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { zenmeDesktop?: DesktopProjectApi }).zenmeDesktop;
}
