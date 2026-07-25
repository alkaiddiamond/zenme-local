import fs from "node:fs/promises";
import path from "node:path";

import { getProjectDir, getProjectsDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { migrateCanvasSnapshot } from "@/lib/local/canvas-migrations";
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

const canvasSaveLocks = new Map<string, Promise<boolean>>();

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
  initialCanvas?: CanvasSnapshotPayload;
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
    snapshot: input.initialCanvas ?? {
      version: 3,
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
  let migrated = false;
  const record = await readJsonFile<CanvasSnapshotRecord | null>(snapshotPath, {
    defaultValue: null,
    normalize: (value) => {
      const result = normalizeCanvasRecord(value);
      if (
        result &&
        value &&
        typeof value === "object" &&
        "snapshot" in value &&
        value.snapshot &&
        typeof value.snapshot === "object" &&
        "version" in value.snapshot &&
        value.snapshot.version !== 3
      ) {
        migrated = true;
      }
      return result;
    },
  });
  if (record && migrated) {
    await writeJsonFile(snapshotPath, record);
  }
  return record;
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
  const snapshotPath = resolveInside(canvasDir, "latest.json");
  const previous = canvasSaveLocks.get(snapshotPath) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(async () => {
      const existing = await readJsonFile<CanvasSnapshotRecord | null>(
        snapshotPath,
        {
          defaultValue: null,
          normalize: normalizeCanvasRecord,
        },
      );
      if (
        existing &&
        Date.parse(existing.updated_at) >= Date.parse(input.snapshot.updatedAt)
      ) {
        return false;
      }

      let thumbnailPath: string | null | undefined;
      if (input.thumbnail) {
        const relativeThumbnailPath = path.join("canvas", "thumbnail.webp");
        await fs.writeFile(
          resolveInside(projectDir, relativeThumbnailPath),
          input.thumbnail,
        );
        thumbnailPath = relativeThumbnailPath.replaceAll("\\", "/");
      }

      await writeJsonFile(snapshotPath, {
        snapshot: input.snapshot,
        updated_at: input.snapshot.updatedAt,
      } satisfies CanvasSnapshotRecord);

      await touchLocalProject({
        projectId: input.projectId,
        lastSavedAt: input.snapshot.updatedAt,
        thumbnailPath,
      }, dataDir);
      return true;
    });
  canvasSaveLocks.set(snapshotPath, next);

  try {
    return await next;
  } finally {
    if (canvasSaveLocks.get(snapshotPath) === next) {
      canvasSaveLocks.delete(snapshotPath);
    }
  }
}

export async function saveLocalProjectThumbnail(input: {
  projectId: string;
  thumbnail: Buffer;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  await readRequiredProject(input.projectId, dataDir);
  const projectDir = getProjectDir(input.projectId, dataDir);
  const relativeThumbnailPath = path.join("canvas", "thumbnail.webp");
  await fs.mkdir(resolveInside(projectDir, "canvas"), { recursive: true });
  await fs.writeFile(
    resolveInside(projectDir, relativeThumbnailPath),
    input.thumbnail,
  );
  await touchLocalProject({
    projectId: input.projectId,
    thumbnailPath: relativeThumbnailPath.replaceAll("\\", "/"),
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
  const migration = migrateCanvasSnapshot(record.snapshot);
  if (!migration) return null;
  return {
    snapshot: migration.snapshot,
    updated_at: migration.snapshot.updatedAt,
  };
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
