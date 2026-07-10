#!/usr/bin/env node
import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SETTINGS = {
  version: 1,
  theme: "system",
  language: "zh-CN",
  recentProjectIds: [],
  autoSaveIntervalMs: 30_000,
  enableSnapshotHistory: false,
  enableCloudSyncExperimental: false,
};

export async function importZenmeExport(options) {
  const source = path.resolve(options.source);
  const dataDir = path.resolve(options.dataDir);
  const workDir = await prepareSource(source);

  try {
    await fs.mkdir(dataDir, { recursive: true });
    await ensureSettings(dataDir);

    const projects = normalizeArray(await readJsonIfExists(workDir, "projects.json"));
    const canvasSnapshots = normalizeArray(
      await readJsonIfExists(workDir, "canvas_snapshots.json"),
    );
    const projectFiles = normalizeArray(await readJsonIfExists(workDir, "project_files.json"));
    const readingAssets = normalizeArray(await readJsonIfExists(workDir, "reading_assets.json"));
    const readingSections = normalizeArray(await readJsonIfExists(workDir, "reading_sections.json"));
    const readingNotes = normalizeArray(await readJsonIfExists(workDir, "reading_notes.json"));
    const readingProgress = normalizeArray(await readJsonIfExists(workDir, "reading_progress.json"));

    const projectIds = new Set();
    for (const row of projects) {
      const project = normalizeProject(row);
      projectIds.add(project.id);
      await writeJsonAtomic(projectJsonPath(dataDir, project.id), project);
    }

    for (const row of canvasSnapshots) {
      const snapshot = normalizeCanvasSnapshot(row);
      if (!projectIds.has(snapshot.projectId)) continue;
      await writeJsonAtomic(
        path.join(dataDir, "projects", snapshot.projectId, "canvas", "latest.json"),
        {
          snapshot: snapshot.snapshot,
          updated_at: snapshot.updatedAt,
        },
      );
    }

    await importProjectFiles({
      dataDir,
      projectFiles,
      projectIds,
      sourceDir: workDir,
    });

    await importReadingAssets({
      dataDir,
      projectIds,
      readingAssets,
      readingNotes,
      readingProgress,
      readingSections,
      sourceDir: workDir,
    });

    return {
      canvasSnapshots: canvasSnapshots.length,
      projectFiles: projectFiles.length,
      projects: projects.length,
      readingAssets: readingAssets.length,
      readingNotes: readingNotes.length,
      readingProgress: readingProgress.length,
    };
  } finally {
    if (workDir !== source) {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}

async function importProjectFiles({ dataDir, projectFiles, projectIds, sourceDir }) {
  const byProject = new Map();
  for (const row of projectFiles) {
    const record = normalizeProjectFile(row);
    if (!projectIds.has(record.projectId)) continue;
    const projectDir = path.join(dataDir, "projects", record.projectId);
    await copyExportFile({
      destination: path.join(projectDir, record.originalPath),
      sourceDir,
      sourceHints: [
        record.originalPath,
        row.original_path,
        row.originalPath,
        path.join("project_files", safeStorageFileName(row.original_path ?? row.originalPath)),
        path.join("project_files", record.id),
        path.join("project_files", path.basename(record.originalPath)),
      ],
    });
    if (record.previewPath) {
      await copyExportFile({
        destination: path.join(projectDir, record.previewPath),
        optional: true,
        sourceDir,
        sourceHints: [
          record.previewPath,
          row.preview_path,
          row.previewPath,
          path.join("project_files", safeStorageFileName(row.preview_path ?? row.previewPath)),
          path.join("project_files", `${record.id}.webp`),
          path.join("project_files", path.basename(record.previewPath)),
        ],
      });
    }
    const list = byProject.get(record.projectId) ?? [];
    list.push(record);
    byProject.set(record.projectId, list);
  }

  for (const [projectId, files] of byProject) {
    await writeJsonAtomic(
      path.join(dataDir, "projects", projectId, "files", "index.json"),
      { version: 1, files },
    );
  }
}

async function importReadingAssets({
  dataDir,
  projectIds,
  readingAssets,
  readingNotes,
  readingProgress,
  readingSections,
  sourceDir,
}) {
  const notesByAsset = groupBy(readingNotes.map(normalizeReadingNote), "assetId");
  const progressByAsset = new Map(
    readingProgress.map(normalizeReadingProgress).map((item) => [item.assetId, item]),
  );
  const sectionsByAsset = groupBy(readingSections.map(normalizeReadingSection), "assetId");

  for (const row of readingAssets) {
    const asset = normalizeReadingAsset(row);
    if (!projectIds.has(asset.projectId)) continue;
    const assetDir = path.join(dataDir, "projects", asset.projectId, "reading", asset.id);
    await copyExportFile({
      destination: path.join(assetDir, asset.filePath),
      sourceDir,
      sourceHints: [
        asset.filePath,
        row.storage_path,
        row.storagePath,
        path.join("reading_files", safeStorageFileName(row.storage_path ?? row.storagePath)),
        path.join("reading_files", asset.id),
        path.join("reading_files", path.basename(asset.filePath)),
      ],
    });
    if (asset.coverPath) {
      await copyExportFile({
        destination: path.join(assetDir, asset.coverPath),
        optional: true,
        sourceDir,
        sourceHints: [
          asset.coverPath,
          row.cover_path,
          row.coverPath,
          path.join("reading_files", safeStorageFileName(row.cover_path ?? row.coverPath)),
          path.join("reading_files", `${asset.id}.cover`),
          path.join("reading_files", path.basename(asset.coverPath)),
        ],
      });
    }

    await writeJsonAtomic(path.join(assetDir, "asset.json"), asset);
    await writeJsonAtomic(
      path.join(assetDir, "sections.json"),
      (sectionsByAsset.get(asset.id) ?? []).map((section) => ({
        html: section.html,
        index: section.index,
        text: section.text,
        title: section.title,
      })),
    );
    await writeJsonAtomic(path.join(assetDir, "notes.json"), notesByAsset.get(asset.id) ?? []);
    const progress = progressByAsset.get(asset.id);
    if (progress) {
      await writeJsonAtomic(path.join(assetDir, "progress.json"), progress);
    }
  }
}

async function prepareSource(source) {
  if (source.toLowerCase().endsWith(".zip")) {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-import-"));
    new AdmZip(source).extractAllTo(workDir, true);
    return workDir;
  }
  return source;
}

async function ensureSettings(dataDir) {
  const settingsPath = path.join(dataDir, "settings.json");
  try {
    await fs.access(settingsPath);
  } catch {
    await writeJsonAtomic(settingsPath, { ...DEFAULT_SETTINGS, dataDir });
  }
}

async function readJsonIfExists(root, relativePath) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, relativePath), "utf-8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.data)) return value.data;
  return [];
}

