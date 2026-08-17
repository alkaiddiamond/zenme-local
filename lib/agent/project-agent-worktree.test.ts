import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createProjectAgentWorktree, settleProjectAgentWorktree } from "@/lib/agent/project-agent-worktree";
import { createLocalProject } from "@/lib/local/project-repository";

const execFileAsync = promisify(execFile);

describe("project agent worktree", () => {
  let dataDir: string;
  let repository: string;
  let projectId: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-worktree-data-"));
    repository = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-worktree-repo-"));
    projectId = (await createLocalProject({ name: "Worktree", prompt: "", model: "" }, dataDir)).id;
    await git(["init", "-b", "main"]);
    await git(["config", "user.email", "tests@example.com"]);
    await git(["config", "user.name", "Zenme Tests"]);
    await fs.writeFile(path.join(repository, "README.md"), "base\n");
    await git(["add", "README.md"]);
    await git(["commit", "-m", "base"]);
  });

  afterEach(async () => {
    await execFileAsync("git", ["-C", repository, "worktree", "prune"], { windowsHide: true }).catch(() => undefined);
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("cleans an unchanged worktree and keeps a changed worktree", async () => {
    const clean = await createProjectAgentWorktree({ projectId, taskId: crypto.randomUUID(), originalRootId: "root", workspacePath: repository, dataDir });
    await expect(settleProjectAgentWorktree(clean, false)).resolves.toMatchObject({ state: "cleaned" });
    await expect(fs.access(clean.path)).rejects.toThrow();

    const changed = await createProjectAgentWorktree({ projectId, taskId: crypto.randomUUID(), originalRootId: "root", workspacePath: repository, dataDir });
    await fs.writeFile(path.join(changed.path, "new.txt"), "change\n");
    await expect(settleProjectAgentWorktree(changed, false)).resolves.toMatchObject({ state: "kept" });
    await expect(fs.access(changed.path)).resolves.toBeUndefined();
    await git(["worktree", "remove", "--force", changed.path]);
    await git(["branch", "-D", changed.branch]);
  });

  function git(args: string[]) {
    return execFileAsync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true });
  }
});
