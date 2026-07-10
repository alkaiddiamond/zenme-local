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

function readMigration(fileName: string) {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

function readAllMigrationSql() {
  return [
    "20260624103001_create_zenme_project_canvas_schema.sql",
    "20260628032000_create_reading_schema.sql",
    "20260628053000_harden_project_files_update_policy.sql",
    "20260628054500_optimize_reading_rls_and_indexes.sql",
    "20260628061000_restrict_anon_business_table_grants.sql",
    "20260628061500_minimize_business_table_grants.sql",
  ]
    .map(readMigration)
    .join("\n");
}

describe("Supabase business table RLS", () => {
  it("enables row level security on every business table", () => {
    const sql = readAllMigrationSql();

    expect(
      BUSINESS_TABLES.filter(
        (table) =>
          !new RegExp(
            `alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
            "i",
          ).test(sql),
      ),
    ).toEqual([]);
  });

  it("does not disable row level security on business tables", () => {
    const sql = readAllMigrationSql();
    const disabledTables = BUSINESS_TABLES.filter((table) =>
      new RegExp(
        `alter\\s+table\\s+public\\.${table}\\s+disable\\s+row\\s+level\\s+security`,
        "i",
      ).test(sql),
    );

    expect(disabledTables).toEqual([]);
  });
});
