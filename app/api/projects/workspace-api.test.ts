import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DELETE,
  GET,
  PATCH,
  POST,
} from "@/app/api/projects/[projectId]/workspace/route";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;
let workspaceRoot: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-api-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-api-root-"));
  process.env.ZENME_DATA_DIR = dataDir;
  process.env.ZENME_DESKTOP_TOKEN = "test-desktop-token";
  projectId = (await createLocalProject({ name: "API", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  delete process.env.ZENME_DESKTOP_TOKEN;
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 50,
  });
});

describe("workspace API", () => {
  it("rejects renderer attempts to bind an arbitrary path", async () => {
    const response = await POST(new Request(
      `http://localhost/api/projects/${projectId}/workspace`,
      { method: "POST", body: JSON.stringify({ rootPath: workspaceRoot }) },
    ), { params: Promise.resolve({ projectId }) });

    expect(response.status).toBe(403);
  });

  it("binds through the desktop secret, reads status, and unbinds", async () => {
    const bindResponse = await POST(new Request(
      `http://localhost/api/projects/${projectId}/workspace`,
      {
        method: "POST",
        headers: { "x-zenme-desktop-token": "test-desktop-token" },
        body: JSON.stringify({ rootPath: workspaceRoot }),
      },
    ), { params: Promise.resolve({ projectId }) });
    expect(bindResponse.status).toBe(201);

    const getResponse = await GET(
      new Request(`http://localhost/api/projects/${projectId}/workspace`),
      { params: Promise.resolve({ projectId }) },
    );
    await expect(getResponse.json()).resolves.toMatchObject({ status: "resolved" });

    const deleteResponse = await DELETE(
      new Request(`http://localhost/api/projects/${projectId}/workspace`, { method: "DELETE" }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(deleteResponse.status).toBe(200);
    await expect(fs.stat(workspaceRoot)).resolves.toBeDefined();
  });

  it("updates Git-write permission only through the desktop secret", async () => {
    await POST(new Request(
      `http://localhost/api/projects/${projectId}/workspace`,
      {
        method: "POST",
        headers: { "x-zenme-desktop-token": "test-desktop-token" },
        body: JSON.stringify({ rootPath: workspaceRoot }),
      },
    ), { params: Promise.resolve({ projectId }) });

    const rendererResponse = await PATCH(new Request(
      `http://localhost/api/projects/${projectId}/workspace`,
      { method: "PATCH", body: JSON.stringify({ gitWrite: true }) },
    ), { params: Promise.resolve({ projectId }) });
    expect(rendererResponse.status).toBe(403);

    const desktopResponse = await PATCH(new Request(
      `http://localhost/api/projects/${projectId}/workspace`,
      {
        method: "PATCH",
        headers: { "x-zenme-desktop-token": "test-desktop-token" },
        body: JSON.stringify({ gitWrite: true }),
      },
    ), { params: Promise.resolve({ projectId }) });
    expect(desktopResponse.status).toBe(200);
    await expect(desktopResponse.json()).resolves.toMatchObject({ permissions: { gitWrite: true } });
  });
});
