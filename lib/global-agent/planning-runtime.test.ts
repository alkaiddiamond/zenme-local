import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GlobalAgentPlanningError, parseGlobalTaskPlan, planGlobalAgentTasks } from "@/lib/global-agent/planning-runtime";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-global-planning-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("Global Agent planning runtime", () => {
  it("normalizes bounded plans, dependencies and Sub-agent tool scopes", () => {
    expect(parseGlobalTaskPlan(JSON.stringify({ tasks: [
      { title: " A ", instruction: "处理 A", rootId: "root-a", allowedPathPrefixes: ["src/a"] },
      { title: "B", instruction: "处理 B", dependsOn: [0, 3], allowedTools: ["read_file", "write_file", "delegate_tasks"] },
    ] }))).toEqual([
      { title: "A", instruction: "处理 A", rootId: "root-a", dependsOn: [], allowedPathPrefixes: ["src/a"], allowedTools: undefined },
      { title: "B", instruction: "处理 B", dependsOn: [0], allowedPathPrefixes: ["."], allowedTools: ["read_file", "write_file", "code_diagnostics"] },
    ]);
  });

  it("rejects prose and unbounded plans", () => {
    expect(() => parseGlobalTaskPlan("先分析项目")).toThrow("无效任务计划 JSON");
    expect(() => parseGlobalTaskPlan(JSON.stringify({ tasks: [] }))).toThrow("1–8");
  });

  it("uses the isolated server planning mode and returns validated tasks", async () => {
    let modelInput: { context: string; mode?: string; model: string } | undefined;
    const tasks = await planGlobalAgentTasks({
      projectId: "project-1",
      goal: "检查两个模块",
      model: "test:model",
      canvasContext: "选中模块 A 和 B",
    }, {
      dataDir,
      callModel: async (input) => {
        modelInput = input;
        return {
          text: JSON.stringify({ tasks: [
            { title: "检查 A", instruction: "检查 A", allowedPathPrefixes: ["src/a"], allowedTools: ["read_file"] },
            { title: "检查 B", instruction: "检查 B", allowedPathPrefixes: ["src/b"], allowedTools: ["read_file"] },
          ] }),
          usage: null,
        };
      },
    });

    expect(tasks).toHaveLength(2);
    expect(modelInput).toMatchObject({ mode: "agent_planning", model: "test:model" });
    expect(modelInput?.context).toContain("选中模块 A 和 B");
  });

  it("adds code diagnostics to delegated editing tasks", () => {
    expect(parseGlobalTaskPlan(JSON.stringify({ tasks: [{
      title: "修复类型错误",
      instruction: "修改 TypeScript",
      allowedTools: ["read_file", "edit_file"],
    }] }))).toEqual([
      expect.objectContaining({ allowedTools: ["read_file", "edit_file", "code_diagnostics"] }),
    ]);
  });

  it("rejects empty server planning inputs before calling a model", async () => {
    await expect(planGlobalAgentTasks({ projectId: "project-1", goal: " ", model: "test:model" }, { dataDir }))
      .rejects.toBeInstanceOf(GlobalAgentPlanningError);
  });
});
