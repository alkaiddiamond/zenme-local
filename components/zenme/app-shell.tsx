"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Folder,
  HardDrive,
  Home,
  Minus,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings,
  Square,
  Star,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/zenme/user-menu";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import {
  MusicPlaybackOverlay,
  MusicPlaybackProvider,
  useMusicPlaybackStatus,
} from "@/components/zenme/music-playback-provider";
import { cn } from "@/lib/utils";
import {
  createProjectInApi,
  deleteProjectInApi,
  getAppShellStateFromApi,
  listProjectsFromApi,
  updateAppShellStateInApi,
  updateProjectNameInApi,
} from "@/lib/zenme-api";
import {
  createProjectName,
  getProjectActivityTime,
  type ZenmeProject,
} from "@/lib/zenme";

const SIDEBAR_WIDTH = 280;
const COLLAPSED_SIDEBAR_WIDTH = 48;
const MAC_COLLAPSED_SIDEBAR_WIDTH = 112;
const TITLEBAR_HEIGHT = 40;
const OPEN_PROJECT_TABS_KEY = "zenme.openProjectTabs.v1";
const SIDEBAR_COLLAPSED_KEY = "zenme.sidebarCollapsed.v1";
const PINNED_PROJECTS_KEY = "zenme.pinnedProjects.v1";
const FAVORITE_PROJECTS_KEY = "zenme.favoriteProjects.v1";
const PROJECT_ORDER_KEY = "zenme.projectOrder.v1";

type DesktopWindowApi = {
  closeWindow?: () => Promise<void>;
  isWindowMaximized?: () => Promise<boolean>;
  minimizeWindow?: () => Promise<void>;
  onWindowMaximizedChange?: (
    listener: (isMaximized: boolean) => void,
  ) => () => void;
  platform?: string;
  toggleMaximizeWindow?: () => Promise<boolean>;
};

function getDesktopWindowApi() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { zenmeDesktop?: DesktopWindowApi }).zenmeDesktop;
}

