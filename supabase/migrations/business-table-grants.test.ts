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
const GRANT_FILES = [
  "20260628061000_restrict_anon_business_table_grants.sql",
  "20260628061500_minimize_business_table_grants.sql",
];

function readMigration(fileName: string) {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

describe("Supabase business table grants", () => {
  it("revokes anon privileges from every business table", () => {
    const sql = readMigration("20260628061000_restrict_anon_business_table_grants.sql");

    expect(
      BUSINESS_TABLES.filter(
        (table) =>
          !new RegExp(
            `revoke\\s+all\\s+privileges\\s+on\\s+table\\s+public\\.${table}\\s+from\\s+anon`,
            "i",
          ).test(sql),
      ),
    ).toEqual([]);
  });

  it("does not grant business table privileges to anon", () => {
    const anonGrants = GRANT_FILES.flatMap((fileName) =>
      readMigration(fileName)
        .split(";")
        .filter((statement) => /^\s*grant\b/i.test(statement))
        .filter((statement) => /\bto\b[\s\S]*\banon\b/i.test(statement))
        .map((statement) => `${fileName}: ${statement.trim()};`),
    );

    expect(anonGrants).toEqual([]);
  });

  it("grants business table data access only to authenticated and service_role", () => {
    const invalidGrants = GRANT_FILES.flatMap((fileName) =>
      readMigration(fileName)
        .split(";")
        .filter((statement) => /^\s*grant\b/i.test(statement))
        .filter(
          (statement) =>
            !/\bto\s+authenticated\s*,\s*service_role\s*$/i.test(statement.trim()),
        )
        .map((statement) => `${fileName}: ${statement.trim()};`),
    );

    expect(invalidGrants).toEqual([]);
  });
});
