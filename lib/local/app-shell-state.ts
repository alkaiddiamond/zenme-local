import { getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { resolveInside } from "@/lib/local/path-safety";

export type AppShellState = {
  version: 1;
  favoriteProjectIds: string[];
  pinnedProjectIds: string[];
  projectOrderIds: string[];
  openProjectIds: string[];
  sidebarCollapsed: boolean;
  localStorageMigrationCompleted: boolean;
};

const updateLocks = new Map<string, Promise<AppShellState>>();

export function createDefaultAppShellState(): AppShellState {
  return {
    version: 1,
    favoriteProjectIds: [],
    pinnedProjectIds: [],
    projectOrderIds: [],
    openProjectIds: [],
    sidebarCollapsed: false,
    localStorageMigrationCompleted: false,
  };
}

export function getAppShellStatePath(dataDir = getZenmeDataDir()) {
  return resolveInside(dataDir, "app-shell-state.json");
}

export async function getAppShellState(dataDir = getZenmeDataDir()) {
  return readJsonFile<AppShellState>(getAppShellStatePath(dataDir), {
    defaultValue: createDefaultAppShellState(),
    normalize: normalizeAppShellState,
  });
}

export async function updateAppShellState(
  updates: Partial<Omit<AppShellState, "version">>,
  dataDir = getZenmeDataDir(),
) {
  const statePath = getAppShellStatePath(dataDir);
  const previous = updateLocks.get(statePath) ?? Promise.resolve(createDefaultAppShellState());
  const next = previous.catch(() => createDefaultAppShellState()).then(async () => {
    const current = await getAppShellState(dataDir);
    const state = normalizeAppShellState({ ...current, ...updates });
    await writeJsonFile(statePath, state);
    return state;
  });
  updateLocks.set(statePath, next);

  try {
    return await next;
  } finally {
    if (updateLocks.get(statePath) === next) {
      updateLocks.delete(statePath);
    }
  }
}

function normalizeAppShellState(value: unknown): AppShellState {
  const defaults = createDefaultAppShellState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const state = value as Partial<AppShellState>;
  return {
    version: 1,
    favoriteProjectIds: normalizeProjectIds(state.favoriteProjectIds),
    pinnedProjectIds: normalizeProjectIds(state.pinnedProjectIds),
    projectOrderIds: normalizeProjectIds(state.projectOrderIds),
    openProjectIds: normalizeProjectIds(state.openProjectIds).slice(-9),
    sidebarCollapsed: state.sidebarCollapsed === true,
    localStorageMigrationCompleted:
      state.localStorageMigrationCompleted === true,
  };
}

function normalizeProjectIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (id): id is string =>
          typeof id === "string" && id.length > 0 && id.length <= 256,
      ),
    ),
  ).slice(0, 10_000);
}
