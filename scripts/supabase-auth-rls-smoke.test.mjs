import { describe, expect, it, vi } from "vitest";

import {
  ensureCanvasSnapshot,
  ensureSmokeProject,
  getEnvValidationErrors,
  requireSmokeEnv,
} from "./supabase-auth-rls-smoke.mjs";

const VALID_ENV = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_realistic_key",
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  ZENME_E2E_USER_A_EMAIL: "user-a@zenme.test",
  ZENME_E2E_USER_A_PASSWORD: "strong-password-a",
  ZENME_E2E_USER_B_EMAIL: "user-b@zenme.test",
  ZENME_E2E_USER_B_PASSWORD: "strong-password-b",
};

describe("supabase auth rls smoke env validation", () => {
  it("accepts complete non-placeholder smoke configuration", () => {
    expect(getEnvValidationErrors(VALID_ENV)).toEqual([]);
    expect(() => requireSmokeEnv(VALID_ENV)).not.toThrow();
  });

  it("reports every missing required smoke variable", () => {
    expect(getEnvValidationErrors({})).toEqual([
      "Missing required env var: NEXT_PUBLIC_SUPABASE_URL",
      "Missing required env var: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "Missing required env var: ZENME_E2E_USER_A_EMAIL",
      "Missing required env var: ZENME_E2E_USER_A_PASSWORD",
      "Missing required env var: ZENME_E2E_USER_B_EMAIL",
      "Missing required env var: ZENME_E2E_USER_B_PASSWORD",
    ]);
  });

  it("rejects placeholder smoke values", () => {
    expect(
      getEnvValidationErrors({
        ...VALID_ENV,
        NEXT_PUBLIC_SUPABASE_URL: "your-supabase-url",
        ZENME_E2E_USER_A_EMAIL: "user-a@example.com",
        ZENME_E2E_USER_B_PASSWORD: "replace-with-test-password",
      }),
    ).toEqual([
      "Replace placeholder value for env var: NEXT_PUBLIC_SUPABASE_URL",
      "Replace placeholder value for env var: ZENME_E2E_USER_A_EMAIL",
      "Replace placeholder value for env var: ZENME_E2E_USER_B_PASSWORD",
    ]);
  });

  it("throws a readable setup message before touching Supabase", () => {
    expect(() => requireSmokeEnv({})).toThrow(
      /Supabase Auth\/RLS smoke test is missing required configuration/,
    );
  });
});

function createSupabaseTableMock({
  insertData,
  selectData,
  selectError = null,
  insertError = null,
} = {}) {
  const calls = [];
  const single = vi.fn().mockResolvedValue({
    data: insertData ?? { id: "created-row" },
    error: insertError,
  });
  const insertSelect = vi.fn().mockReturnValue({ single });
  const insert = vi.fn((payload) => {
    calls.push({ payload, type: "insert" });
    return { select: insertSelect };
  });
  const query = {
    eq: vi.fn((column, value) => {
      calls.push({ column, type: "eq", value });
      return query;
    }),
    limit: vi.fn((value) => {
      calls.push({ type: "limit", value });
      return Promise.resolve({ data: selectData ?? [], error: selectError });
    }),
  };
  const select = vi.fn((columns) => {
    calls.push({ columns, type: "select" });
    return query;
  });
  const from = vi.fn((table) => {
    calls.push({ table, type: "from" });
    return { insert, select };
  });

  return {
    calls,
    from,
    insert,
    insertSelect,
    query,
    single,
    supabase: { from },
  };
}

describe("supabase auth rls smoke data preparation", () => {
  it("reuses an existing visible project", async () => {
    const mock = createSupabaseTableMock({
      selectData: [{ id: "existing-project" }],
    });

    await expect(
      ensureSmokeProject("User A", mock.supabase),
    ).resolves.toBe("existing-project");

    expect(mock.from).toHaveBeenCalledWith("projects");
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("creates a smoke project when the test user has none", async () => {
    const mock = createSupabaseTableMock({
      insertData: { id: "created-project" },
      selectData: [],
    });

    await expect(
      ensureSmokeProject("User A", mock.supabase),
    ).resolves.toBe("created-project");

    expect(mock.from).toHaveBeenCalledWith("projects");
    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "glm-4-flash",
        prompt: "Created by npm run smoke:supabase",
      }),
    );
  });

  it("reuses an existing canvas snapshot for the smoke project", async () => {
    const mock = createSupabaseTableMock({
      selectData: [{ id: "existing-snapshot" }],
    });

    await expect(
      ensureCanvasSnapshot("User A", mock.supabase, "project-1"),
    ).resolves.toBe("existing-snapshot");

    expect(mock.from).toHaveBeenCalledWith("canvas_snapshots");
    expect(mock.query.eq).toHaveBeenCalledWith("project_id", "project-1");
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("creates a canvas snapshot when the smoke project has none", async () => {
    const mock = createSupabaseTableMock({
      insertData: { id: "created-snapshot" },
      selectData: [],
    });

    await expect(
      ensureCanvasSnapshot("User A", mock.supabase, "project-1"),
    ).resolves.toBe("created-snapshot");

    expect(mock.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-1",
        snapshot: expect.objectContaining({
          edges: [],
          nodes: [],
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
        }),
      }),
    );
  });
});
