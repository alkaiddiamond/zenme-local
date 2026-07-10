import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const STORAGE_SCHEMA_FILE = "20260624103001_create_zenme_project_canvas_schema.sql";
const REQUIRED_STORAGE_ACTIONS = ["select", "insert", "update", "delete"];

function readStorageSchemaSql() {
  return readFileSync(path.join(MIGRATIONS_DIR, STORAGE_SCHEMA_FILE), "utf8");
}

function storagePolicyStatements(sql: string) {
  return sql
    .split(/create policy /i)
    .slice(1)
    .map((statement) => `create policy ${statement.split(";")[0]};`)
    .filter((statement) => /\bon\s+storage\.objects\b/i.test(statement));
}

describe("Supabase project-assets storage policies", () => {
  it("creates project-assets as a private 50MB bucket", () => {
    const sql = readStorageSchemaSql();

    expect(sql).toMatch(
      /insert\s+into\s+storage\.buckets\s*\(\s*id\s*,\s*name\s*,\s*public\s*,\s*file_size_limit\s*\)\s*values\s*\(\s*'project-assets'\s*,\s*'project-assets'\s*,\s*false\s*,\s*52428800\s*\)/i,
    );
  });

  it("defines authenticated policies for select, insert, update, and delete", () => {
    const policies = storagePolicyStatements(readStorageSchemaSql());
    const missingActions = REQUIRED_STORAGE_ACTIONS.filter(
      (action) =>
        !policies.some((policy) =>
          new RegExp(`\\bfor\\s+${action}\\s+to\\s+authenticated\\b`, "i").test(
            policy,
          ),
        ),
    );

    expect(missingActions).toEqual([]);
  });

  it("limits every storage policy to project-assets and the current user's path prefix", () => {
    const invalidPolicies = storagePolicyStatements(readStorageSchemaSql())
      .filter(
        (policy) =>
          !/\bbucket_id\s*=\s*'project-assets'/i.test(policy) ||
          !/\(storage\.foldername\(name\)\)\[1\]\s*=\s*\(select\s+auth\.uid\(\)\)::text/i.test(
            policy,
          ),
      )
      .map((policy) => policy.replace(/\s+/g, " ").trim());

    expect(invalidPolicies).toEqual([]);
  });

  it("keeps storage object policies closed to anon", () => {
    const anonPolicies = storagePolicyStatements(readStorageSchemaSql()).filter((policy) =>
      /\bto\s+anon\b/i.test(policy),
    );

    expect(anonPolicies).toEqual([]);
  });
});
