import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "fs";
import path from "path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const POLICY_FILES = [
  "20260624103001_create_zenme_project_canvas_schema.sql",
  "20260628032000_create_reading_schema.sql",
  "20260628053000_harden_project_files_update_policy.sql",
  "20260628054500_optimize_reading_rls_and_indexes.sql",
];

function readMigration(fileName: string) {
  return readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
}

function migrationSqlFiles() {
  return readdirSync(MIGRATIONS_DIR).filter((fileName) => fileName.endsWith(".sql"));
}

function policyStatements(sql: string) {
  return sql
    .split(/create policy /i)
    .slice(1)
    .map((statement) => `create policy ${statement.split(";")[0]};`);
}

describe("Supabase RLS policy style", () => {
  it("limits recreated RLS policies to authenticated users", () => {
    const missingRoleClauses = POLICY_FILES.flatMap((fileName) =>
      policyStatements(readMigration(fileName))
        .filter((statement) =>
          /\bfor\s+(select|insert|update|delete)\b(?!\s+to\s+authenticated)/i.test(
            statement,
          ),
        )
        .map((statement) => `${fileName}: ${statement}`),
    );

    expect(missingRoleClauses).toEqual([]);
  });

  it("uses select auth.uid in RLS policies instead of direct auth.uid calls", () => {
    const directAuthUidPolicies = POLICY_FILES.flatMap((fileName) =>
      policyStatements(readMigration(fileName))
        .filter((statement) => /(?<!select\s+)auth\.uid\(\)/i.test(statement))
        .map((statement) => `${fileName}: ${statement}`),
    );

    expect(directAuthUidPolicies).toEqual([]);
  });

  it("keeps insert policies guarded by with check clauses", () => {
    const missingWithCheck = POLICY_FILES.flatMap((fileName) =>
      policyStatements(readMigration(fileName))
        .filter((statement) => /\bfor\s+insert\b/i.test(statement))
        .filter((statement) => !/\bwith\s+check\b/i.test(statement))
        .map((statement) => `${fileName}: ${statement}`),
    );

    expect(missingWithCheck).toEqual([]);
  });

  it("keeps update policies guarded by both using and with check clauses", () => {
    const incompleteUpdatePolicies = POLICY_FILES.flatMap((fileName) =>
      policyStatements(readMigration(fileName))
        .filter((statement) => /\bfor\s+update\b/i.test(statement))
        .filter(
          (statement) =>
            !/\busing\b/i.test(statement) || !/\bwith\s+check\b/i.test(statement),
        )
        .map((statement) => `${fileName}: ${statement}`),
    );

    expect(incompleteUpdatePolicies).toEqual([]);
  });

  it("keeps select and delete policies guarded by using clauses", () => {
    const missingUsingClauses = POLICY_FILES.flatMap((fileName) =>
      policyStatements(readMigration(fileName))
        .filter((statement) => /\bfor\s+(select|delete)\b/i.test(statement))
        .filter((statement) => !/\busing\b/i.test(statement))
        .map((statement) => `${fileName}: ${statement}`),
    );

    expect(missingUsingClauses).toEqual([]);
  });

  it("does not use deprecated auth.role checks in migrations", () => {
    const deprecatedRoleChecks = migrationSqlFiles()
      .filter((fileName) => /\bauth\.role\s*\(/i.test(readMigration(fileName)))
      .map((fileName) => `${fileName}: auth.role()`);

    expect(deprecatedRoleChecks).toEqual([]);
  });

  it("does not add security definer functions in exposed migrations", () => {
    const securityDefiners = migrationSqlFiles()
      .filter((fileName) => /\bsecurity\s+definer\b/i.test(readMigration(fileName)))
      .map((fileName) => `${fileName}: security definer`);

    expect(securityDefiners).toEqual([]);
  });
});
