import { afterEach, describe, expect, it, vi } from "vitest";

import { createProjectAgentToolHooks, runProjectAgentLifecycleHooks } from "@/lib/agent/project-agent-hook-runtime";

const commandRuntime = vi.hoisted(() => ({
  approve: vi.fn(async () => undefined),
  propose: vi.fn(async () => ({ id: "hook-command", sandboxMode: "workspace-write" })),
  run: vi.fn(async () => ({ status: "completed", exitCode: 2, stdout: "", stderr: "blocked by hook" })),
}));

const hookAgentRuntime = vi.hoisted(() => ({
  complete: vi.fn(async () => undefined),
  create: vi.fn(async () => ({ detail: { id: "hook-child" } })),
  executeTool: vi.fn(async () => ({ content: "real file contents" })),
  get: vi.fn(async () => ({
    id: "execution",
    resultNodeId: "result-node",
    triggerNodeId: "trigger-node",
    context: {
      allowedTools: ["read_file", "agent_spawn"],
      selectedNodeIds: [],
      fileDocumentIds: [],
      canvasContext: "",
      workspaceRootId: "root",
      allowedPathPrefixes: ["src"],
    },
  })),
}));

vi.mock("@/lib/agent/command-runtime", () => ({
  approveAgentCommand: commandRuntime.approve,
  proposeAgentCommand: commandRuntime.propose,
  runApprovedAgentCommand: commandRuntime.run,
}));

vi.mock("@/lib/agent/execution-store", () => ({
  completeAgentExecution: hookAgentRuntime.complete,
  createAgentExecution: hookAgentRuntime.create,
  getAgentExecution: hookAgentRuntime.get,
}));

vi.mock("@/lib/agent/workspace-tools", () => ({
  executeAgentWorkspaceTool: hookAgentRuntime.executeTool,
}));

