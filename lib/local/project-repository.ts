import fs from "node:fs/promises";
import path from "node:path";

import { getProjectDir, getProjectsDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import {
  type CanvasSnapshotPayload,
  type ZenmeProject,
} from "@/lib/zenme";

type LocalProjectFile = {
  version: 1;
  id: string;
  name: string;
  prompt: string;
  model: string;
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
  lastSavedAt: string | null;
  lastOpenedAt: string | null;
  ownerId: "local";
};

export type CanvasSnapshotRecord = {
  snapshot: CanvasSnapshotPayload;
  updated_at: string;
};

export async function listLocalProjects(dataDir = getZenmeDataDir()) {
  const projectsDir = getProjectsDir(dataDir);
  await fs.mkdir(projectsDir, { recursive: true });
  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => getLocalProject(entry.name, dataDir).catch(() => null)),
  );

  return projects
    .filter((project): project is ZenmeProject => Boolean(project))
    .sort(
      (a, b) =>
        new Date(b.lastOpenedAt ?? b.lastSavedAt ?? b.updatedAt).getTime() -
        new Date(a.lastOpenedAt ?? a.lastSavedAt ?? a.updatedAt).getTime(),
    );
}

export async function createLocalProject(input: {
  name: string;
  prompt: string;
  model: string;
}, dataDir = getZenmeDataDir()) {
  const now = new Date().toISOString();
  const project: LocalProjectFile = {
    version: 1,
    id: crypto.randomUUID(),
    name: input.name,
    prompt: input.prompt,
    model: input.model,
    thumbnailPath: null,
    createdAt: now,
    updatedAt: now,
    lastSavedAt: null,
    lastOpenedAt: now,
    ownerId: "local",
  };

  const projectDir = getProjectDir(project.id, dataDir);
  await fs.mkdir(resolveInside(projectDir, "canvas"), { recursive: true });
  await writeLocalProject(project, dataDir);
  await saveLocalCanvasSnapshot({
    projectId: project.id,
    snapshot: {
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: now,
    },
  }, dataDir);

  return toZenmeProject(project);
}

export async function getLocalProject(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  const project = await readJsonFile<LocalProjectFile | null>(
    getProjectJsonPath(projectId, dataDir),
    {
      defaultValue: null,
      normalize: normalizeProject,
    },
  );

  return project ? toZenmeProject(project) : null;
}

export async function updateLocalProjectName(input: {
  projectId: string;
  name: string;
}, dataDir = getZenmeDataDir()) {
  const project = await readRequiredProject(input.projectId, dataDir);
  project.name = input.name;
  project.updatedAt = new Date().toISOString();
  await writeLocalProject(project, dataDir);
  return toZenmeProject(project);
}

export async function touchLocalProject(input: {
  projectId: string;
  lastOpenedAt?: string;
  lastSavedAt?: string;
  thumbnailPath?: string | null;
}, dataDir = getZenmeDataDir()) {
  const project = await readRequiredProject(input.projectId, dataDir);
  const now = new Date().toISOString();
  project.updatedAt = input.lastSavedAt ?? input.lastOpenedAt ?? now;
  project.lastOpenedAt = input.lastOpenedAt ?? project.lastOpenedAt;
  project.lastSavedAt = input.lastSavedAt ?? project.lastSavedAt;
  if (input.thumbnailPath !== undefined) {
    project.thumbnailPath = input.thumbnailPath;
  }
  await writeLocalProject(project, dataDir);
  return toZenmeProject(project);
}

export async function deleteLocalProject(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  await fs.rm(getProjectDir(projectId, dataDir), { force: true, recursive: true });
}

export async function getLocalCanvasSnapshot(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  const snapshotPath = resolveInside(getProjectDir(projectId, dataDir), "canvas", "latest.json");
  return readJsonFile<CanvasSnapshotRecord | null>(snapshotPath, {
    defaultValue: null,
    normalize: normalizeCanvasRecord,
  });
}

export async function saveLocalCanvasSnapshot(input: {
  projectId: string;
  snapshot: CanvasSnapshotPayload;
  thumbnail?: Buffer;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  await readRequiredProject(input.projectId, dataDir);
  const projectDir = getProjectDir(input.projectId, dataDir);
  const canvasDir = resolveInside(projectDir, "canvas");
  await fs.mkdir(canvasDir, { recursive: true });

  let thumbnailPath: string | null | undefined;
  if (input.thumbnail) {
    const relativeThumbnailPath = path.join("canvas", "thumbnail.webp");
    await fs.writeFile(resolveInside(projectDir, relativeThumbnailPath), input.thumbnail);
    thumbnailPath = relativeThumbnailPath.replaceAll("\\", "/");
  }

  await writeJsonFile(resolveInside(canvasDir, "latest.json"), {
    snapshot: input.snapshot,
    updated_at: input.snapshot.updatedAt,
  } satisfies CanvasSnapshotRecord);

  await touchLocalProject({
    projectId: input.projectId,
    lastSavedAt: input.snapshot.updatedAt,
    thumbnailPath,
  }, dataDir);
}

export function getLocalProjectThumbnailPath(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  return resolveInside(getProjectDir(projectId, dataDir), "canvas", "thumbnail.webp");
}

function getProjectJsonPath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "project.json");
}

async function readRequiredProject(projectId: string, dataDir: string) {
  const project = await readJsonFile<LocalProjectFile | null>(
    getProjectJsonPath(projectId, dataDir),
    {
      defaultValue: null,
      normalize: normalizeProject,
    },
  );

  if (!project) {
    throw new Error("项目不存在");
  }

  return project;
}

async function writeLocalProject(project: LocalProjectFile, dataDir: string) {
  await writeJsonFile(getProjectJsonPath(project.id, dataDir), project);
}

function normalizeProject(value: unknown): LocalProjectFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Partial<LocalProjectFile>;
  if (
    row.version !== 1 ||
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.prompt !== "string" ||
    typeof row.model !== "string" ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    version: 1,
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    model: row.model,
    thumbnailPath: typeof row.thumbnailPath === "string" ? row.thumbnailPath : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSavedAt: typeof row.lastSavedAt === "string" ? row.lastSavedAt : null,
    lastOpenedAt: typeof row.lastOpenedAt === "string" ? row.lastOpenedAt : null,
    ownerId: "local",
  };
}

function normalizeCanvasRecord(value: unknown): CanvasSnapshotRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<CanvasSnapshotRecord>;
  if (!record.snapshot || typeof record.updated_at !== "string") {
    return null;
  }
  const snapshot = record.snapshot as Partial<CanvasSnapshotPayload>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.nodes) ||
    !Array.isArray(snapshot.edges) ||
    !snapshot.viewport ||
    typeof snapshot.updatedAt !== "string"
  ) {
    return null;
  }
  return record as CanvasSnapshotRecord;
}

function toZenmeProject(project: LocalProjectFile): ZenmeProject {
  return {
    id: project.id,
    name: project.name,
    prompt: project.prompt,
    model: project.model,
    thumbnailPath: project.thumbnailPath,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastSavedAt: project.lastSavedAt,
    lastOpenedAt: project.lastOpenedAt,
  };
}
