import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const BUSINESS_TABLES = [
  "projects",
  "canvas_snapshots",
  "project_files",
  "reading_assets",
  "reading_notes",
  "reading_progress",
];
const CHILD_TABLES = BUSINESS_TABLES.filter((table) => table !== "projects");

function readMigration(fileName: string) {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

function readCreateSchemaSql() {
  return [
    "20260624103001_create_zenme_project_canvas_schema.sql",
    "20260628032000_create_reading_schema.sql",
  ]
    .map(readMigration)
    .join("\n");
}

function createTableBody(sql: string, table: string) {
  return new RegExp(
    `create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  ).exec(sql)?.[1];
}

describe("Supabase business table ownership columns", () => {
  it("defines owner_id on every business table", () => {
    const sql = readCreateSchemaSql();

    expect(
      BUSINESS_TABLES.filter(
        (table) =>
          !/owner_id\s+uuid\s+not\s+null\s+default\s+auth\.uid\(\)\s+references\s+auth\.users\(id\)\s+on\s+delete\s+cascade/i.test(
            createTableBody(sql, table) ?? "",
          ),
      ),
    ).toEqual([]);
  });

  it("keeps child tables linked to projects", () => {
    const sql = readCreateSchemaSql();

    expect(
      CHILD_TABLES.filter(
        (table) =>
          !/project_id\s+uuid\s+not\s+null\s+references\s+public\.projects\(id\)\s+on\s+delete\s+cascade/i.test(
            createTableBody(sql, table) ?? "",
          ),
      ),
    ).toEqual([]);
  });
});