describe("project agent hook runtime", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies cc-haha PreToolUse HTTP decisions and updated input", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Confirm release command",
        updatedInput: { command: "npm run release -- --dry-run" },
        additionalContext: "Release command normalized by hook.",
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const lifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "shell_command",
      hooks: {
        PreToolUse: [{
          matcher: "^Bash$",
          hooks: [{ type: "http", url: "https://hooks.example.test/pre", if: "Bash(npm run release *)" }],
        }],
      },
      rootId: "root",
      model: "model",
      dataDir: "data",
    });

    await expect(lifecycle.preHooks[0]({ arguments: { command: "npm run release now" } })).resolves.toEqual({
      permission: "ask",
      reason: "Confirm release command",
      arguments: { command: "npm run release -- --dry-run" },
      additionalContext: "Release command normalized by hook.",
      preventContinuation: false,
      output: undefined,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("runs every matching hook and reports a successful once hook after execution", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(null, { status: 204 });
    }));
    const onHookSuccess = vi.fn();
    const persistent = { type: "http" as const, url: "https://hooks.example.test/persistent" };
    const once = { type: "http" as const, url: "https://hooks.example.test/once", once: true };
    const lifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "glob_files",
      hooks: { PreToolUse: [{ matcher: "Glob", hooks: [persistent, once] }] },
      model: "model",
      dataDir: "data",
      onHookSuccess,
    });

    await lifecycle.preHooks[0]({ arguments: { pattern: "**/*.ts" } });

    expect(calls).toEqual([
      "https://hooks.example.test/persistent",
      "https://hooks.example.test/once",
    ]);
    expect(onHookSuccess).toHaveBeenCalledOnce();
    expect(onHookSuccess).toHaveBeenCalledWith("PreToolUse", once, expect.objectContaining({ matcher: "Glob" }));
  });

  it("runs prompt hooks as blocking verifiers", async () => {
    const callModel = vi.fn(async () => ({
      text: JSON.stringify({ ok: false, reason: "Tests are missing" }),
      usage: null,
    }));
    const lifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "write_file",
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "prompt", prompt: "Check the proposed write." }] }],
      },
      model: "parent:model",
      callModel,
      dataDir: "data",
    });

    await expect(lifecycle.preHooks[0]({ arguments: { relativePath: "src/a.ts", content: "x" } })).resolves.toMatchObject({
      permission: "deny",
      reason: "Tests are missing",
    });
    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({ model: "parent:model", mode: "agent_planning" }));
  });

  it("runs agent hooks as bounded multi-turn tool-using verifiers", async () => {
    hookAgentRuntime.complete.mockClear();
    hookAgentRuntime.create.mockClear();
    hookAgentRuntime.executeTool.mockClear();
    hookAgentRuntime.get.mockClear();
    let calls = 0;
    const callModel = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? { text: "", toolCall: { name: "read_file", arguments: { relativePath: "src/a.ts" } }, usage: null }
        : { text: "", toolCall: { name: "hook_result", arguments: { ok: false, reason: "Verification failed" } }, usage: null };
    });
    const lifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "write_file",
      hooks: {
        PreToolUse: [{ matcher: "Write", hooks: [{ type: "agent", prompt: "Inspect $ARGUMENTS before allowing the write." }] }],
      },
      model: "parent:model",
      callModel,
      rootId: "root",
      dataDir: "data",
    });

    await expect(lifecycle.preHooks[0]({ arguments: { relativePath: "src/a.ts", content: "new" } })).resolves.toMatchObject({
      permission: "deny",
      reason: "Verification failed",
    });
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls[0]?.[0]).toMatchObject({
      allowedAgentTools: ["read_file"],
      additionalAgentTools: [expect.objectContaining({ name: "hook_result" })],
    });
    expect(hookAgentRuntime.executeTool).toHaveBeenCalledWith(expect.objectContaining({
      executionId: "hook-child",
      name: "read_file",
      arguments: { relativePath: "src/a.ts" },
    }), "data");
    expect(hookAgentRuntime.create).toHaveBeenCalledWith(expect.objectContaining({
      agentId: expect.stringMatching(/^hook-agent:PreToolUse:/),
      allowedTools: ["read_file"],
      permissionMode: "neverAsk",
    }), "data");
    expect(hookAgentRuntime.complete).toHaveBeenCalledWith(expect.objectContaining({
      executionId: "hook-child",
      status: "succeeded",
    }), "data");
  });

  it("keeps sensitive plugin options out of prompt hooks but exposes them to command hooks", async () => {
    commandRuntime.propose.mockClear();
    commandRuntime.run.mockClear();
    commandRuntime.run.mockResolvedValueOnce({ status: "completed", exitCode: 0, stdout: "{}", stderr: "" });
    const pluginOptions = {
      missing: [],
      schema: { TOKEN: { type: "string" as const, sensitive: true } },
      values: { TOKEN: "hook-secret" },
    };
    const commandLifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "read_file",
      hooks: { PreToolUse: [{ matcher: "Read", pluginRoot: "C:/plugin", pluginId: "guard@example", pluginOptions, hooks: [{ type: "command", command: "check --token ${user_config.TOKEN}" }] }] },
      model: "model",
      dataDir: "data",
    });

    await commandLifecycle.preHooks[0]({ arguments: { relativePath: "README.md" } });

    expect(commandRuntime.propose).toHaveBeenCalledWith(expect.objectContaining({ command: "check --token hook-secret" }), "data");
    expect(commandRuntime.run).toHaveBeenCalledWith(expect.objectContaining({
      environment: expect.objectContaining({ CLAUDE_PLUGIN_OPTION_TOKEN: "hook-secret" }),
    }), "data");

    const callModel = vi.fn(async () => ({ text: "{}", usage: null }));
    const promptLifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "read_file",
      hooks: { PreToolUse: [{ matcher: "Read", pluginOptions, hooks: [{ type: "prompt", prompt: "Token=${user_config.TOKEN}" }] }] },
      model: "model",
      callModel,
      dataDir: "data",
    });
    await promptLifecycle.preHooks[0]({ arguments: { relativePath: "README.md" } });
    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("[sensitive option 'TOKEN' not available in skill content]"),
    }));
    expect(JSON.stringify(callModel.mock.calls)).not.toContain("hook-secret");
  });

  it("rewakes only when an asyncRewake command returns a blocking result", async () => {
    const rewake = vi.fn();
    const lifecycle = createProjectAgentToolHooks({
      projectId: "project",
      executionId: "execution",
      name: "read_file",
      hooks: {
        PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "check-read", asyncRewake: true }] }],
      },
      model: "model",
      onAsyncRewake: rewake,
      dataDir: "data",
    });

    await expect(lifecycle.preHooks[0]({ arguments: { relativePath: "README.md" } })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(rewake).toHaveBeenCalledWith(expect.objectContaining({
      permission: "deny",
      reason: "blocked by hook",
    })));

    commandRuntime.run.mockResolvedValueOnce({
      status: "completed",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });
    rewake.mockClear();
    await lifecycle.preHooks[0]({ arguments: { relativePath: "README.md" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rewake).not.toHaveBeenCalled();
  });

  it("sends cc-haha lifecycle fields at the top level instead of faking a tool call", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await runProjectAgentLifecycleHooks({
      projectId: "project",
      executionId: "execution",
      event: "TeammateIdle",
      hooks: {
        TeammateIdle: [{ hooks: [{ type: "http", url: "https://hooks.example.test/idle" }] }],
      },
      model: "model",
      dataDir: "data",
      payload: { teammate_name: "reviewer", team_name: "review-team" },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      hook_event_name: "TeammateIdle",
      session_id: "execution",
      teammate_name: "reviewer",
      team_name: "review-team",
    });
  });

  it("accepts cc-haha Elicitation hook responses and preserves the exact lifecycle payload", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "Elicitation",
        action: "accept",
        content: { format: "svg", optimized: true },
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProjectAgentLifecycleHooks({
      projectId: "project",
      executionId: "execution",
      event: "Elicitation",
      hooks: {
        Elicitation: [{ matcher: "Design Server", hooks: [{ type: "http", url: "https://hooks.example.test/elicit" }] }],
      },
      model: "model",
      dataDir: "data",
      matchQuery: "Design Server",
      payload: {
        mcp_server_name: "Design Server",
        message: "请选择导出格式",
        mode: "form",
        requested_schema: { type: "object" },
      },
    });

    expect(result?.elicitation).toEqual({ action: "accept", content: { format: "svg", optimized: true } });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      hook_event_name: "Elicitation",
      session_id: "execution",
      mcp_server_name: "Design Server",
      message: "请选择导出格式",
      mode: "form",
      requested_schema: { type: "object" },
    });
  });
});
