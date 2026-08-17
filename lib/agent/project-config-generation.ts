import path from "node:path";

type ConfigGenerationStore = { values: Map<string, number> };
const globalStore = globalThis as typeof globalThis & { __zenmeProjectConfigGenerations?: ConfigGenerationStore };
const store = globalStore.__zenmeProjectConfigGenerations ?? { values: new Map() };
globalStore.__zenmeProjectConfigGenerations = store;

export function getProjectConfigGeneration(projectId: string, dataDir: string) {
  return store.values.get(key(projectId, dataDir));
}

export function setProjectConfigGeneration(projectId: string, dataDir: string, generation: number) {
  store.values.set(key(projectId, dataDir), generation);
}

export function clearProjectConfigGeneration(projectId: string, dataDir: string) {
  store.values.delete(key(projectId, dataDir));
}

export function resetProjectConfigGenerationsForTests() {
  store.values.clear();
}

function key(projectId: string, dataDir: string) {
  return `${path.resolve(dataDir)}\u0000${projectId}`;
}
