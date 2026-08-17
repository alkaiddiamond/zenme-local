import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAgentExecution, getAgentExecution } from "@/lib/agent/execution-store";
import { createLocalProject } from "@/lib/local/project-repository";
import {
  AgentToolPipelineError,
  executeAgentToolPipeline,
} from "@/lib/agent/tool-execution-pipeline";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe("executeAgentToolPipeline", () => {
  it("runs validate, pre hook, permission, execute and post hook in cc-haha order", async () => {
    const { dataDir, projectId, executionId } = await fixture();
    const order: string[] = [];
    const result = await executeAgentToolPipeline({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "before.txt" },
      validate: (argumentsValue) => {
        order.push(`validate:${argumentsValue.relativePath}`);
        return typeof argumentsValue.relativePath === "string";
      },
      preHooks: [async () => {
        order.push("pre");
        return {
          arguments: { relativePath: "after.txt" },
          permission: "allow",
          additionalContext: "pre context",
        };
      }],
      authorize: ({ arguments: argumentsValue, hookPermission }) => {
        order.push(`permission:${argumentsValue.relativePath}:${hookPermission}`);
        return "allow";
      },
      execute: async ({ arguments: argumentsValue }) => {
        order.push(`execute:${argumentsValue.relativePath}`);
        return { text: "raw" };
      },
      postSuccessHooks: [async ({ output }) => {
        order.push(`post:${output.text}`);
        return { output: { text: "normalized" }, additionalContext: "post context" };
      }],
    }, dataDir);

    expect(order).toEqual([
      "validate:before.txt",
      "pre",
      "validate:after.txt",
      "permission:after.txt:allow",
      "execute:after.txt",
      "post:raw",
    ]);
    expect(result).toMatchObject({
      arguments: { relativePath: "after.txt" },
      output: { text: "normalized" },
      additionalContext: ["pre context", "post context"],
    });
    expect((await getAgentExecution(projectId, executionId, dataDir))?.toolCalls).toEqual([
      expect.objectContaining({
        arguments: { relativePath: "after.txt" },
        output: { text: "normalized" },
        status: "succeeded",
      }),
    ]);
  });

  it("does not let a hook allow override a hard permission denial", async () => {
    const { dataDir, projectId, executionId } = await fixture();
    await expect(executeAgentToolPipeline({
      projectId,
      executionId,
      name: "write_file",
      arguments: { relativePath: "file.txt", content: "value" },
      preHooks: [() => ({ permission: "allow" })],
      authorize: () => "deny",
      execute: async () => ({ ok: true }),
    }, dataDir)).rejects.toMatchObject<Partial<AgentToolPipelineError>>({ code: "permission_denied" });
    expect((await getAgentExecution(projectId, executionId, dataDir))?.toolCalls).toEqual([]);
  });

  it("runs failure hooks and persists the original execution failure exactly once", async () => {
    const { dataDir, projectId, executionId } = await fixture();
    const failures: string[] = [];
    await expect(executeAgentToolPipeline({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "missing.txt" },
      execute: async () => {
        throw new Error("missing file");
      },
      postFailureHooks: [({ error }) => {
        failures.push(error instanceof Error ? error.message : "unknown");
        return { additionalContext: "failure observed" };
      }],
    }, dataDir)).rejects.toThrow("missing file");
    expect(failures).toEqual(["missing file"]);
    expect((await getAgentExecution(projectId, executionId, dataDir))?.toolCalls).toEqual([
      expect.objectContaining({ status: "failed", error: "missing file" }),
    ]);
  });

  it("lets a PermissionRequest hook resolve an approval request before execution", async () => {
    const { dataDir, projectId, executionId } = await fixture();
    const order: string[] = [];
    const result = await executeAgentToolPipeline({
      projectId,
      executionId,
      name: "shell_command",
      arguments: { command: "npm test" },
      authorize: () => {
        order.push("authorize:ask");
        return "ask";
      },
      permissionRequestHooks: [({ arguments: argumentsValue }) => {
        order.push(`permission-request:${argumentsValue.command}`);
        return { permission: "allow", additionalContext: "approved by hook" };
      }],
      onPermissionRequestResolved: (decision) => order.push(`resolved:${decision}`),
      execute: async () => {
        order.push("execute");
        return { ok: true };
      },
    }, dataDir);

    expect(order).toEqual(["authorize:ask", "permission-request:npm test", "resolved:allow", "execute"]);
    expect(result.additionalContext).toEqual(["approved by hook"]);
  });

  it("notifies PermissionDenied hooks without letting them override a denial", async () => {
    const { dataDir, projectId, executionId } = await fixture();
    const denials: string[] = [];
    await expect(executeAgentToolPipeline({
      projectId,
      executionId,
      name: "write_file",
      arguments: { relativePath: "file.txt", content: "value" },
      authorize: () => ({ decision: "deny", reason: "policy denied" }),
      permissionDeniedHooks: [({ reason }) => {
        denials.push(reason);
        return { additionalContext: "denial observed" };
      }],
      execute: async () => ({ ok: true }),
    }, dataDir)).rejects.toMatchObject<Partial<AgentToolPipelineError>>({
      code: "permission_denied",
      message: "policy denied",
      detail: { additionalContext: ["denial observed"] },
    });
    expect(denials).toEqual(["policy denied"]);
  });
});

async function fixture() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-tool-pipeline-"));
  temporaryDirectories.push(dataDir);
  const projectId = (await createLocalProject({
    name: "Tool Pipeline",
    prompt: "",
    model: "",
  }, dataDir)).id;
  const execution = await createAgentExecution({
    projectId,
    instruction: "test tool pipeline",
    resultNodeId: "result-node",
    triggerNodeId: "trigger-node",
    allowWithoutWorkspace: true,
  }, dataDir);
  return { dataDir, projectId, executionId: execution.detail.id };
}
