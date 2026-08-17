import { describe, expect, it } from "vitest";

import {
  AGENT_TOOL_NAMES,
  createNativeAgentTools,
  DEFERRED_MODEL_AGENT_TOOL_NAMES,
  formatAgentToolProtocol,
  getAgentToolDefinition,
  parseAgentToolCall,
  searchAgentToolDefinitions,
} from "@/lib/agent/tool-registry";

describe("agent tool registry", () => {
  it("keeps model tools and their permission metadata in one registry", () => {
    expect(AGENT_TOOL_NAMES).toContain("web_fetch");
    expect(AGENT_TOOL_NAMES).toEqual(expect.not.arrayContaining([
      "open_preview", "restart_service", "start_dev_server", "scan_ports",
    ]));
    expect(AGENT_TOOL_NAMES).toContain("task_list");
    expect(AGENT_TOOL_NAMES).toContain("ask_user_question");
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining(["enter_plan_mode", "exit_plan_mode"]));
    expect(AGENT_TOOL_NAMES).toContain("workspace_status");
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining([
      "glob_files", "code_diagnostics", "write_file", "edit_file", "apply_patch", "notebook_edit", "shell_command", "todo_write", "skill", "tool_search",
      "delegate_tasks",
      "team_create", "agent_spawn", "send_message", "team_delete",
      "task_create", "task_get", "task_list", "task_update",
    ]));
    expect(getAgentToolDefinition("workspace_status")).toMatchObject({ permission: "read", requiresWorkspace: true });
    expect(getAgentToolDefinition("read_file")).toMatchObject({ concurrencySafe: true, interruptBehavior: "cancel" });
    expect(getAgentToolDefinition("write_file")).toMatchObject({ concurrencySafe: false, interruptBehavior: "block" });
    expect(getAgentToolDefinition("web_fetch")).toMatchObject({ concurrencySafe: false });
    expect(getAgentToolDefinition("propose_patch")).toMatchObject({ permission: "write", requiresWorkspace: true });
    expect(getAgentToolDefinition("apply_patch")).toMatchObject({ permission: "write", requiresWorkspace: true });
    expect(getAgentToolDefinition("ask_user_question")).toMatchObject({ permission: "interact", requiresWorkspace: false });
    for (const removedTool of ["open_preview", "restart_service", "start_dev_server", "scan_ports"] as const) {
      expect(getAgentToolDefinition(removedTool)).toBeUndefined();
      expect(createNativeAgentTools().some((tool) => tool.name === removedTool)).toBe(false);
    }
    expect(getAgentToolDefinition("task_list")).toMatchObject({ permission: "read" });
    expect(getAgentToolDefinition("task_list")?.internal).not.toBe(true);
    expect(createNativeAgentTools().some((tool) => tool.name === "task_list")).toBe(true);
    expect(getAgentToolDefinition("todo_write")?.internal).toBe(true);
    expect(createNativeAgentTools().some((tool) => tool.name === "todo_write")).toBe(false);
    expect(createNativeAgentTools().some((tool) => tool.name === "project_task_list")).toBe(false);
    expect(parseAgentToolCall("task_list", {})).toMatchObject({ name: "task_list", arguments: {} });
    expect(parseAgentToolCall("task_list", { status: "all" })).toBeNull();
    expect(getAgentToolDefinition("task_output")?.description).toContain("兼容 cc-haha");
    expect(getAgentToolDefinition("task_output")?.description).toContain("优先使用 shell_command 返回的 outputFilePath");
    expect(getAgentToolDefinition("task_output")?.description).toContain("不得调用本工具轮询");
    expect(getAgentToolDefinition("task_list")?.description).toContain("不查询或管理后台进程");
    expect(DEFERRED_MODEL_AGENT_TOOL_NAMES.size).toBeGreaterThan(0);
    expect(DEFERRED_MODEL_AGENT_TOOL_NAMES.has("browser")).toBe(true);
    expect(DEFERRED_MODEL_AGENT_TOOL_NAMES.has("task_output")).toBe(true);
    expect(DEFERRED_MODEL_AGENT_TOOL_NAMES.has("task_stop")).toBe(true);
    expect(DEFERRED_MODEL_AGENT_TOOL_NAMES.has("read_file")).toBe(false);
    expect(formatAgentToolProtocol()).toContain("web_fetch [read]");
    expect(formatAgentToolProtocol()).not.toContain("todo_write [write]");
    expect(formatAgentToolProtocol()).toContain("多个相互独立的读取工具");
    expect(formatAgentToolProtocol()).not.toContain("run_approved_command [execute]");
  });

  it("projects the same registry into provider-native function definitions", () => {
    const tools = createNativeAgentTools();
    expect(tools.find((tool) => tool.name === "open_preview")).toBeUndefined();
    expect(tools.find((tool) => tool.name === "task_list")?.parameters).toMatchObject({ additionalProperties: false });
    expect(tools.find((tool) => tool.name === "task_output")?.parameters).toMatchObject({
      required: ["task_id"],
      properties: {
        task_id: { type: "string" },
        block: { type: "boolean" },
        timeout: { type: "integer" },
      },
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "task_stop")?.parameters).toMatchObject({
      required: ["task_id"],
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "read_file")?.parameters).toMatchObject({
      required: ["relativePath"],
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "web_fetch")?.parameters).toMatchObject({
      required: ["url", "prompt"],
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "shell_command")?.parameters).toMatchObject({
      required: ["reason"],
      properties: {
        run_in_background: { type: "boolean" },
      },
      oneOf: expect.any(Array),
      additionalProperties: false,
    });
    expect((tools.find((tool) => tool.name === "shell_command")?.parameters as { properties?: Record<string, unknown> })
      .properties).not.toHaveProperty("background");
    expect(tools.find((tool) => tool.name === "delegate_tasks")?.parameters).toMatchObject({
      required: ["goal", "tasks"],
      properties: {
        tasks: {
          items: {
            required: ["title", "instruction"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "team_create")?.parameters).toMatchObject({
      required: ["teamName"],
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "agent_spawn")?.parameters).toMatchObject({
      required: ["name", "instruction"],
      additionalProperties: false,
    });
    expect(tools.find((tool) => tool.name === "send_message")?.parameters).toMatchObject({
      required: ["to", "message"],
      additionalProperties: false,
    });
    expect(tools.some((tool) => tool.name === "run_approved_command")).toBe(false);
    expect(createNativeAgentTools({ include: ["read_file"] }).map((tool) => tool.name)).toEqual(["read_file"]);
  });

  it("keeps every native tool example valid under the same runtime parser", () => {
    for (const tool of createNativeAgentTools()) {
      const definition = getAgentToolDefinition(tool.name);
      expect(definition, tool.name).toBeDefined();
      expect(parseAgentToolCall(tool.name, definition!.example), tool.name).not.toBeNull();
    }
  });

  it("classifies Shell concurrency from each call instead of its permission category", () => {
    const shell = getAgentToolDefinition("shell_command");
    expect(shell?.concurrencySafe).toBe(false);
    expect(shell?.isConcurrencySafe({ executable: "git", args: ["status", "--short"], reason: "检查状态" }))
      .toBe(true);
    expect(shell?.isConcurrencySafe({ executable: "git", args: ["checkout", "main"], reason: "切换分支" }))
      .toBe(false);
  });

  it("discovers callable tools by name or description", () => {
    expect(searchAgentToolDefinitions("Notebook", 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "notebook_edit", permission: "write" }),
    ]));
    expect(searchAgentToolDefinitions("运行命令", 5)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "shell_command", permission: "execute" }),
    ]));
  });

  it("does not disclose tools outside an execution allowlist", () => {
    const results = searchAgentToolDefinitions("file", 20, ["read_file", "tool_search"]);
    expect(results.map((item) => item.name)).toEqual(["read_file"]);
  });

  it("treats an explicit empty ToolSearch allowlist as no discoverable tools", () => {
    expect(searchAgentToolDefinitions("file", 20, [])).toEqual([]);
  });

  it("can hide provider-managed tools from the model protocol", () => {
    const protocol = formatAgentToolProtocol({ exclude: ["web_search", "web_fetch"] });

    expect(protocol).not.toContain("web_search [read]");
    expect(protocol).not.toContain("web_fetch [read]");
    expect(protocol).toContain("read_file [read]");
  });

  it("can project a Plan Mode-only protocol from the shared registry", () => {
    const protocol = formatAgentToolProtocol({ include: ["read_file", "exit_plan_mode"] });

    expect(protocol).toContain("read_file [read]");
    expect(protocol).toContain("exit_plan_mode [interact]");
    expect(protocol).not.toContain("write_file [write]");
    expect(protocol).not.toContain("enter_plan_mode [interact]");
  });

  it("rejects malformed and internal model tool calls", () => {
    expect(parseAgentToolCall("read_file", { relativePath: "README.md" })).toMatchObject({ name: "read_file" });
    expect(parseAgentToolCall("read_file", {})).toBeNull();
    expect(parseAgentToolCall("read_file", { relativePath: "README.md", invented: true })).toBeNull();
    expect(parseAgentToolCall("apply_patch", { patch: "*** Begin Patch\n*** End Patch" })).toMatchObject({ name: "apply_patch" });
    expect(parseAgentToolCall("web_fetch", { url: "https://example.com" })).toBeNull();
    expect(parseAgentToolCall("web_fetch", { url: "https://example.com", prompt: "提取相关事实" })).toMatchObject({ name: "web_fetch" });
    expect(parseAgentToolCall("run_approved_command", { commandRequestId: "id" })).toBeNull();
    expect(parseAgentToolCall("ask_user_question", {
      question: "选择哪一个？",
      options: [{ label: "A" }, { label: "B", description: "说明" }],
    })).toMatchObject({ name: "ask_user_question" });
    expect(parseAgentToolCall("ask_user_question", {
      questions: [
        { question: "选择方向？", header: "方向", options: [{ label: "A", description: "方案 A" }, { label: "B", description: "方案 B" }] },
        { question: "启用哪些能力？", header: "能力", multiSelect: true, options: [{ label: "测试" }, { label: "文档" }] },
      ],
    })).toMatchObject({ name: "ask_user_question" });
    expect(parseAgentToolCall("ask_user_question", { questions: [] })).toBeNull();
    expect(parseAgentToolCall("ask_user_question", {
      questions: [{ question: "重复选项？", header: "无效", options: [{ label: "A" }, { label: "A" }] }],
    })).toBeNull();
    expect(parseAgentToolCall("open_preview", { taskId: "task-id" })).toBeNull();
    expect(parseAgentToolCall("open_preview", {})).toBeNull();
    expect(parseAgentToolCall("browser", { operation: "navigate", taskId: "task-id" })).toBeNull();
    expect(parseAgentToolCall("browser", { operation: "navigate", url: "http://127.0.0.1:5173/" })).toMatchObject({ name: "browser" });
    expect(parseAgentToolCall("task_output", { task_id: "task-id", block: true, timeout: 30_000 }))
      .toMatchObject({ name: "task_output" });
    expect(parseAgentToolCall("task_output", { taskId: "task-id", wait: true })).toBeNull();
    expect(parseAgentToolCall("task_stop", { task_id: "task-id" })).toMatchObject({ name: "task_stop" });
    expect(parseAgentToolCall("shell_command", {
      command: "$env:ZENME_VALUE = 'ok'; Write-Output $env:ZENME_VALUE",
      reason: "验证完整 PowerShell 命令协议",
    })).toMatchObject({ name: "shell_command" });
    expect(parseAgentToolCall("shell_command", {
      executable: "node",
      args: ["--version"],
      reason: "兼容旧命令协议",
    })).toMatchObject({ name: "shell_command" });
    expect(parseAgentToolCall("shell_command", {
      command: "pnpm run dev",
      reason: "启动开发服务",
      run_in_background: true,
    })).toMatchObject({ name: "shell_command", arguments: { run_in_background: true } });
    expect(parseAgentToolCall("shell_command", {
      command: "pnpm run dev",
      reason: "不再向模型暴露旧后台字段",
      background: true,
    })).toBeNull();
    expect(parseAgentToolCall("shell_command", { reason: "缺少命令" })).toBeNull();
    expect(parseAgentToolCall("shell_command", {
      command: "Write-Output ok",
      executable: "powershell",
      args: [],
      reason: "不能混用两种协议",
    })).toBeNull();
    expect(parseAgentToolCall("skill", { skill: "release-check", args: "windows" })).toMatchObject({ name: "skill" });
    expect(parseAgentToolCall("delegate_tasks", {
      goal: "并行检查",
      tasks: [{ title: "A", instruction: "检查 A", allowedPathPrefixes: ["src/a"], allowedTools: ["read_file"] }],
    })).toMatchObject({ name: "delegate_tasks" });
    expect(parseAgentToolCall("team_create", { teamName: "reviewers", maxMembers: 3 }))
      .toMatchObject({ name: "team_create" });
    expect(parseAgentToolCall("agent_spawn", { name: "tester", instruction: "运行回归测试" }))
      .toMatchObject({ name: "agent_spawn" });
    expect(parseAgentToolCall("agent_spawn", { name: "planner", instruction: "先提交计划", mode: "plan" }))
      .toMatchObject({ name: "agent_spawn", arguments: { mode: "plan" } });
    expect(parseAgentToolCall("agent_spawn", { name: "planner", instruction: "无效模式", mode: "bypassPermissions" }))
      .toBeNull();
    expect(parseAgentToolCall("send_message", { to: "tester", message: "优先检查 Windows" }))
      .toMatchObject({ name: "send_message" });
    expect(parseAgentToolCall("send_message", {
      to: "planner",
      message: { type: "plan_approval_response", request_id: "request-1", approve: true },
    })).toMatchObject({ name: "send_message" });
    expect(parseAgentToolCall("send_message", {
      to: "planner",
      message: { type: "plan_approval_response", request_id: "request-1", approve: false },
    })).toBeNull();
    expect(parseAgentToolCall("team_delete", {})).toMatchObject({ name: "team_delete" });
  });
});
