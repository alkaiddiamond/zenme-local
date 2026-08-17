import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findProjectWorkflow, listProjectWorkflows } from "@/lib/agent/workflow-discovery";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })));
});

describe("project workflow discovery", () => {
  it("loads user and project workflows and gives .zenme project definitions precedence", async () => {
    const fixture = await createFixture();
    await writeWorkflow(path.join(fixture.dataDir, "workflows", "review.js"), "review", "user");
    await writeWorkflow(path.join(fixture.workspace, ".claude", "workflows", "review.js"), "review", "claude");
    await writeWorkflow(path.join(fixture.workspace, ".zenme", "workflows", "review.js"), "review", "zenme");
    await writeWorkflow(path.join(fixture.workspace, ".claude", "workflows", "inspect.js"), "inspect", "inspect");

    const workflows = await listProjectWorkflows(fixture.projectId, fixture.dataDir);
    expect(workflows.map((workflow) => workflow.name)).toEqual(["inspect", "review"]);
    expect(workflows.find((workflow) => workflow.name === "review")).toMatchObject({
      description: "zenme",
      source: "project",
    });
    expect(await findProjectWorkflow({
      projectId: fixture.projectId,
      dataDir: fixture.dataDir,
      name: "inspect",
    })).toMatchObject({ description: "inspect" });
  });

  it("skips malformed, oversized and escaping workflow files", async () => {
    const fixture = await createFixture();
    const directory = path.join(fixture.workspace, ".zenme", "workflows");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "broken.js"), "return 1", "utf8");
    await fs.writeFile(path.join(directory, "large.js"), "x".repeat(100_001), "utf8");
    const outside = path.join(fixture.workspace, "outside.js");
    await writeWorkflow(outside, "outside", "outside");
    try { await fs.symlink(outside, path.join(directory, "escape.js")); } catch { /* Symlink creation may require Windows developer mode. */ }

    expect(await listProjectWorkflows(fixture.projectId, fixture.dataDir)).toEqual([]);
  });
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workflow-discovery-"));
  temporaryDirectories.push(root);
  const dataDir = path.join(root, "data");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const project = await createLocalProject({ name: "Workflow test", prompt: "", model: "" }, dataDir);
  await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
  return { dataDir, workspace, projectId: project.id };
}

async function writeWorkflow(filePath: string, name: string, description: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `export const meta = { name: ${JSON.stringify(name)}, description: ${JSON.stringify(description)} };\nreturn args;\n`, "utf8");
}
