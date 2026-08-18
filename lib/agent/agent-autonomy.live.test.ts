import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { stopRunningAgentCommands } from "@/lib/agent/command-runtime";
import { getAgentExecution } from "@/lib/agent/execution-store";
import { runProjectAgentTurn } from "@/lib/agent/project-turn-runtime";
import { createLocalProject, deleteLocalProject } from "@/lib/local/project-repository";
import {
  bindLocalWorkspace,
  setLocalWorkspacePermissions,
} from "@/lib/local/workspace-repository";

const liveModel = process.env.ZENME_LIVE_AGENT_MODEL?.trim();
const liveIt = liveModel ? it : it.skip;

liveIt("solves a real unknown command failure from observation and verifies the repair", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-autonomy-"));
  const challengeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-autonomy-challenge-"));
  const challengeFile = path.join(challengeRoot, "token.txt");
  const challengeToken = `token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId = "";
  let executionId = "";

  try {
    await fs.writeFile(challengeFile, challengeToken, "utf8");
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
      name: "zenme-agent-autonomy-fixture",
      private: true,
      scripts: { "check-runtime": "node check-runtime.cjs" },
    }, null, 2));
    await fs.writeFile(path.join(workspaceRoot, "README.md"), [
      "# Runtime fixture",
      "",
      "The runtime check reads runtime-config.json.",
      "Run the check and use its real error output to discover any missing runtime value.",
      "",
    ].join("\n"));
    await fs.writeFile(path.join(workspaceRoot, "check-runtime.cjs"), [
      "const fs = require('node:fs');",
      `const expectedToken = fs.readFileSync(${JSON.stringify(challengeFile)}, 'utf8').trim();`,
      "if (!fs.existsSync('runtime-config.json')) {",
      "  console.error('RUNTIME_CONFIG_MISSING: create runtime-config.json with mode=ready and token=' + expectedToken);",
      "  process.exit(2);",
      "}",
      "let value;",
      "try { value = JSON.parse(fs.readFileSync('runtime-config.json', 'utf8')); }",
      "catch { console.error('RUNTIME_CONFIG_INVALID_JSON'); process.exit(3); }",
      "if (!value || value.mode !== 'ready' || value.token !== expectedToken || Object.keys(value).length !== 2) {",
      "  console.error('RUNTIME_CONFIG_INVALID: expected mode=ready and token=' + expectedToken + ' with no extra fields');",
      "  process.exit(4);",
      "}",
      "console.log('AUTONOMY_OK');",
      "",
    ].join("\n"));

    const project = await createLocalProject({
      name: "Agent autonomy live verification",
      prompt: "",
      model: liveModel!,
    });
    projectId = project.id;
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot });
    await setLocalWorkspacePermissions({
      projectId,
      permissions: { execute: true, write: true },
    });

    const result = await runProjectAgentTurn({
      projectId,
      model: liveModel!,
      permissionMode: "neverAsk",
      prompt: [
        "请让当前项目的 `npm run check-runtime` 真正执行成功。",
        "先运行它；如果失败，请只依据真实错误和当前 Workspace 自行诊断、改变策略并修复。",
        "不要询问我修复方法，也不要把未执行的检查写成成功。",
        "最终只有在重新运行命令并看到成功结果后才能宣告完成。",
      ].join("\n"),
    });
    executionId = result.executionId ?? "";
    expect(result.status).toBe("completed");
    expect(executionId).toBeTruthy();

    const detail = await getAgentExecution(projectId, executionId);
    expect(detail).toBeTruthy();
    const calls = detail!.toolCalls;
    const firstFailedShellIndex = calls.findIndex((call) =>
      call.name === "shell_command" && shellResultStatus(call.output) === "failed");
    expect(firstFailedShellIndex).toBeGreaterThanOrEqual(0);

    const mutationIndex = calls.findIndex((call, index) =>
      index > firstFailedShellIndex && ["write_file", "edit_file", "apply_patch"].includes(call.name) &&
      call.status === "succeeded");
    expect(mutationIndex).toBeGreaterThan(firstFailedShellIndex);

    const successfulShellIndex = calls.findIndex((call, index) =>
      index > mutationIndex && call.name === "shell_command" && shellResultStatus(call.output) === "succeeded" &&
      JSON.stringify(call.output ?? "").includes("AUTONOMY_OK"));
    expect(successfulShellIndex).toBeGreaterThan(mutationIndex);

    const config = JSON.parse(await fs.readFile(path.join(workspaceRoot, "runtime-config.json"), "utf8"));
    expect(config).toEqual({ mode: "ready", token: challengeToken });
    expect(result.answer).toContain("AUTONOMY_OK");

    console.log("LIVE_AGENT_AUTONOMY_OK", JSON.stringify({
      model: liveModel,
      trajectory: calls.map((call) => ({
        name: call.name,
        toolStatus: call.status,
        shellStatus: call.name === "shell_command" ? shellResultStatus(call.output) : undefined,
      })),
    }));
  } finally {
    if (projectId && executionId) {
      await stopRunningAgentCommands(projectId, executionId).catch(() => undefined);
    }
    if (projectId) await deleteLocalProject(projectId).catch(() => undefined);
    await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    await fs.rm(challengeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
  }
}, 120_000);

function shellResultStatus(output: unknown) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const status = (output as Record<string, unknown>).status;
  return typeof status === "string" ? status : "";
}
