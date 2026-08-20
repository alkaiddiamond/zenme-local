import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readProjectAgentPlan, writeProjectAgentPlan } from "@/lib/agent/project-plan";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-plan-"));
  projectId = (await createLocalProject({ name: "Plan isolation", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("project agent plan storage", () => {
  it("keeps conversation plan files isolated while preserving the legacy project plan", async () => {
    await writeProjectAgentPlan(projectId, "legacy plan", dataDir);
    await writeProjectAgentPlan(projectId, "plan A", dataDir, "conv-a");
    await writeProjectAgentPlan(projectId, "plan B", dataDir, "conv-b");

    await expect(readProjectAgentPlan(projectId, dataDir)).resolves.toBe("legacy plan");
    await expect(readProjectAgentPlan(projectId, dataDir, "conv-a")).resolves.toBe("plan A");
    await expect(readProjectAgentPlan(projectId, dataDir, "conv-b")).resolves.toBe("plan B");
  });
});
