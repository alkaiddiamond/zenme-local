import nextEnv from "@next/env";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "ZENME_E2E_USER_A_EMAIL",
  "ZENME_E2E_USER_A_PASSWORD",
  "ZENME_E2E_USER_B_EMAIL",
  "ZENME_E2E_USER_B_PASSWORD",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function getEnvValidationErrors(env = process.env) {
  return REQUIRED_ENV.flatMap((name) => {
    const value = env[name]?.trim();
    if (!value) {
      return [`Missing required env var: ${name}`];
    }

    if (
      value.startsWith("your-") ||
      value === "replace-with-test-password" ||
      value.endsWith("@example.com")
    ) {
      return [`Replace placeholder value for env var: ${name}`];
    }

    return [];
  });
}

export function requireSmokeEnv(env = process.env) {
  const errors = getEnvValidationErrors(env);
  if (errors.length > 0) {
    throw new Error(
      [
        "Supabase Auth/RLS smoke test is missing required configuration.",
        ...errors.map((error) => `- ${error}`),
        "Set these in .env.local or CI, then run `npm run smoke:supabase` again.",
      ].join("\n"),
    );
  }
}

function createSupabaseClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

async function signIn(label, email, password) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    throw new Error(`${label} sign-in failed: ${error?.message ?? "no user"}`);
  }

  return { supabase, userId: data.user.id };
}

async function selectRows(supabase, table, columns, options = {}) {
  let query = supabase.from(table).select(columns);
  for (const [column, value] of Object.entries(options.eq ?? {})) {
    query = query.eq(column, value);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`${table} query failed: ${error.message}`);
  }

  return data ?? [];
}

async function insertRow(supabase, table, payload, columns = "id") {
  const { data, error } = await supabase
    .from(table)
    .insert(payload)
    .select(columns)
    .single();

  if (error) {
    throw new Error(`${table} insert failed: ${error.message}`);
  }

  return data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function describeRows(label, rows) {
  console.log(`${label}: ${rows.length}`);
}

export async function ensureSmokeProject(label, supabase) {
  const rows = await selectRows(supabase, "projects", "id", {
    limit: 1,
  });
  if (rows.length > 0) {
    describeRows(`${label} visible projects`, rows);
    return rows[0].id;
  }

  const project = await insertRow(
    supabase,
    "projects",
    {
      name: `Zenme smoke project ${new Date().toISOString()}`,
      prompt: "Created by npm run smoke:supabase",
      model: "glm-4-flash",
    },
    "id",
  );
  console.log(`${label} smoke project created`);
  return project.id;
}

export async function ensureCanvasSnapshot(label, supabase, projectId) {
  const existingRows = await selectRows(supabase, "canvas_snapshots", "id", {
    eq: { project_id: projectId },
    limit: 1,
  });
  if (existingRows.length > 0) {
    return existingRows[0].id;
  }

  const snapshot = await insertRow(
    supabase,
    "canvas_snapshots",
    {
      project_id: projectId,
      snapshot: {
        version: 1,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: new Date().toISOString(),
      },
    },
    "id",
  );
  console.log(`${label} smoke canvas snapshot created`);
  return snapshot.id;
}

async function assertAnonBusinessTablesDenied() {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.from("projects").select("id").limit(1);
  assert(
    error && !data,
    "Anon role can query projects; business table grants should deny anon access",
  );
  console.log("Anon projects query denied");
}

export async function main() {
  requireSmokeEnv();
  await assertAnonBusinessTablesDenied();

  const userA = await signIn(
    "User A",
    process.env.ZENME_E2E_USER_A_EMAIL,
    process.env.ZENME_E2E_USER_A_PASSWORD,
  );
  const userB = await signIn(
    "User B",
    process.env.ZENME_E2E_USER_B_EMAIL,
    process.env.ZENME_E2E_USER_B_PASSWORD,
  );

  assert(userA.userId !== userB.userId, "User A and User B must be different users");

  const userAProjectId = await ensureSmokeProject("User A", userA.supabase);
  const userBProjectId = await ensureSmokeProject("User B", userB.supabase);
  const userASnapshotId = await ensureCanvasSnapshot(
    "User A",
    userA.supabase,
    userAProjectId,
  );
  const userBSnapshotId = await ensureCanvasSnapshot(
    "User B",
    userB.supabase,
    userBProjectId,
  );

  const userAProjectVisibleToB = await selectRows(userB.supabase, "projects", "id", {
    eq: { id: userAProjectId },
  });
  const userBProjectVisibleToA = await selectRows(userA.supabase, "projects", "id", {
    eq: { id: userBProjectId },
  });
  assert(userAProjectVisibleToB.length === 0, "User B can see User A project");
  assert(userBProjectVisibleToA.length === 0, "User A can see User B project");

  const userASnapshotVisibleToB = await selectRows(
    userB.supabase,
    "canvas_snapshots",
    "id",
    { eq: { id: userASnapshotId } },
  );
  const userBSnapshotVisibleToA = await selectRows(
    userA.supabase,
    "canvas_snapshots",
    "id",
    { eq: { id: userBSnapshotId } },
  );
  assert(userASnapshotVisibleToB.length === 0, "User B can see User A canvas snapshot");
  assert(userBSnapshotVisibleToA.length === 0, "User A can see User B canvas snapshot");

  const userAAssets = await selectRows(userA.supabase, "reading_assets", "id", {
    limit: 1,
  });
  if (userAAssets.length > 0) {
    const assetVisibleToB = await selectRows(userB.supabase, "reading_assets", "id", {
      eq: { id: userAAssets[0].id },
    });
    assert(assetVisibleToB.length === 0, "User B can see User A reading asset");
  } else {
    console.log("User A reading asset check skipped: no visible reading assets");
  }

  const userBFiles = await selectRows(
    userB.supabase,
    "project_files",
    "original_path",
    { limit: 1 },
  );
  if (userBFiles.length > 0 && userBFiles[0].original_path) {
    const fileRowVisibleToA = await selectRows(
      userA.supabase,
      "project_files",
      "id",
      { eq: { original_path: userBFiles[0].original_path } },
    );
    assert(fileRowVisibleToA.length === 0, "User A can see User B project file row");

    const { data, error } = await userA.supabase.storage
      .from("project-assets")
      .download(userBFiles[0].original_path);
    assert(!data && error, "User A can download User B storage object");
  } else {
    console.log("User B storage check skipped: no visible project files");
  }

  console.log("Supabase Auth/RLS smoke test passed");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
