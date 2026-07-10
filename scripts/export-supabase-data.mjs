#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUSINESS_TABLES = [
  "projects",
  "canvas_snapshots",
  "project_files",
  "reading_assets",
  "reading_sections",
  "reading_notes",
  "reading_progress",
];

const PROJECT_ASSETS_BUCKET = "project-assets";

export async function exportSupabaseData(options) {
  const supabaseUrl = options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    options.supabaseKey ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const outputDir = path.resolve(options.outputDir);

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  await fs.mkdir(outputDir, { recursive: true });

  const summary = {};
  for (const table of BUSINESS_TABLES) {
    const rows = await selectAll(supabase, table);
    await writeJson(path.join(outputDir, `${table}.json`), rows);
    summary[table] = rows.length;
  }

  const projectFiles = await readJson(path.join(outputDir, "project_files.json"));
  const readingAssets = await readJson(path.join(outputDir, "reading_assets.json"));
  summary.projectStorageObjects = await downloadStorageObjects({
    outputDir: path.join(outputDir, "project_files"),
    paths: projectFiles.flatMap((row) => [row.original_path, row.preview_path]).filter(Boolean),
    supabase,
  });
  summary.readingStorageObjects = await downloadStorageObjects({
    outputDir: path.join(outputDir, "reading_files"),
    paths: readingAssets.flatMap((row) => [row.storage_path, row.cover_path]).filter(Boolean),
    supabase,
  });

  await writeJson(path.join(outputDir, "manifest.json"), {
    exportedAt: new Date().toISOString(),
    format: "zenme-export",
    version: 1,
    summary,
  });

  return summary;
}

async function selectAll(supabase, table) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) {
      if (table === "reading_sections") return [];
      throw error;
    }
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function downloadStorageObjects({ outputDir, paths, supabase }) {
  await fs.mkdir(outputDir, { recursive: true });
  let downloaded = 0;

  for (const objectPath of new Set(paths)) {
    const { data, error } = await supabase.storage
      .from(PROJECT_ASSETS_BUCKET)
      .download(objectPath);
    if (error || !data) {
      continue;
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    await fs.writeFile(path.join(outputDir, safeStorageFileName(objectPath)), bytes);
    downloaded += 1;
  }

  return downloaded;
}

function safeStorageFileName(objectPath) {
  return objectPath.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "__");
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.outputDir) {
    console.error("Usage: node scripts/export-supabase-data.mjs --output-dir <export-dir>");
    process.exitCode = 1;
    return;
  }
  const summary = await exportSupabaseData(args);
  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--output-dir") args.outputDir = argv[++index];
    if (item === "--supabase-url") args.supabaseUrl = argv[++index];
    if (item === "--supabase-key") args.supabaseKey = argv[++index];
  }
  return args;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