function readLegacyProjectIds(key: string) {
  try {
    const stored = window.localStorage.getItem(key);
    const ids = stored ? JSON.parse(stored) as unknown : [];
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function persistAppShellState(
  updates: Parameters<typeof updateAppShellStateInApi>[0],
) {
  void updateAppShellStateInApi(updates).catch(() => undefined);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <MusicPlaybackProvider>
      <AppShellContent>{children}</AppShellContent>
    </MusicPlaybackProvider>
  );
}

function AppShellContent({ children }: { children: React.ReactNode }) {
  const musicPlaybackStatus = useMusicPlaybackStatus();
  const router = useRouter();
  const pathname = usePathname();
  const active = pathname === "/"
    ? "home"
    : pathname === "/projects"
      ? "projects"
      : pathname.startsWith("/settings")
        ? "settings"
        : "canvas";
  const [projects, setProjects] = useState<ZenmeProject[]>([]);
  const [query, setQuery] = useState("");
  const [openProjectIds, setOpenProjectIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [pinnedProjectIds, setPinnedProjectIds] = useState<string[]>([]);
  const [favoriteProjectIds, setFavoriteProjectIds] = useState<string[]>([]);
  const [projectOrderIds, setProjectOrderIds] = useState<string[]>([]);
  const [isAppShellStateLoaded, setIsAppShellStateLoaded] = useState(false);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [renameProjectId, setRenameProjectId] = useState<string | null>(null);
  const [renameProjectName, setRenameProjectName] = useState("");
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectError, setDeleteProjectError] = useState("");
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [desktopPlatform, setDesktopPlatform] = useState<string | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const isMacDesktop = desktopPlatform === "darwin";
  const showCustomWindowControls =
    desktopPlatform !== null && !isMacDesktop;

  const currentProjectId = useMemo(() => {
    const match = pathname.match(/^\/projects\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [pathname]);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(sortProjectsByActivity(await listProjectsFromApi()));
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const desktopWindowApi = getDesktopWindowApi();
    let cancelled = false;
    setDesktopPlatform(desktopWindowApi?.platform ?? null);
    const unsubscribe = desktopWindowApi?.onWindowMaximizedChange?.(
      setIsWindowMaximized,
    );

    void desktopWindowApi?.isWindowMaximized?.().then((maximized) => {
      if (!cancelled) setIsWindowMaximized(maximized);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAppShellState() {
      try {
        let state = await getAppShellStateFromApi();
        if (!state.localStorageMigrationCompleted) {
          state = await updateAppShellStateInApi({
            favoriteProjectIds:
              state.favoriteProjectIds.length > 0
                ? state.favoriteProjectIds
                : readLegacyProjectIds(FAVORITE_PROJECTS_KEY),
            localStorageMigrationCompleted: true,
            openProjectIds:
              state.openProjectIds.length > 0
                ? state.openProjectIds
                : readLegacyProjectIds(OPEN_PROJECT_TABS_KEY).slice(-9),
            pinnedProjectIds:
              state.pinnedProjectIds.length > 0
                ? state.pinnedProjectIds
                : readLegacyProjectIds(PINNED_PROJECTS_KEY),
            projectOrderIds:
              state.projectOrderIds.length > 0
                ? state.projectOrderIds
                : readLegacyProjectIds(PROJECT_ORDER_KEY),
            sidebarCollapsed:
              window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === null
                ? state.sidebarCollapsed
                : window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
          });
        }
        if (cancelled) return;
        setFavoriteProjectIds(state.favoriteProjectIds);
        setOpenProjectIds(state.openProjectIds);
        setPinnedProjectIds(state.pinnedProjectIds);
        setProjectOrderIds(state.projectOrderIds);
        setIsSidebarCollapsed(state.sidebarCollapsed);
      } catch {
        if (cancelled) return;
        setFavoriteProjectIds(readLegacyProjectIds(FAVORITE_PROJECTS_KEY));
        setOpenProjectIds(readLegacyProjectIds(OPEN_PROJECT_TABS_KEY).slice(-9));
        setPinnedProjectIds(readLegacyProjectIds(PINNED_PROJECTS_KEY));
        setProjectOrderIds(readLegacyProjectIds(PROJECT_ORDER_KEY));
        setIsSidebarCollapsed(
          window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
        );
      } finally {
        if (!cancelled) setIsAppShellStateLoaded(true);
      }
    }

    void loadAppShellState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAppShellStateLoaded || !projects.length) return;
    setProjectOrderIds((current) => {
      const knownProjectIds = new Set(projects.map((project) => project.id));
      const existing = current.filter((id) => knownProjectIds.has(id));
      const newProjectIds = projects
        .map((project) => project.id)
        .filter((id) => !existing.includes(id));
      const next = [...newProjectIds, ...existing];
      window.localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(next));
      persistAppShellState({ projectOrderIds: next });
      return next;
    });
  }, [isAppShellStateLoaded, projects]);

  useEffect(() => {
    if (!isAppShellStateLoaded || !currentProjectId) return;
    setOpenProjectIds((current) => {
      if (current.includes(currentProjectId)) {
        return current;
      }
      const next = [...current, currentProjectId].slice(-9);
      window.localStorage.setItem(OPEN_PROJECT_TABS_KEY, JSON.stringify(next));
      persistAppShellState({ openProjectIds: next });
      return next;
    });
  }, [currentProjectId, isAppShellStateLoaded]);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const projectPendingDeletion = deleteProjectId
    ? projectsById.get(deleteProjectId) ?? null
    : null;

  const sortedProjects = useMemo(() => {
    const pinned = new Set(pinnedProjectIds);
    const orderIndex = new Map(
      projectOrderIds.map((projectId, index) => [projectId, index]),
    );
    return [...projects].sort((a, b) => {
      const pinnedDelta = Number(pinned.has(b.id)) - Number(pinned.has(a.id));
      if (pinnedDelta) return pinnedDelta;
      const aIndex = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.name.localeCompare(b.name, "zh-CN");
    });
  }, [pinnedProjectIds, projectOrderIds, projects]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return sortedProjects;
    return sortedProjects.filter((project) =>
      `${project.name} ${project.prompt}`.toLowerCase().includes(normalizedQuery),
    );
  }, [query, sortedProjects]);

  const favoriteProjects = useMemo(() => {
    const favorites = new Set(favoriteProjectIds);
    const normalizedQuery = query.trim().toLowerCase();
    return sortedProjects.filter((project) =>
      favorites.has(project.id) &&
      (!normalizedQuery ||
        `${project.name} ${project.prompt}`.toLowerCase().includes(normalizedQuery)),
    );
  }, [favoriteProjectIds, query, sortedProjects]);

  const projectTabs = useMemo(
    () =>
      openProjectIds
        .map((projectId) => projectsById.get(projectId))
        .filter((project): project is ZenmeProject => Boolean(project)),
    [openProjectIds, projectsById],
  );

  const shellTabs = useMemo(() => {
    const tabs: Array<{
      href: string;
      id: string;
      isProject: boolean;
      label: string;
    }> = projectTabs.map((project) => ({
      href: `/projects/${project.id}`,
      id: project.id,
      isProject: true,
      label: project.name,
    }));

    if (active === "home") {
      tabs.unshift({ href: "/", id: "home", isProject: false, label: "首页" });
    }

    if (active === "projects") {
      tabs.unshift({
        href: "/projects",
        id: "projects",
        isProject: false,
        label: "项目",
      });
    }

    if (active === "settings") {
      tabs.unshift({
        href: "/settings",
        id: "settings",
        isProject: false,
        label: "设置",
      });
    }

    return tabs;
  }, [active, projectTabs]);

  const activeTabId =
    currentProjectId ??
    (active === "home" ? "home" : active === "settings" ? "settings" : "projects");
  const activeTabIndex = shellTabs.findIndex((tab) => tab.id === activeTabId);
  const sidebarWidth = isSidebarCollapsed
    ? isMacDesktop
      ? MAC_COLLAPSED_SIDEBAR_WIDTH
      : COLLAPSED_SIDEBAR_WIDTH
    : SIDEBAR_WIDTH;

  async function handleNewProject() {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const project = await createProjectInApi({
        name: createProjectName(""),
        prompt: "",
        model: "",
      });
      await refreshProjects();
      router.push(`/projects/${project.id}`);
    } finally {
      setIsCreating(false);
    }
  }

  function persistOpenProjectIds(nextIds: string[]) {
    setOpenProjectIds(nextIds);
    window.localStorage.setItem(OPEN_PROJECT_TABS_KEY, JSON.stringify(nextIds));
    persistAppShellState({ openProjectIds: nextIds });
  }

  function closeProjectTab(projectId: string) {
    const nextIds = openProjectIds.filter((id) => id !== projectId);
    persistOpenProjectIds(nextIds);

    if (currentProjectId !== projectId) return;

    const nextProjectId = nextIds.find((id) => projectsById.has(id));
    router.push(nextProjectId ? `/projects/${nextProjectId}` : "/");
  }

  function switchTab(offset: -1 | 1) {
    if (!shellTabs.length) return;
    const currentIndex = activeTabIndex >= 0 ? activeTabIndex : 0;
    const nextIndex =
      (currentIndex + offset + shellTabs.length) % shellTabs.length;
    router.push(shellTabs[nextIndex].href);
  }

  function toggleSidebar() {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      persistAppShellState({ sidebarCollapsed: next });
      return next;
    });
  }

  function beginRenameProject(project: ZenmeProject) {
    setOpenProjectMenuId(null);
    setRenameProjectId(project.id);
    setRenameProjectName(project.name);
  }

  function cancelRenameProject() {
    setRenameProjectId(null);
    setRenameProjectName("");
  }

  async function commitRenameProject() {
    const projectId = renameProjectId;
    const name = renameProjectName.trim();
    if (!projectId) return;

    const project = projectsById.get(projectId);
    if (!name || name === project?.name) {
      cancelRenameProject();
      return;
    }

    const updatedProject = await updateProjectNameInApi({ name, projectId });
    setProjects((current) =>
      sortProjectsByActivity(
        current.map((item) =>
          item.id === updatedProject.id ? updatedProject : item,
        ),
      ),
    );
    cancelRenameProject();
  }

  function toggleProjectPin(projectId: string) {
    setOpenProjectMenuId(null);
    setPinnedProjectIds((current) => {
      const next = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [projectId, ...current];
      window.localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(next));
      persistAppShellState({ pinnedProjectIds: next });
      return next;
    });
  }

  function toggleProjectFavorite(projectId: string) {
    setOpenProjectMenuId(null);
    setFavoriteProjectIds((current) => {
      const next = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
      window.localStorage.setItem(FAVORITE_PROJECTS_KEY, JSON.stringify(next));
      persistAppShellState({ favoriteProjectIds: next });
      return next;
    });
  }

  function requestDeleteProject(projectId: string) {
    setOpenProjectMenuId(null);
    setDeleteProjectError("");
    setDeleteProjectId(projectId);
  }

  function cancelDeleteProject() {
    if (isDeletingProject) return;
    setDeleteProjectId(null);
    setDeleteProjectError("");
  }

  async function confirmDeleteProject() {
    const projectId = deleteProjectId;
    if (!projectId || isDeletingProject) return;

    setIsDeletingProject(true);
    setDeleteProjectError("");

    try {
      await deleteProjectInApi(projectId);

      const nextOpenProjectIds = openProjectIds.filter((id) => id !== projectId);
      persistOpenProjectIds(nextOpenProjectIds);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setPinnedProjectIds((current) => {
        const next = current.filter((id) => id !== projectId);
        window.localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(next));
        persistAppShellState({ pinnedProjectIds: next });
        return next;
      });
      setFavoriteProjectIds((current) => {
        const next = current.filter((id) => id !== projectId);
        window.localStorage.setItem(FAVORITE_PROJECTS_KEY, JSON.stringify(next));
        persistAppShellState({ favoriteProjectIds: next });
        return next;
      });
      setProjectOrderIds((current) => {
        const next = current.filter((id) => id !== projectId);
        window.localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(next));
        persistAppShellState({ projectOrderIds: next });
        return next;
      });

      setDeleteProjectId(null);
      if (currentProjectId === projectId) {
        const nextProjectId = nextOpenProjectIds.find(
          (id) => id !== projectId && projectsById.has(id),
        );
        router.push(nextProjectId ? `/projects/${nextProjectId}` : "/");
      }
    } catch (error) {
      setDeleteProjectError(
        error instanceof Error ? error.message : "项目删除失败，请稍后重试",
      );
    } finally {
      setIsDeletingProject(false);
    }
  }

  function handleWindowMinimize() {
    void getDesktopWindowApi()?.minimizeWindow?.();
  }

  function handleWindowMaximize() {
    void getDesktopWindowApi()?.toggleMaximizeWindow?.().then(
      setIsWindowMaximized,
    );
  }

  function handleWindowClose() {
    void getDesktopWindowApi()?.closeWindow?.();
  }

  return (
    <div className="h-[100dvh] overflow-hidden bg-[var(--color-surface)] text-[var(--color-text-primary)]">
      <aside
        className="fixed bottom-0 left-0 top-0 z-50 flex flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface-sidebar)] transition-[width] duration-150 ease-out"
        style={{ width: sidebarWidth }}
      >
        <div
          className={cn(
            "flex h-10 items-center border-b border-[var(--color-border)]",
            isSidebarCollapsed ? "justify-center px-1" : "gap-2 px-2",
            isMacDesktop && "justify-start pl-[76px]",
            isMacDesktop && (isSidebarCollapsed ? "pr-1" : "pr-2"),
          )}
          data-desktop-drag-region
        >
          <button
            aria-label={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]"
            data-desktop-no-drag
            onClick={toggleSidebar}
            title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            type="button"
          >
            <PanelLeft className="size-4" />
          </button>

          {!isSidebarCollapsed ? (
            <Link
              className="flex min-w-0 items-center gap-2"
              data-desktop-no-drag
              href="/"
              title="Zenme"
            >
              <Image
                alt="Zenme"
                className="size-6 shrink-0 object-contain"
                draggable={false}
                height={28}
                src="/brand/icons/zenme-logo-256.png"
                width={28}
              />
              <span className="truncate text-sm font-medium">Zenme</span>
            </Link>
          ) : null}
        </div>

        {isSidebarCollapsed ? (
          <div className="flex flex-1 flex-col items-center gap-3 py-3">
            <button
              aria-label="新建项目"
              className="flex size-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]"
              disabled={isCreating}
              onClick={handleNewProject}
              title="新建项目"
              type="button"
            >
              <Plus className="size-5" />
            </button>
            <Link
              aria-label="项目"
              className={cn(
                "flex size-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
                (active === "projects" || active === "canvas") &&
                  "text-[var(--color-text-primary)]",
              )}
              href="/projects"
              title="项目"
            >
              <Folder className="size-5" />
            </Link>
            <Link
              aria-label="首页"
              className={cn(
                "flex size-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
                active === "home" &&
                  "text-[var(--color-text-primary)]",
              )}
              href="/"
              title="首页"
            >
              <Home className="size-5" />
            </Link>
            <Link
              aria-label="设置"
              className={cn(
                "mt-auto flex size-9 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
                active === "settings" &&
                  "text-[var(--color-text-primary)]",
              )}
              href="/settings"
              title="设置"
            >
              <Settings className="size-5" />
            </Link>
          </div>
        ) : (
          <>
        <div className="space-y-3 px-3 py-3">
          <button
            className="flex h-9 w-full items-center justify-start gap-2 rounded-md bg-transparent px-2 text-sm font-medium text-[var(--color-text-primary)] transition hover:bg-[var(--color-surface-container-high)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isCreating}
            onClick={handleNewProject}
            type="button"
          >
            <Plus className="size-4" />
            新建项目
          </button>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
            <Input
              className="h-9 rounded-lg border-[var(--color-border)] bg-white pl-9 pr-3 text-sm shadow-none placeholder:text-[var(--color-text-tertiary)] focus-visible:ring-1 focus-visible:ring-[var(--color-border-focus)]"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目"
              value={query}
            />
          </div>
        </div>

        <OverlayScrollArea
          className="min-h-0 flex-1"
          contentKey={`${query}\u0000${favoriteProjects.map(({ id }) => id).join(",")}\u0000${filteredProjects.map(({ id }) => id).join(",")}`}
          viewportClassName="h-full overflow-y-auto px-3 pb-3"
        >
          <div className="mb-4">
            <div className="mb-2 flex items-center px-1 text-xs font-medium text-[var(--color-text-secondary)]">
              <span>收藏</span>
            </div>
            <div className="space-y-1">
              {favoriteProjects.map((project) => {
                const isActive = currentProjectId === project.id;
                return (
                  <Link
                    className={cn(
                      "flex h-9 min-w-0 items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
                      isActive && "font-medium text-[var(--color-text-primary)]",
                    )}
                    href={`/projects/${project.id}`}
                    key={project.id}
                    title={project.name}
                  >
                    <Star className="size-4 shrink-0 fill-[var(--color-favorite,#b7791f)] text-[var(--color-favorite,#b7791f)]" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  </Link>
                );
              })}
              {favoriteProjects.length === 0 ? (
                <p className="px-2 py-1 text-xs text-[var(--color-text-tertiary)]">
                  暂无收藏项目
                </p>
              ) : null}
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-[var(--color-text-secondary)]">
            <span>项目</span>
            <Link
              className="font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              href="/projects"
            >
              全部
            </Link>
          </div>

          <div className="space-y-1">
            {filteredProjects.map((project) => {
              const isActive = currentProjectId === project.id;
              const isPinned = pinnedProjectIds.includes(project.id);
              const isFavorite = favoriteProjectIds.includes(project.id);

              return (
                <div
                  className={cn(
                    "group relative flex h-9 items-center rounded-md text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
                    isActive &&
                      "font-medium text-[var(--color-text-primary)]",
                  )}
                  key={project.id}
                >
                  <Link
                    className="flex min-w-0 flex-1 items-center gap-2 px-2"
                    href={`/projects/${project.id}`}
                    title={project.name}
                  >
                    {isFavorite ? (
                      <Star className="size-4 shrink-0 fill-[var(--color-favorite,#b7791f)] text-[var(--color-favorite,#b7791f)]" />
                    ) : null}
                    <Folder className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {isPinned ? (
                      <Pin className="size-3.5 shrink-0 fill-[var(--color-text-tertiary)] text-[var(--color-text-tertiary)]" />
                    ) : null}
                    <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
                      {formatProjectTime(project)}
                    </span>
                  </Link>
                  <button
                    aria-label={`${project.name} 操作`}
                    className="mr-1 hidden size-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)] group-hover:flex"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpenProjectMenuId((current) =>
                        current === project.id ? null : project.id,
                      );
                    }}
                    title="项目操作"
                    type="button"
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                  <button
                    aria-label={`重命名 ${project.name}`}
                    className="mr-1 hidden size-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)] group-hover:flex"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      beginRenameProject(project);
                    }}
                    title="重命名"
                    type="button"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {openProjectMenuId === project.id ? (
                    <div className="zenme-shadow-dropdown absolute right-1 top-8 z-50 w-32 rounded-md border border-[var(--color-border)] bg-white p-1 text-sm">
                      <button
                        className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
                        onClick={() => toggleProjectFavorite(project.id)}
                        type="button"
                      >
                        <Star className={cn("size-4", isFavorite && "fill-current")} />
                        {isFavorite ? "取消收藏" : "添加收藏"}
                      </button>
                      <button
                        className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
                        onClick={() => toggleProjectPin(project.id)}
                        type="button"
                      >
                        <Pin className="size-4" />
                        {isPinned ? "取消置顶" : "置顶"}
                      </button>
                      <button
                        className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[var(--color-danger)] hover:bg-red-50"
                        onClick={() => requestDeleteProject(project.id)}
                        type="button"
                      >
                        <Trash2 className="size-4" />
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {filteredProjects.length === 0 ? (
              <div className="rounded-md px-2 py-6 text-center text-sm text-[var(--color-text-tertiary)]">
                没有匹配项目
              </div>
            ) : null}
          </div>
        </OverlayScrollArea>

        <div className="border-t border-[var(--color-border)] p-3">
          <Link
            className={cn(
              "mb-2 flex h-9 items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
              active === "home" && "font-medium text-[var(--color-text-primary)]",
            )}
            href="/"
          >
            <Home className="size-4" />
            首页
          </Link>
          <Link
            className={cn(
              "mb-3 flex h-9 items-center gap-2 rounded-md px-2 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)] hover:text-[var(--color-text-primary)]",
              active === "settings" &&
                "font-medium text-[var(--color-text-primary)]",
            )}
            href="/settings"
          >
            <Settings className="size-4" />
            设置
          </Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
              <HardDrive className="size-4" />
              本地模式
            </div>
            <UserMenu />
          </div>
        </div>
          </>
        )}
      </aside>

      <div
        className="fixed right-0 top-0 z-40 flex h-10 items-center border-b border-[var(--color-border)] bg-[var(--color-surface-topbar)] text-[var(--color-text-secondary)]"
        data-desktop-drag-region
        style={{ left: sidebarWidth }}
      >
        <div className="flex h-full items-center border-r border-[var(--color-border)]" data-desktop-no-drag>
          <button
            aria-label="上一个标签"
            className="flex h-10 w-10 items-center justify-center transition hover:bg-[var(--color-surface-container-high)]"
            onClick={() => switchTab(-1)}
            title="上一个标签"
            type="button"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            aria-label="下一个标签"
            className="flex h-10 w-10 items-center justify-center transition hover:bg-[var(--color-surface-container-high)]"
            onClick={() => switchTab(1)}
            title="下一个标签"
            type="button"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="flex h-full min-w-0 flex-1 overflow-hidden">
          {shellTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const tabProject = tab.isProject ? projectsById.get(tab.id) : undefined;

            if (tab.isProject) {
              const isPlayingSource = musicPlaybackStatus.isPlaying &&
                musicPlaybackStatus.projectId === tab.id;
              return (
                <div
                  className={cn(
                    "group relative flex h-full min-w-0 max-w-[220px] flex-1 items-center justify-center border-r border-transparent text-sm transition hover:bg-[var(--color-surface-container-high)]",
                    isActive &&
                      "font-medium text-[var(--color-text-primary)] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--color-tab-active)]",
                  )}
                  data-desktop-no-drag
                  key={tab.id}
                  title={tab.label}
                >
                  <button
                    className="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 px-4 pr-7 text-center"
                    onClick={() => {
                      if (isActive && tabProject) {
                        beginRenameProject(tabProject);
                        return;
                      }
                      router.push(tab.href);
                    }}
                    title={isActive ? "点击重命名" : "打开项目"}
                    type="button"
                  >
                    {isPlayingSource ? (
                      <Volume2
                        aria-label="正在播放"
                        className="size-3.5 shrink-0 text-[var(--color-text-primary)]"
                      />
                    ) : null}
                    <span className="min-w-0 truncate">{tab.label}</span>
                    {pinnedProjectIds.includes(tab.id) ? (
                      <Pin className="size-3.5 shrink-0 fill-[var(--color-text-tertiary)] text-[var(--color-text-tertiary)]" />
                    ) : null}
                    {isActive ? (
                      <Pencil className="size-3.5 shrink-0 text-[var(--color-text-tertiary)] opacity-0 transition group-hover:opacity-100" />
                    ) : null}
                  </button>
                  <button
                    aria-label={`关闭 ${tab.label}`}
                    className="absolute right-2 hidden size-5 shrink-0 items-center justify-center rounded hover:bg-[var(--color-surface-container-high)] group-hover:flex"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeProjectTab(tab.id);
                    }}
                    title="关闭标签"
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            }

            return (
              <Link
                className={cn(
                  "group relative flex h-full min-w-0 max-w-[220px] flex-1 items-center justify-center border-r border-transparent px-4 text-sm transition hover:bg-[var(--color-surface-container-high)]",
                  isActive &&
                    "font-medium text-[var(--color-text-primary)] after:absolute after:bottom-0 after:left-0 after:h-0.5 after:w-full after:bg-[var(--color-tab-active)]",
                )}
                data-desktop-no-drag
                href={tab.href}
                key={tab.id}
                title={tab.label}
              >
                <span className="min-w-0 truncate">{tab.label}</span>
              </Link>
            );
          })}
        </div>

        {showCustomWindowControls ? (
          <div className="ml-auto flex h-full border-l border-[var(--color-border)]" data-desktop-no-drag>
            <button
              aria-label="最小化"
              className="flex h-10 w-12 items-center justify-center transition hover:bg-[var(--color-surface-container-high)]"
              onClick={handleWindowMinimize}
              title="最小化"
              type="button"
            >
              <Minus className="size-4" />
            </button>
            <button
              aria-label={isWindowMaximized ? "还原" : "最大化"}
              className="flex h-10 w-12 items-center justify-center transition hover:bg-[var(--color-surface-container-high)]"
              onClick={handleWindowMaximize}
              title={isWindowMaximized ? "还原" : "最大化"}
              type="button"
            >
              {isWindowMaximized ? (
                <Copy className="size-3.5" />
              ) : (
                <Square className="size-3.5" />
              )}
            </button>
            <button
              aria-label="关闭"
              className="flex h-10 w-12 items-center justify-center transition hover:bg-red-500 hover:text-white"
              onClick={handleWindowClose}
              title="关闭"
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      <main
        className={cn(
          "fixed bottom-0 right-0 transition-[left] duration-150 ease-out",
          "overflow-hidden",
        )}
        style={{ left: sidebarWidth, top: TITLEBAR_HEIGHT }}
      >
        <div className="relative size-full">
          {active === "canvas" ? (
            children
          ) : (
            <OverlayScrollArea
              className="size-full"
              viewportClassName="size-full overflow-y-auto"
            >
              {children}
            </OverlayScrollArea>
          )}
          <MusicPlaybackOverlay />
        </div>
      </main>

      {renameProjectId ? (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-black/10 pt-24"
          data-desktop-no-drag
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              cancelRenameProject();
            }
          }}
        >
          <form
            className="zenme-shadow-dropdown w-[360px] rounded-lg border border-[var(--color-border)] bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void commitRenameProject();
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-[var(--color-text-primary)]">
                重命名项目
              </h2>
              <button
                aria-label="关闭"
                className="flex size-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
                onClick={cancelRenameProject}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              autoFocus
              className="h-10 w-full rounded-md border border-[var(--color-border)] px-3 text-sm outline-none focus:border-[var(--color-border-focus)] focus:ring-2 focus:ring-slate-200"
              onChange={(event) => setRenameProjectName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRenameProject();
                }
              }}
              value={renameProjectName}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="h-8 rounded-md px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
                onClick={cancelRenameProject}
                type="button"
              >
                取消
              </button>
              <button
                className="h-8 rounded-md bg-[var(--color-run)] px-3 text-sm font-medium text-white hover:bg-[var(--color-run-hover)]"
                type="submit"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {projectPendingDeletion ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20"
          data-desktop-no-drag
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              cancelDeleteProject();
            }
          }}
        >
          <div
            aria-describedby="delete-project-description"
            aria-labelledby="delete-project-title"
            aria-modal="true"
            className="zenme-shadow-overlay w-[400px] rounded-lg border border-[var(--color-border)] bg-white p-5"
            role="alertdialog"
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-base font-medium text-[var(--color-text-primary)]"
                  id="delete-project-title"
                >
                  删除项目？
                </h2>
                <p
                  className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]"
                  id="delete-project-description"
                >
                  将永久删除“{projectPendingDeletion.name}”及其画布和本地文件，此操作无法恢复。
                </p>
              </div>
              <button
                aria-label="关闭"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                disabled={isDeletingProject}
                onClick={cancelDeleteProject}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            {deleteProjectError ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--color-danger)]">
                {deleteProjectError}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md px-3 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)] disabled:opacity-50"
                disabled={isDeletingProject}
                onClick={cancelDeleteProject}
                type="button"
              >
                取消
              </button>
              <button
                className="h-9 rounded-md bg-[var(--color-danger)] px-3 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isDeletingProject}
                onClick={() => void confirmDeleteProject()}
                type="button"
              >
                {isDeletingProject ? "正在删除..." : "删除项目"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function sortProjectsByActivity(projects: ZenmeProject[]) {
  return [...projects].sort(
    (a, b) =>
      new Date(getProjectActivityTime(b)).getTime() -
      new Date(getProjectActivityTime(a)).getTime(),
  );
}

function formatProjectTime(project: ZenmeProject) {
  const time = new Date(getProjectActivityTime(project)).getTime();
  if (!Number.isFinite(time)) return "";

  const diff = Date.now() - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)}天前`;

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(time);
}