function normalizeProject(row) {
  const id = stringValue(row.id) || crypto.randomUUID();
  const createdAt = dateValue(row.created_at ?? row.createdAt);
  const updatedAt = dateValue(row.updated_at ?? row.updatedAt, createdAt);
  return {
    version: 1,
    id,
    name: stringValue(row.name) || "未命名项目",
    prompt: stringValue(row.prompt),
    model: stringValue(row.model) || "glm-4.5",
    thumbnailPath: nullableString(row.thumbnail_path ?? row.thumbnailPath),
    createdAt,
    updatedAt,
    lastSavedAt: nullableString(row.last_saved_at ?? row.lastSavedAt),
    lastOpenedAt: nullableString(row.last_opened_at ?? row.lastOpenedAt),
    ownerId: "local",
  };
}

function normalizeCanvasSnapshot(row) {
  const projectId = stringValue(row.project_id ?? row.projectId);
  const snapshot = row.snapshot && typeof row.snapshot === "object"
    ? row.snapshot
    : { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const updatedAt = dateValue(row.updated_at ?? row.updatedAt ?? snapshot.updatedAt);
  return {
    projectId,
    snapshot: {
      version: 1,
      nodes: Array.isArray(snapshot.nodes) ? snapshot.nodes : [],
      edges: Array.isArray(snapshot.edges) ? snapshot.edges : [],
      viewport: snapshot.viewport ?? { x: 0, y: 0, zoom: 1 },
      updatedAt,
    },
    updatedAt,
  };
}

function normalizeProjectFile(row) {
  const id = stringValue(row.id) || crypto.randomUUID();
  const projectId = stringValue(row.project_id ?? row.projectId);
  const fileName = stringValue(row.file_name ?? row.fileName) || "file";
  const hasPreview = Boolean(row.preview_path ?? row.previewPath);
  return {
    id,
    projectId,
    originalPath: `files/original/${id}-${safeName(fileName)}`,
    previewPath: hasPreview ? `files/preview/${id}.webp` : null,
    fileName,
    mimeType: nullableString(row.mime_type ?? row.mimeType),
    sizeBytes: numberValue(row.size_bytes ?? row.sizeBytes),
    createdAt: dateValue(row.created_at ?? row.createdAt),
  };
}

function normalizeReadingAsset(row) {
  const id = stringValue(row.id) || crypto.randomUUID();
  const projectId = stringValue(row.project_id ?? row.projectId);
  const fileName = stringValue(row.file_name ?? row.fileName) || "book.txt";
  const storagePath = `original/${safeName(fileName)}`;
  const createdAt = dateValue(row.created_at ?? row.createdAt);
  const updatedAt = dateValue(row.updated_at ?? row.updatedAt, createdAt);
  return {
    id,
    ownerId: "local",
    projectId,
    nodeId: nullableString(row.node_id ?? row.nodeId),
    title: stringValue(row.title) || path.basename(fileName, path.extname(fileName)),
    author: nullableString(row.author),
    format: normalizeFormat(row.format, fileName),
    fileName,
    filePath: storagePath,
    storagePath,
    coverPath: row.cover_path || row.coverPath ? "cover.webp" : null,
    createdAt,
    updatedAt,
  };
}

function normalizeReadingSection(row) {
  return {
    assetId: stringValue(row.asset_id ?? row.assetId),
    index: numberValue(row.index ?? row.section_index ?? row.sectionIndex),
    title: stringValue(row.title),
    html: stringValue(row.html),
    text: stringValue(row.text),
  };
}

function normalizeReadingNote(row) {
  const now = new Date().toISOString();
  return {
    id: stringValue(row.id) || crypto.randomUUID(),
    assetId: stringValue(row.asset_id ?? row.assetId),
    ownerId: "local",
    projectId: stringValue(row.project_id ?? row.projectId),
    selectedText: stringValue(row.selected_text ?? row.selectedText),
    comment: stringValue(row.comment),
    sectionIndex: numberValue(row.section_index ?? row.sectionIndex),
    chapterTitle: nullableString(row.chapter_title ?? row.chapterTitle),
    color: normalizeColor(row.color),
    type: normalizeNoteType(row.type),
    offset: nullableNumber(row.offset),
    length: nullableNumber(row.length),
    rect: row.rect && typeof row.rect === "object" ? row.rect : null,
    sortOrder: numberValue(row.sort_order ?? row.sortOrder),
    createdAt: dateValue(row.created_at ?? row.createdAt, now),
    updatedAt: dateValue(row.updated_at ?? row.updatedAt, now),
  };
}

function normalizeReadingProgress(row) {
  return {
    assetId: stringValue(row.asset_id ?? row.assetId),
    ownerId: "local",
    contentScale: numberValue(row.content_scale ?? row.contentScale, 1),
    sectionIndex: numberValue(row.section_index ?? row.sectionIndex),
    scrollRatio: numberValue(row.scroll_ratio ?? row.scrollRatio),
    updatedAt: dateValue(row.updated_at ?? row.updatedAt),
  };
}

async function copyExportFile({ destination, optional = false, sourceDir, sourceHints }) {
  const safeDestination = resolveInside(destination);
  const source = await findExportFile(sourceDir, sourceHints);
  if (!source) {
    if (optional) return;
    throw new Error(`Missing exported file for ${destination}`);
  }
  await fs.mkdir(path.dirname(safeDestination), { recursive: true });
  await fs.copyFile(source, safeDestination);
}

async function findExportFile(sourceDir, hints) {
  for (const hint of hints.filter(Boolean)) {
    const normalized = String(hint).replaceAll("\\", "/");
    const candidates = [
      path.join(sourceDir, normalized),
      path.join(sourceDir, path.basename(normalized)),
    ];
    for (const candidate of candidates) {
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

function resolveInside(target) {
  const resolved = path.resolve(target);
  if (resolved.includes(`..${path.sep}`)) {
    throw new Error(`Unsafe path: ${target}`);
  }
  return resolved;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmpPath, filePath);
}

function projectJsonPath(dataDir, projectId) {
  return path.join(dataDir, "projects", projectId, "project.json");
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const groupKey = item[key];
    if (!groupKey) continue;
    const list = groups.get(groupKey) ?? [];
    list.push(item);
    groups.set(groupKey, list);
  }
  return groups;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function nullableString(value) {
  return typeof value === "string" && value ? value : null;
}

function numberValue(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value, fallback = new Date().toISOString()) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return fallback;
}

function safeName(fileName) {
  return path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "file";
}

function safeStorageFileName(objectPath) {
  return stringValue(objectPath).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "__");
}

function normalizeFormat(value, fileName) {
  if (value === "epub" || value === "pdf" || value === "txt") return value;
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".epub") return "epub";
  if (ext === ".pdf") return "pdf";
  return "txt";
}

function normalizeColor(value) {
  if (["yellow", "red", "blue", "green", "purple"].includes(value)) return value;
  return "yellow";
}

function normalizeNoteType(value) {
  if (["highlight", "underline", "note", "region"].includes(value)) return value;
  return "highlight";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.dataDir) {
    console.error("Usage: node scripts/import-local-data.mjs --source <export-dir-or-zip> --data-dir <zenme-data-dir>");
    process.exitCode = 1;
    return;
  }
  const summary = await importZenmeExport(args);
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--source") args.source = argv[++index];
    if (item === "--data-dir") args.dataDir = argv[++index];
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
