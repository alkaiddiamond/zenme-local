import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { getProviderModelSelections } from "@/lib/ai/provider-model-resolution";
import { ProjectAgentModelStreamError } from "@/lib/agent/project-agent-model";
import { resetProjectConfigChangeRuntimeForTests } from "@/lib/agent/project-config-change-runtime";
import { createChatGptProvider, createZhipuProvider } from "@/lib/ai/provider-presets";
import {
  appendProjectAgentEvent,
  getProjectAgentSession,
  updateProjectAgentContext,
} from "@/lib/agent/project-session-store";
import {
  answerProjectAgentTurnRun,
  parseProjectTurnDecision,
  ProjectAgentTurnError,
  runProjectAgentTurn,
  startProjectAgentTurnRun,
  stopProjectAgentTurnRun,
  steerProjectAgentTurnRun,
  projectTurnDecisionFromNativeToolCall,
  reconcileProjectAgentBackgroundNotifications,
  restoreActiveBuiltInToolNames,
  restoreActiveMcpToolNames,
} from "@/lib/agent/project-turn-runtime";
import { createLocalProject } from "@/lib/local/project-repository";
import { getProjectDir } from "@/lib/local/data-dir";
import { getLocalSettings, updateLocalSettings } from "@/lib/local/settings";
import { addLocalWorkspaceRoot, bindLocalWorkspace, setLocalWorkspacePermissions } from "@/lib/local/workspace-repository";
import { approveAgentCommand, getAgentBackgroundTask, proposeAgentCommand, rejectAgentCommand, runApprovedAgentCommand, stopAgentBackgroundTask } from "@/lib/agent/command-runtime";
import { addAgentCommandRequest, completeAgentExecution, createAgentExecution, getAgentExecution, listAgentExecutions, updateAgentCommandRequest } from "@/lib/agent/execution-store";
import {
  addGlobalTeamMember,
  createGlobalTeam,
  dispatchGlobalSubtasks,
  getGlobalOrchestration,
  listGlobalOrchestrations,
} from "@/lib/global-agent/orchestration-store";
import {
  appendContinuousProjectEvent,
  claimContinuousAgentRun,
  completeContinuousAgentRun,
  configureContinuousGlobalAgent,
  updateContinuousAgentSuggestion,
} from "@/lib/global-agent/continuous-store";
import { rebuildProjectKnowledgeIndex } from "@/lib/knowledge/index-store";

let dataDir: string;
let workspaceRoot: string;
let projectId: string;
let model: string;

function isOneOffSubagentContext(context: string) {
  return context.includes("一次性 Sub-agent");
}

function isDelegatedSubagentContext(context: string) {
  return isOneOffSubagentContext(context) || context.includes("Team 中的长期成员");
}

function modelInputText(input: {
  context: string;
  messages?: Array<{
    content: string;
    toolCalls?: Array<{ name: string; arguments: unknown }>;
  }>;
}) {
  return [
    input.context,
    ...(input.messages ?? []).flatMap((message) => [
      message.content,
      ...(message.toolCalls ?? []).map((toolCall) => JSON.stringify(toolCall)),
    ]),
  ].join("\n");
}

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-turn-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-turn-workspace-"));
  projectId = (await createLocalProject({ name: "Project turn", prompt: "", model: "" }, dataDir)).id;
  await updateLocalSettings({ modelProviders: [createZhipuProvider("test-key")] }, dataDir);
  const settings = await getLocalSettings(dataDir);
  model = getProviderModelSelections(settings.modelProviders, "text")[0]!.id;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await resetProjectConfigChangeRuntimeForTests();
  await fs.rm(dataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
});

describe("project agent turn runtime", { timeout: 15_000 }, () => {
  it("keeps unrelated project conversations out of the current node turn while preserving connected graph background", async () => {
    await appendProjectAgentEvent({
      projectId,
      turnId: "old-mcp-turn",
      conversationId: "old-conversation",
      sourceNodeId: "old-node",
      type: "user",
      content: "OLD_SESSION_TRANSCRIPT_ONLY user asked about MCP configuration",
    }, dataDir);
    await appendProjectAgentEvent({
      projectId,
      turnId: "old-mcp-turn",
      type: "assistant",
      content: "OLD_SESSION_TRANSCRIPT_ONLY assistant continued MCP configuration",
    }, dataDir);

    const callModel = vi.fn(async (request: Parameters<typeof modelInputText>[0] & { prompt: string }) => {
      const transcriptText = (request.messages ?? []).map((message) => message.content).join("\n");
      expect(transcriptText).not.toContain("OLD_SESSION_TRANSCRIPT_ONLY");
      expect(request.context).toContain("当前节点（本轮主要语义焦点）");
      expect(request.context).toContain("ChatGPT 网页版是不是不计算用量");
      expect(request.context).toContain("显式连线的上游画布上下文");
      expect(request.context).toContain("CONNECTED_GRAPH_MCP_BACKGROUND");
      expect(request.context.indexOf("当前节点（本轮主要语义焦点）"))
        .toBeLessThan(request.context.indexOf("显式连线的上游画布上下文"));
      expect(request.prompt).toContain("直接处理当前节点表达的请求");
      return { text: "当前节点已优先回答", usage: null };
    });

    const result = await runProjectAgentTurn({
      projectId,
      conversationId: "current-conversation",
      sourceNodeId: "current-node",
      resultNodeId: "current-result",
      prompt: "请直接处理当前节点表达的请求；如果当前节点包含问题，优先回答该问题。",
      currentNodeContext: "文本节点「当前问题」\nChatGPT 网页版是不是不计算用量？",
      connectedGraphContext: "CONNECTED_GRAPH_MCP_BACKGROUND：上游节点此前讨论过 MCP 配置。",
      model,
      turnId: "current-turn",
    }, { dataDir, callModel: callModel as never });

    expect(result).toMatchObject({ status: "completed", answer: "当前节点已优先回答" });
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it("uses the structured context snapshot as the canonical turn context while preserving legacy fallback fields", async () => {
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "LEGACY_PROMPT",
      currentNodeContext: "LEGACY_NODE",
      connectedGraphContext: "LEGACY_GRAPH",
      conversationId: "legacy-conversation",
      model,
      turnId: "structured-context-turn",
      contextSnapshot: {
        version: 1,
        instruction: { prompt: "STRUCTURED_PROMPT" },
        currentNode: { content: "STRUCTURED_NODE" },
        graph: { connectedContext: "STRUCTURED_GRAPH" },
        conversation: { conversationId: "structured-conversation" },
        references: { selectedNodeIds: ["structured-node-id"], fileDocumentIds: ["structured-file-id"] },
      },
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.prompt).toContain("STRUCTURED_PROMPT");
        expect(input.prompt).not.toContain("LEGACY_PROMPT");
        expect(input.context).toContain("STRUCTURED_NODE");
        expect(input.context).toContain("STRUCTURED_GRAPH");
        expect(input.context).not.toContain("LEGACY_NODE");
        expect(input.context).not.toContain("LEGACY_GRAPH");
        return { text: "structured context applied", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "structured context applied" });
    const userEvent = (await getProjectAgentSession(projectId, dataDir)).events.find((event) =>
      event.turnId === "structured-context-turn" && event.type === "user");
    expect(userEvent).toMatchObject({
      conversationId: "structured-conversation",
      content: "STRUCTURED_PROMPT",
      data: {
        contextSnapshot: {
          version: 1,
          instruction: { prompt: "STRUCTURED_PROMPT" },
          currentNode: { content: "STRUCTURED_NODE" },
          graph: { connectedContext: "STRUCTURED_GRAPH" },
          conversation: { conversationId: "structured-conversation" },
          references: { selectedNodeIds: ["structured-node-id"], fileDocumentIds: ["structured-file-id"] },
        },
      },
    });
    expect(userEvent?.data).not.toHaveProperty("selectedNodeIds");
    expect(userEvent?.data).not.toHaveProperty("fileDocumentIds");
    expect(userEvent?.data).not.toHaveProperty("canvasContext");
    expect(userEvent?.data).not.toHaveProperty("currentNodeContext");
    expect(userEvent?.data).not.toHaveProperty("connectedGraphContext");
  });

  it("does not expose blanket-denied tools to the model while retaining content-scoped rules", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: { deny: ["Read", "WebFetch", "Bash(pnpm test)"] },
    }));

    await runProjectAgentTurn({ projectId, prompt: "检查项目", model }, {
      dataDir,
      callModel: async (input) => {
        expect(input.allowedAgentTools).not.toContain("read_file");
        expect(input.allowedAgentTools).not.toContain("web_fetch");
        expect(input.allowedAgentTools).toContain("shell_command");
        return { text: "权限工具池已检查。", usage: null };
      },
    });
  });

  it("persists user-facing text emitted with a tool call as an Agent checkpoint", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "检查项目后给出结论", model }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "我先检查 Workspace 的真实状态。",
            toolCall: { name: "workspace_status", arguments: {} },
            usage: null,
          };
        }
        expect(modelInputText(input)).toContain("我先检查 Workspace 的真实状态。");
        return { text: "Workspace 已检查完成。", usage: null };
      },
      executeTool: async () => ({ available: true }) as never,
    });

    expect(result).toMatchObject({ status: "completed", answer: "Workspace 已检查完成。" });
    const assistants = (await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.type === "assistant");
    expect(assistants).toEqual([
      expect.objectContaining({ content: "我先检查 Workspace 的真实状态。", data: { checkpoint: true } }),
      expect.objectContaining({ content: "Workspace 已检查完成。" }),
    ]);
  });

  it("injects accepted Continuous Agent suggestions but keeps candidates out of the model context", async () => {
    await configureContinuousGlobalAgent({ projectId, mode: "enabled" }, dataDir);
    const event = await appendContinuousProjectEvent({
      projectId, type: "task.changed", source: "task", sourceId: "task-1", idempotencyKey: "task-1:changed",
    }, dataDir);
    const claimed = await claimContinuousAgentRun(projectId, dataDir);
    const state = await completeContinuousAgentRun({
      projectId,
      runId: claimed!.run.id,
      suggestions: [
        {
          kind: "nextTask", title: "验证采纳建议", summary: "运行相关回归测试", rationale: ["任务发生变化"],
          sourceEventIds: [event.id], idempotencyKey: "accepted-next-task",
        },
        {
          kind: "knowledgeReview", title: "未采纳建议", summary: "不应进入上下文", rationale: ["任务发生变化"],
          sourceEventIds: [event.id], idempotencyKey: "candidate-only",
        },
      ],
    }, dataDir);
    await updateContinuousAgentSuggestion({
      projectId,
      suggestionId: state.suggestions.find((item) => item.idempotencyKey === "accepted-next-task")!.id,
      status: "accepted",
    }, dataDir);

    await runProjectAgentTurn({ projectId, prompt: "继续当前项目", model }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("已由用户采纳的 Continuous Global Agent 建议");
        expect(input.context).toContain("验证采纳建议");
        expect(input.context).not.toContain("未采纳建议");
        expect(input.context).toContain("不代表已经执行");
        return { text: "已纳入后续工作。", usage: null };
      },
    });
  });

  it("provides every Workspace root identity to the model before tool selection", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-turn-additional-"));
    try {
      await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;
      await runProjectAgentTurn({ projectId, prompt: "检查两个根目录", model }, {
        dataDir,
        callModel: async (input) => {
          expect(input.context).toContain("当前项目 Workspace 根目录");
          expect(input.context).toContain(binding.id);
          expect(input.context).toContain(rootId);
          expect(input.context).toContain("glob_files/search_files 默认跨全部可读根");
          return { text: "已识别两个根目录。", usage: null };
        },
      });
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 30_000);

  it("automatically recalls bounded Project Knowledge before the model chooses tools", async () => {
    await fs.writeFile(path.join(workspaceRoot, "architecture.md"), [
      "# Quartz relay architecture",
      "The quartz relay owns durable event delivery and retries failed envelopes.",
      "x".repeat(5_000),
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await rebuildProjectKnowledgeIndex({ projectId }, dataDir);

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "quartz relay 如何处理失败消息？",
      model,
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("自动召回的相关 Project Knowledge");
        expect(input.context).toContain("durable event delivery");
        expect(input.context).toContain("architecture.md");
        expect(input.context).not.toContain("x".repeat(3_000));
        return { text: "Quartz relay 会重试失败的消息。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "Quartz relay 会重试失败的消息。" });
    expect((await getProjectAgentSession(projectId, dataDir)).events.some((event) => event.data?.name === "search_knowledge"))
      .toBe(false);
  }, 15_000);

  it("feeds observed Workspace images to the next model turn without persisting base64", async () => {
    await sharp({ create: { width: 640, height: 360, channels: 3, background: "#22c55e" } })
      .png().toFile(path.join(workspaceRoot, "ui.png"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "分析项目中的界面图片", model }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.imageDataUrls ?? []).toEqual([]);
          return { text: "", toolCall: { name: "view_image", arguments: { relativePath: "ui.png" } }, usage: null };
        }
        expect(input.imageDataUrls).toHaveLength(1);
        expect(input.imageDataUrls?.[0]).toMatch(/^data:image\/webp;base64,/);
        expect(modelInputText(input)).toContain("ui.png");
        expect(modelInputText(input)).not.toContain("data:image/webp;base64");
        return { text: "已完成界面图片分析。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "已完成界面图片分析。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    const output = session.events.find((event) => event.type === "toolResult" && event.data?.name === "view_image")?.data?.output;
    expect(output).toMatchObject({ relativePath: "ui.png", width: 640, height: 360 });
    expect(output).not.toHaveProperty("dataUrl");
  }, 15_000);

  it("feeds a browser screenshot to the next reasoning step without persisting base64", async () => {
    const screenshotDataUrl = `data:image/png;base64,${Buffer.from("browser-preview").toString("base64")}`;
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "验证本地页面", model }, {
      dataDir,
      executeTool: async (input) => {
        expect(input).toMatchObject({
          name: "browser",
          arguments: { operation: "navigate", url: "http://127.0.0.1:5173/", includeScreenshot: true },
        });
        return {
          url: "http://127.0.0.1:5173/",
          title: "Local preview",
          text: "Save",
          elements: [{ ref: "e1", tag: "button", name: "Save", bounds: { x: 1, y: 2, width: 3, height: 4 } }],
          screenshot: { dataUrl: screenshotDataUrl, mimeType: "image/png", width: 1280, height: 800 },
        } as never;
      },
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.imageDataUrls ?? []).toEqual([]);
          return {
            text: "",
            toolCall: { name: "browser", arguments: { operation: "navigate", url: "http://127.0.0.1:5173/", includeScreenshot: true } },
            usage: null,
          };
        }
        expect(input.imageDataUrls).toEqual([screenshotDataUrl]);
        expect(modelInputText(input)).toContain("Local preview");
        expect(modelInputText(input)).not.toContain("data:image/png;base64");
        return { text: "页面验证完成。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "页面验证完成。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    const output = session.events.find((event) => event.type === "toolResult" && event.data?.name === "browser")?.data?.output;
    expect(output).toMatchObject({ title: "Local preview", screenshot: { mimeType: "image/png", width: 1280, height: 800 } });
    expect(JSON.stringify(output)).not.toContain("base64");
  });

  it("asks once before browser interaction in untrusted mode and resumes the exact action", async () => {
    const turnId = "browser-untrusted-approval";
    const executed: string[] = [];
    let modelCalls = 0;
    const options = {
      dataDir,
      executeTool: async (input: { name: string }) => {
        executed.push(input.name);
        if (input.name === "ask_user_question") {
          return {
            question: "允许 Agent 在隔离的本地预览中点击元素 e1吗？",
            options: [{ label: "允许一次" }, { label: "拒绝" }],
            status: "waitingInput",
          } as never;
        }
        return { url: "http://127.0.0.1:5173/", title: "Preview", text: "Saved", elements: [] } as never;
      },
      callModel: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? { text: "", toolCall: { name: "browser", arguments: { operation: "click", ref: "e1" } }, usage: null }
          : { text: "已在用户批准后点击一次。", usage: null };
      },
    };

    const waiting = await runProjectAgentTurn({
      projectId,
      prompt: "点击保存按钮",
      model,
      permissionMode: "untrusted",
      turnId,
    }, options as never);
    expect(waiting).toMatchObject({ status: "waitingInput", question: expect.stringContaining("点击元素 e1") });
    expect(executed).toEqual(["ask_user_question"]);

    const session = await getProjectAgentSession(projectId, dataDir);
    const question = session.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.status === "waitingInput");
    const completed = await runProjectAgentTurn({
      projectId,
      prompt: "允许一次",
      model,
      permissionMode: "untrusted",
      turnId,
      resume: true,
      questionAnswer: { eventId: question!.id, value: "允许一次" },
    }, options as never);

    expect(completed).toMatchObject({ status: "completed", answer: "已在用户批准后点击一次。" });
    expect(executed).toEqual(["ask_user_question", "browser"]);
    expect(modelCalls).toBe(2);
  });

  it("asks once before launching a Workflow and resumes the exact approved action", async () => {
    const turnId = "workflow-launch-approval";
    const script = `export const meta = { name: "review", description: "Review the project", phases: [{ title: "Inspect" }] };\nreturn "done";`;
    const executed: string[] = [];
    let modelCalls = 0;
    const options = {
      dataDir,
      executeTool: async (input: Parameters<typeof import("@/lib/agent/workspace-tools")["executeAgentWorkspaceTool"]>[0]) => {
        executed.push(input.name);
        if (input.name === "tool_search") return { tools: [{ name: "workflow", description: "Run Workflow", parameters: {} }] } as never;
        if (input.name === "ask_user_question") return {
          question: "运行 Workflow“review”吗？",
          options: [{ label: "运行 Workflow" }, { label: "拒绝" }],
          status: "waitingInput",
        } as never;
        if (input.name === "workflow") {
          await input.onWorkflowProgress?.({ type: "workflow_phase", index: 0, title: "Inspect", kind: "meta" }, "wf_test");
          return {
            status: "async_launched", taskId: "workflow_test", taskType: "local_workflow",
            workflowName: "review", runId: "wf_test", summary: "Review the project", scriptPath: "workflow.js",
          } as never;
        }
        throw new Error(`unexpected tool: ${input.name}`);
      },
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) return { text: "", toolCall: { name: "tool_search", arguments: { query: "workflow" } }, usage: null };
        if (modelCalls === 2) return { text: "", toolCall: { name: "workflow", arguments: { script } }, usage: null };
        return { text: "Workflow 已启动。", usage: null };
      },
    };

    const waiting = await runProjectAgentTurn({ projectId, prompt: "运行审查 Workflow", model, turnId }, options as never);
    expect(waiting).toMatchObject({ status: "waitingInput", question: expect.stringContaining("review") });
    expect(executed).toEqual(["tool_search", "ask_user_question"]);
    const session = await getProjectAgentSession(projectId, dataDir);
    const question = session.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.status === "waitingInput");

    const completed = await runProjectAgentTurn({
      projectId, prompt: "运行 Workflow", model, turnId, resume: true,
      questionAnswer: { eventId: question!.id, value: "运行 Workflow" },
    }, options as never);

    expect(completed).toMatchObject({ status: "completed", answer: "Workflow 已启动。" });
    expect(executed).toEqual(["tool_search", "ask_user_question", "workflow"]);
    const completedSession = await getProjectAgentSession(projectId, dataDir);
    expect(completedSession.events.find((event) => event.data?.name === "workflow" && event.type === "toolCall")?.content)
      .toContain("Inspect");
  });

  it("persists planning and each model-thinking phase around tool execution", async () => {
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "完成一次工具检查后总结", model }, {
      dataDir,
      executeTool: async () => ({ tools: [] }) as never,
      callModel: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? { text: "", toolCall: { name: "tool_search", arguments: { query: "项目状态" } }, usage: null }
          : { text: "项目状态检查完成。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "项目状态检查完成。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.flatMap((event) => {
      if (event.type === "status") return [`status:${String(event.data?.stage)}`];
      if (event.type === "toolCall" || event.type === "toolResult") return [`${event.type}:${String(event.data?.name)}`];
      if (event.type === "assistant") return ["assistant"];
      return [];
    })).toEqual([
      "status:planning",
      "status:thinking",
      "toolCall:tool_search",
      "toolResult:tool_search",
      "status:thinking",
      "assistant",
      "status:completed",
    ]);
  });

  it("defers MCP tool definitions until tool_search activates a matching tool for the current turn", async () => {
    const mcpTool = {
      name: "mcp__filesystem__read_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_file",
      description: "Read a file from the external filesystem",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      readOnly: true,
    };
    let modelCalls = 0;
    let mcpCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "我需要读取外部文件的能力", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool: async (input) => {
        mcpCalls += 1;
        expect(input).toMatchObject({ name: mcpTool.name, arguments: { path: "notes.txt" } });
        return { text: "external notes", structuredContent: { path: "notes.txt" } };
      },
      executeTool: async () => ({ tools: [] }) as never,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.additionalAgentTools).toEqual([]);
          expect(input.context).toContain("1 个 MCP 工具可通过 tool_search 按需发现");
          return { text: "", toolCall: { name: "tool_search", arguments: { query: "read external file" } }, usage: null };
        }
        expect(input.additionalAgentTools).toEqual([
          expect.objectContaining({ name: mcpTool.name, description: expect.stringContaining("filesystem") }),
        ]);
        expect(input.context).toContain(mcpTool.name);
        if (modelCalls === 2) {
          return { text: "", toolCall: { name: mcpTool.name, arguments: { path: "notes.txt" } }, usage: null };
        }
        expect(modelInputText(input)).toContain("external notes");
        return { text: "已通过按需发现的 MCP 工具读取外部文件。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "已通过按需发现的 MCP 工具读取外部文件。" });
    expect(modelCalls).toBe(3);
    expect(mcpCalls).toBe(1);
    const session = await getProjectAgentSession(projectId, dataDir);
    const searchOutput = session.events.find((event) => event.type === "toolResult" && event.data?.name === "tool_search")?.data?.output;
    expect(searchOutput).toMatchObject({ tools: [expect.objectContaining({ name: mcpTool.name })] });
    expect(session.events.filter((event) => event.type === "toolResult").map((event) => event.data?.name))
      .toEqual(["tool_search", mcpTool.name]);
  });

  it("persists an oversized MCP result before returning it to the model context", async () => {
    const mcpTool = {
      name: "mcp__filesystem__read_large" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_large",
      description: "Read a large external result",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      readOnly: true,
    };
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "读取大型 MCP 结果", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool: async () => ({ text: "z".repeat(120_000) }),
      executeTool: async () => ({ tools: [mcpTool] }) as never,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) return { text: "", toolCall: { name: "tool_search", arguments: { query: "large external" } }, usage: null };
        if (modelCalls === 2) return { text: "", toolCall: { name: mcpTool.name, arguments: {} }, usage: null };
        expect(modelInputText(input)).toContain('"persistedOutput":true');
        expect(modelInputText(input)).toContain("agent-tool-results");
        expect(modelInputText(input)).not.toContain("z".repeat(20_000));
        return { text: "大型 MCP 结果已保存并可按需读取。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "大型 MCP 结果已保存并可按需读取。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === mcpTool.name)?.data?.output)
      .toMatchObject({ persistedOutput: true, outputFilePath: expect.stringContaining("agent-tool-results") });
  });

  it("starts an activated read-only MCP tool while the provider response is still streaming", async () => {
    const mcpTool = {
      name: "mcp__filesystem__read_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_file",
      description: "Read a file from the external filesystem",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      readOnly: true,
    };
    let modelCalls = 0;
    let mcpCalls = 0;
    let markMcpStarted!: () => void;
    const mcpStarted = new Promise<void>((resolve) => { markMcpStarted = resolve; });

    const result = await runProjectAgentTurn({ projectId, prompt: "发现并读取外部文件", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      executeTool: async () => ({ tools: [mcpTool] }) as never,
      callMcpTool: async () => {
        mcpCalls += 1;
        markMcpStarted();
        return { text: "streamed external notes" };
      },
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "tool_search", arguments: { query: "external file" } }, usage: null };
        }
        if (modelCalls === 2) {
          const toolCall = { name: mcpTool.name, arguments: { path: "notes.txt" } };
          modelInput.onToolCallComplete?.(toolCall, 0);
          await mcpStarted;
          return { text: "", toolCalls: [toolCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("streamed external notes");
        return { text: "外部文件已读取。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "外部文件已读取。" });
    expect(modelCalls).toBe(3);
    expect(mcpCalls).toBe(1);
  });

  it("runs MCP through PreToolUse and PostToolUse hooks without streaming ahead", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    const mcpTool = {
      name: "mcp__filesystem__read_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      readOnly: true,
    };
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: `^${mcpTool.name}$`, hooks: [{ type: "http", url: "https://hooks.example.test/mcp-pre" }] }],
        PostToolUse: [{ matcher: `^${mcpTool.name}$`, hooks: [{ type: "http", url: "https://hooks.example.test/mcp-post" }] }],
      },
    }), "utf8");
    const hookEvents: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { hook_event_name: string };
      hookEvents.push(payload.hook_event_name);
      return new Response(JSON.stringify(payload.hook_event_name === "PreToolUse"
        ? { hookSpecificOutput: { permissionDecision: "allow", updatedInput: { path: "rewritten.txt" } } }
        : { hookSpecificOutput: { updatedMCPToolOutput: { text: "hooked MCP output" } } }), { status: 200 });
    }));
    let modelCalls = 0;
    let mcpCalls = 0;
    const mcpCall = { name: mcpTool.name, arguments: { path: "original.txt" } };

    const result = await runProjectAgentTurn({ projectId, prompt: "读取外部文件", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      executeTool: async () => ({ tools: [mcpTool] }) as never,
      callMcpTool: async (input) => {
        mcpCalls += 1;
        expect(input.arguments).toEqual({ path: "rewritten.txt" });
        return { text: "raw MCP output" };
      },
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) return { text: "", toolCall: { name: "tool_search", arguments: { query: "file" } }, usage: null };
        if (modelCalls === 2) {
          input.onToolCallComplete?.(mcpCall, 0);
          expect(mcpCalls).toBe(0);
          return { text: "", toolCalls: [mcpCall], usage: null };
        }
        expect(modelInputText(input)).toContain("hooked MCP output");
        expect(modelInputText(input)).not.toContain("raw MCP output");
        return { text: "MCP Hook 生命周期已完成。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "MCP Hook 生命周期已完成。" });
    expect(hookEvents).toEqual(["PreToolUse", "PostToolUse"]);
    expect(mcpCalls).toBe(1);
    const toolCall = (await getProjectAgentSession(projectId, dataDir)).events.find((event) =>
      event.type === "toolCall" && event.data?.name === mcpTool.name);
    expect(toolCall?.data?.arguments).toEqual({ path: "rewritten.txt" });
  });

  it("pauses an MCP ask rule before streaming execution and resumes the exact approved call", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    const mcpTool = {
      name: "mcp__filesystem__read_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_file",
      description: "Read a file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      readOnly: true,
    };
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: { ask: [mcpTool.name] },
    }), "utf8");
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PermissionRequest: [{ matcher: `^${mcpTool.name}$`, hooks: [{ type: "http", url: "https://hooks.example.test/mcp-permission" }] }],
      },
    }), "utf8");
    const permissionHook = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", permissionHook);
    const turnId = "mcp-permission-ask";
    const mcpCall = { name: mcpTool.name, arguments: { path: "notes.txt" } };
    let modelCalls = 0;
    let mcpCalls = 0;
    const callModel = async (input: {
      onToolCallComplete?: (toolCall: { name: string; arguments: unknown }, index: number) => void;
    }) => {
      modelCalls += 1;
      if (modelCalls === 1) return { text: "", toolCall: { name: "tool_search", arguments: { query: "file" } }, usage: null };
      if (modelCalls === 2) {
        input.onToolCallComplete?.(mcpCall, 0);
        return { text: "", toolCalls: [mcpCall], usage: null };
      }
      return { text: "MCP 调用已批准并完成。", usage: null };
    };
    const executeTool = async (input: { name: string; arguments: Record<string, unknown> }) => {
      if (input.name === "ask_user_question") return input.arguments;
      return { tools: [mcpTool] };
    };
    const first = await runProjectAgentTurn({ projectId, prompt: "读取外部文件", model, turnId }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool: async () => {
        mcpCalls += 1;
        return { text: "notes" };
      },
      executeTool: executeTool as never,
      callModel: callModel as never,
    });

    expect(first).toMatchObject({ status: "waitingInput" });
    expect(first.status === "waitingInput" ? first.options : []).toContainEqual(
      expect.objectContaining({ label: "允许 MCP 工具一次" }),
    );
    expect(mcpCalls).toBe(0);
    expect(permissionHook).toHaveBeenCalledOnce();
    const question = (await getProjectAgentSession(projectId, dataDir)).events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.status === "waitingInput")!;

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "读取外部文件",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: question.id, value: "允许 MCP 工具一次" },
    }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool: async (input) => {
        mcpCalls += 1;
        expect(input).toMatchObject(mcpCall);
        return { text: "notes" };
      },
      executeTool: executeTool as never,
      callModel: callModel as never,
    });

    expect(resumed).toMatchObject({ status: "completed", answer: "MCP 调用已批准并完成。" });
    expect(mcpCalls).toBe(1);
  });

  it("blocks an MCP deny rule and returns the denial to the model", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    const mcpTool = {
      name: "mcp__filesystem__write_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "write_file",
      description: "Write a file",
      parameters: { type: "object", properties: {} },
      readOnly: false,
    };
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: { deny: [mcpTool.name] },
    }), "utf8");
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PermissionDenied: [{ matcher: `^${mcpTool.name}$`, hooks: [{ type: "http", url: "https://hooks.example.test/mcp-denied" }] }],
      },
    }), "utf8");
    const deniedHook = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", deniedHook);
    let modelCalls = 0;
    const callMcpTool = vi.fn(async () => ({ text: "written" }));
    const result = await runProjectAgentTurn({ projectId, prompt: "写入外部文件", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool,
      executeTool: async () => ({ tools: [mcpTool] }) as never,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) return { text: "", toolCall: { name: "tool_search", arguments: { query: "write" } }, usage: null };
        if (modelCalls === 2) return { text: "", toolCall: { name: mcpTool.name, arguments: { path: "notes.txt" } }, usage: null };
        expect(modelInputText(input)).toContain("MCP 工具调用已被项目权限规则拒绝");
        return { text: "权限策略拒绝了外部写入。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "权限策略拒绝了外部写入。" });
    expect(callMcpTool).not.toHaveBeenCalled();
    expect(deniedHook).toHaveBeenCalledOnce();
  });

  it("continues the turn without calling MCP when the user rejects an ask rule", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    const mcpTool = {
      name: "mcp__filesystem__delete_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "delete_file",
      description: "Delete a file",
      parameters: { type: "object", properties: {} },
      readOnly: false,
    };
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: { ask: [mcpTool.name] },
    }), "utf8");
    const turnId = "mcp-permission-reject";
    let modelCalls = 0;
    const callMcpTool = vi.fn(async () => ({ text: "deleted" }));
    const options = {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool,
      executeTool: (async (input: { name: string; arguments: Record<string, unknown> }) =>
        input.name === "ask_user_question" ? input.arguments : { tools: [mcpTool] }) as never,
      callModel: (async (input: { context: string; messages?: Array<{ content: string }> }) => {
        modelCalls += 1;
        if (modelCalls === 1) return { text: "", toolCall: { name: "tool_search", arguments: { query: "delete" } }, usage: null };
        if (modelCalls === 2) return { text: "", toolCall: { name: mcpTool.name, arguments: { path: "notes.txt" } }, usage: null };
        expect(modelInputText(input)).toContain("拒绝");
        return { text: "已保留文件，未执行删除。", usage: null };
      }) as never,
    };
    const first = await runProjectAgentTurn({ projectId, prompt: "删除外部文件", model, turnId }, options);
    expect(first.status).toBe("waitingInput");
    const question = (await getProjectAgentSession(projectId, dataDir)).events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.status === "waitingInput")!;

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "删除外部文件",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: question.id, value: "拒绝" },
    }, options);

    expect(resumed).toMatchObject({ status: "completed", answer: "已保留文件，未执行删除。" });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it("runs an activated writable MCP tool exclusively during streaming", async () => {
    const mcpTool = {
      name: "mcp__filesystem__write_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "write_file",
      description: "Write a file in the external filesystem",
      parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      readOnly: false,
    };
    let modelCalls = 0;
    let mcpCalls = 0;
    const writeCall = { name: mcpTool.name, arguments: { path: "notes.txt", content: "updated" } };

    const result = await runProjectAgentTurn({ projectId, prompt: "发现并更新外部文件", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callMcpTool: async () => {
        mcpCalls += 1;
        return { text: "external file updated" };
      },
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "tool_search", arguments: { query: "external write" } }, usage: null };
        }
        if (modelCalls === 2) {
          modelInput.onToolCallComplete?.(writeCall, 0);
          return { text: "", toolCalls: [writeCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("external file updated");
        return { text: "外部文件已更新。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "外部文件已更新。" });
    expect(modelCalls).toBe(3);
    expect(mcpCalls).toBe(1);
  });

  it("activates a deferred MCP tool from a streamed tool_search result", async () => {
    const mcpTool = {
      name: "mcp__filesystem__read_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_file",
      description: "Read a file from the external filesystem",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      readOnly: true,
    };
    let modelCalls = 0;
    const searchCall = { name: "tool_search", arguments: { query: "external filesystem read" } };

    const result = await runProjectAgentTurn({ projectId, prompt: "发现外部文件工具", model }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          modelInput.onToolCallComplete?.(searchCall, 0);
          return { text: "", toolCalls: [searchCall], usage: null };
        }
        expect(modelInput.additionalAgentTools).toEqual([
          expect.objectContaining({ name: mcpTool.name }),
        ]);
        expect(modelInput.context).toContain(mcpTool.name);
        return { text: "外部文件工具已发现。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "外部文件工具已发现。" });
    expect(modelCalls).toBe(2);
  });

  it("defers heavy built-in tools until tool_search activates them for the current turn", async () => {
    const turnId = "deferred-browser-turn";
    let modelCalls = 0;
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "检查已经给出的本地预览页面",
      model,
      turnId,
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.allowedAgentTools).not.toContain("browser");
          expect(input.prompt).not.toContain("- browser [");
          return { text: "", toolCall: { name: "tool_search", arguments: { query: "browser 页面预览" } }, usage: null };
        }
        expect(input.allowedAgentTools).toContain("browser");
        return { text: "浏览器工具已按需激活。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "浏览器工具已按需激活。" });
    expect(modelCalls).toBe(2);
    expect(restoreActiveBuiltInToolNames(
      (await getProjectAgentSession(projectId, dataDir)).events,
      turnId,
    )).toEqual(new Set(["browser"]));
  });

  it("restores deferred MCP activation when the same Turn resumes", async () => {
    const turnId = "resumed-mcp-turn";
    const mcpTool = {
      name: "mcp__filesystem__read_file" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_file",
      description: "Read an external file",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      readOnly: true,
    };
    await appendProjectAgentEvent({
      projectId,
      turnId,
      type: "toolResult",
      data: {
        name: "tool_search",
        status: "succeeded",
        output: { tools: [{ name: mcpTool.name, description: mcpTool.description }] },
      },
    }, dataDir);

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "继续读取外部文件",
      model,
      turnId,
      resume: true,
    }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callModel: async (input) => {
        expect(input.additionalAgentTools).toEqual([
          expect.objectContaining({ name: mcpTool.name }),
        ]);
        return { text: "续跑时仍可使用已发现的 MCP 工具。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "续跑时仍可使用已发现的 MCP 工具。" });
    expect(restoreActiveMcpToolNames(
      (await getProjectAgentSession(projectId, dataDir)).events,
      turnId,
      [mcpTool],
    )).toEqual(new Set([mcpTool.name]));
  });

  it("keeps a deduplicated Project Turn running after its start request returns", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const callModel = async () => {
      await gate;
      return { text: "后台 Turn 完成", usage: null };
    };
    const input = { projectId, prompt: "检查项目", model, turnId: "detached-turn" };

    const started = await startProjectAgentTurnRun(input, { dataDir, callModel });
    const duplicate = await startProjectAgentTurnRun(input, { dataDir, callModel });

    expect(started).toEqual({ started: true, turnId: "detached-turn" });
    expect(duplicate).toEqual({ started: false, turnId: "detached-turn" });
    release();
    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 500 && !session.events.some((event) =>
      event.turnId === "detached-turn" && event.type === "status" && event.data?.stage === "completed"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(session.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: "detached-turn", type: "assistant", content: "后台 Turn 完成" }),
      expect.objectContaining({ turnId: "detached-turn", type: "status", data: expect.objectContaining({ stage: "completed" }) }),
    ]));
  }, 30_000);

  it("persists a running-turn steering message and discards the stale model decision", async () => {
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    let modelCalls = 0;

    await startProjectAgentTurnRun({ projectId, prompt: "先检查 A", model, turnId: "steered-turn" }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          enteredFirst();
          await firstGate;
          return { text: "过期回答：只检查了 A", usage: null };
        }
        expect(modelInputText(input)).toContain("改为检查 B");
        return { text: "已按补充指令检查 B", usage: null };
      },
    });
    await firstEntered;
    await expect(steerProjectAgentTurnRun({ projectId, prompt: "改为检查 B", turnId: "steered-turn" }, dataDir))
      .resolves.toEqual({ revision: 1, turnId: "steered-turn" });
    releaseFirst();

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 500 && !session.events.some((event) =>
      event.turnId === "steered-turn" && event.type === "status" && event.data?.stage === "completed"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(modelCalls).toBe(2);
    expect(session.events.filter((event) => event.type === "assistant").map((event) => event.content))
      .toEqual(["已按补充指令检查 B"]);
    expect(session.events.find((event) => event.type === "user" && event.data?.source === "steering"))
      .toMatchObject({ turnId: "steered-turn", content: "改为检查 B", data: { revision: 1 } });
  });

  it("cancels stale model generation immediately when a running Turn is steered", async () => {
    let enteredFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    let modelCalls = 0;
    let staleCallAborted = false;

    await startProjectAgentTurnRun({ projectId, prompt: "先检查 A", model, turnId: "cancel-model-turn" }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          enteredFirst();
          return new Promise<never>((_resolve, reject) => {
            const abort = () => {
              staleCallAborted = true;
              const error = new Error("aborted stale generation");
              error.name = "AbortError";
              reject(error);
            };
            if (input.signal?.aborted) abort();
            else input.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        expect(modelInputText(input)).toContain("改为检查 B");
        return { text: "已切换到 B", usage: null };
      },
    });
    await firstEntered;
    await steerProjectAgentTurnRun({ projectId, prompt: "改为检查 B", turnId: "cancel-model-turn" }, dataDir);

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 500 && !session.events.some((event) =>
      event.turnId === "cancel-model-turn" && event.type === "status" && event.data?.stage === "completed"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(staleCallAborted).toBe(true);
    expect(modelCalls).toBe(2);
    expect(session.events.filter((event) => event.type === "assistant").map((event) => event.content))
      .toEqual(["已切换到 B"]);
  });

  it("interrupts a stale cancelable read and excludes its result after steering", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let readEntered!: () => void;
    const entered = new Promise<void>((resolve) => { readEntered = resolve; });
    let modelCalls = 0;
    let readAborted = false;

    await startProjectAgentTurnRun({ projectId, prompt: "读取 A", model, turnId: "cancel-read-turn" }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "read_file", arguments: { relativePath: "a.ts" } }, usage: null };
        }
        expect(modelInputText(input)).toContain("改为读取 B");
        expect(modelInputText(input)).not.toContain("stale A content");
        return { text: "已按新指令处理 B", usage: null };
      },
      executeTool: async (toolInput) => {
        readEntered();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            readAborted = true;
            const error = new Error("aborted stale read");
            error.name = "AbortError";
            reject(error);
          };
          if (toolInput.signal?.aborted) abort();
          else toolInput.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    });
    await entered;
    await steerProjectAgentTurnRun({ projectId, prompt: "改为读取 B", turnId: "cancel-read-turn" }, dataDir);

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 500 && !session.events.some((event) =>
      event.turnId === "cancel-read-turn" && event.type === "status" && event.data?.stage === "completed"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(readAborted).toBe(true);
    expect(modelCalls).toBe(2);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "read_file"))
      .toMatchObject({ content: "已被补充指令中断，结果未纳入上下文。", data: { status: "interrupted" } });
  });

  it("lets a blocking mutation settle before consuming a steering message", async () => {
    let mutationEntered!: () => void;
    let releaseMutation!: () => void;
    const entered = new Promise<void>((resolve) => { mutationEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseMutation = resolve; });
    let modelCalls = 0;
    let mutationSignalAborted = false;

    await startProjectAgentTurnRun({ projectId, prompt: "记录计划", model, turnId: "blocking-mutation-turn" }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "",
            toolCall: {
              name: "task_create",
              arguments: { subject: "检查 A", description: "检查当前实现" },
            },
            usage: null,
          };
        }
        expect(modelInputText(input)).toContain("改为检查 B");
        return { text: "计划已安全写入，并切换到 B", usage: null };
      },
      executeTool: async (toolInput) => {
        mutationEntered();
        toolInput.signal?.addEventListener("abort", () => { mutationSignalAborted = true; }, { once: true });
        await release;
        return {
          task: { id: "1", content: "检查 A", description: "检查当前实现", status: "pending" },
        } as never;
      },
    });
    await entered;
    await steerProjectAgentTurnRun({ projectId, prompt: "改为检查 B", turnId: "blocking-mutation-turn" }, dataDir);
    expect(mutationSignalAborted).toBe(false);
    releaseMutation();

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 500 && !session.events.some((event) =>
      event.turnId === "blocking-mutation-turn" && event.type === "status" && event.data?.stage === "completed"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(mutationSignalAborted).toBe(false);
    expect(modelCalls).toBe(2);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "task_create"))
      .toMatchObject({ data: { status: "succeeded" } });
  });

  it("does not steer a different persisted Turn in the same project", async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const modelEntered = new Promise<void>((resolve) => { entered = resolve; });

    await startProjectAgentTurnRun({ projectId, prompt: "检查 A", model, turnId: "active-turn" }, {
      dataDir,
      callModel: async () => {
        entered();
        await gate;
        return { text: "完成", usage: null };
      },
    });
    await modelEntered;

    await expect(steerProjectAgentTurnRun({ projectId, prompt: "错误追加", turnId: "stale-turn" }, dataDir))
      .rejects.toMatchObject({ code: "busy" });
    release();
  });

  it("converts provider-native function calls into the same validated tool decision", () => {
    expect(projectTurnDecisionFromNativeToolCall({
      name: "open_preview",
      arguments: { taskId: "task-1" },
    })).toBeNull();
    expect(projectTurnDecisionFromNativeToolCall({ name: "open_preview", arguments: {} }))
      .toBeNull();
  });

  it("passes attached image context into the model call", async () => {
    const imageDataUrl = "data:image/png;base64,aW1hZ2U=";
    let receivedImages: string[] | undefined;

    await runProjectAgentTurn({
      imageDataUrls: [imageDataUrl],
      projectId,
      prompt: "分析这张图片",
      model,
    }, {
      dataDir,
      callModel: async (input) => {
        receivedImages = input.imageDataUrls;
        return { text: "图片已分析。", usage: null };
      },
    });

    expect(receivedImages).toEqual([imageDataUrl]);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events[0]?.data?.imageCount).toBe(1);
  });

  it("honors a caller-provided turn id so a canvas node can own the timeline", async () => {
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "继续处理",
      model,
      turnId: "canvas-turn-1",
    }, {
      dataDir,
      callModel: async () => ({ text: "完成", usage: null }),
    });

    expect(result.turnId).toBe("canvas-turn-1");
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.every((event) => event.turnId === "canvas-turn-1")).toBe(true);
    expect(session.events.at(-1)?.data?.stage).toBe("completed");
  });

  it("persists direct conversation and real usage in the one project session", async () => {
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "这个项目是什么？",
      model,
    }, {
      dataDir,
      callModel: async () => ({
        text: "这是一个本地项目。",
        usage: { inputTokens: 1_200, outputTokens: 80, totalTokens: 1_280 },
      }),
    });

    expect(result).toMatchObject({ status: "completed", answer: "这是一个本地项目。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.map((event) => event.type)).toEqual(["user", "status", "status", "assistant", "status"]);
    expect(session.events[0]?.turnId).toBe(session.events[3]?.turnId);
    expect(session.context).toMatchObject({
      modelId: model,
      inputTokens: 1_200,
      outputTokens: 80,
      estimatedEffectiveTokens: 1_280,
    });
  });

  it("persists streamed reasoning summaries before the final answer", async () => {
    await runProjectAgentTurn({ projectId, prompt: "给我一句问候", model }, {
      dataDir,
      callModel: async (input) => {
        await input.onThinkingDelta?.("正在读取项目结构");
        await input.onThinkingDelta?.("并核对配置文件");
        return { text: "检查完成。", usage: null };
      },
    });

    const session = await getProjectAgentSession(projectId, dataDir);
    const thinking = session.events.filter((event) => event.type === "thinking");
    expect(thinking.map((event) => event.content).join(""))
      .toBe("正在读取项目结构并核对配置文件");
    expect(session.events.findIndex((event) => event.type === "thinking"))
      .toBeLessThan(session.events.findIndex((event) => event.type === "assistant"));
    expect(session.events.at(-1)?.data?.stage).toBe("completed");
  });

  it("publishes a live assistant draft and replaces it with the durable final answer", async () => {
    let release!: () => void;
    let draftPublished!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const published = new Promise<void>((resolve) => { draftPublished = resolve; });
    const running = runProjectAgentTurn({ projectId, prompt: "写一句项目说明", model, turnId: "stream-turn" }, {
      dataDir,
      callModel: async (input) => {
        await input.onTextDelta?.("这是正在生成的");
        draftPublished();
        await gate;
        await input.onTextDelta?.("最终答复。");
        return { text: "这是正在生成的最终答复。", usage: null };
      },
    });

    await published;
    await expect(getProjectAgentSession(projectId, dataDir)).resolves.toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ turnId: "stream-turn", type: "assistantDraft", content: "这是正在生成的" }),
      ]),
    });
    release();
    await expect(running).resolves.toMatchObject({ status: "completed", answer: "这是正在生成的最终答复。" });
    const settled = await getProjectAgentSession(projectId, dataDir);
    expect(settled.events.some((event) => event.type === "assistantDraft")).toBe(false);
    expect(settled.events.find((event) => event.type === "assistant")?.content).toBe("这是正在生成的最终答复。");
  });

  it("does not expose compatibility JSON decisions as a streamed answer", async () => {
    await runProjectAgentTurn({ projectId, prompt: "给出结论", model, turnId: "json-stream-turn" }, {
      dataDir,
      callModel: async (input) => {
        const text = JSON.stringify({ type: "complete", summary: "处理完成" });
        await input.onTextDelta?.(text);
        expect((await getProjectAgentSession(projectId, dataDir)).events.some((event) => event.type === "assistantDraft"))
          .toBe(false);
        return { text, usage: null };
      },
    });
  });

  it("records compaction as a visible stage before continuing the current turn", async () => {
    for (let index = 0; index < 5; index += 1) {
      await appendProjectAgentEvent({
        projectId,
        turnId: `old-turn-${index}`,
        type: "user",
        content: `旧问题 ${index} ${"问题".repeat(12_000)}`,
      }, dataDir);
      await appendProjectAgentEvent({
        projectId,
        turnId: `old-turn-${index}`,
        type: "assistant",
        content: `旧回答 ${index} ${"回答".repeat(12_000)}`,
      }, dataDir);
    }
    await updateProjectAgentContext({
      projectId,
      inputTokens: 100_000,
    }, dataDir);

    let calls = 0;
    await runProjectAgentTurn({ projectId, prompt: "继续", model, turnId: "current-turn" }, {
      dataDir,
      callModel: async () => {
        calls += 1;
        return calls === 1
          ? { text: "压缩后的早期上下文", usage: null }
          : { text: "当前回答", usage: null };
      },
    });

    const session = await getProjectAgentSession(projectId, dataDir);
    const currentTurnEvents = session.events.filter((event) => event.turnId === "current-turn");
    expect(currentTurnEvents.map((event) => event.type)).toEqual([
      "user", "status", "status", "compact", "status", "assistant", "status",
    ]);
    expect(currentTurnEvents.filter((event) => event.type === "status").map((event) => event.data?.stage))
      .toEqual(["planning", "compacting", "thinking", "completed"]);
    expect(session.context.activeSummary).toBe("压缩后的早期上下文");
  });

  it("compacts only the active conversation when a conversation id is present", async () => {
    for (let index = 0; index < 2; index += 1) {
      await appendProjectAgentEvent({
        projectId,
        turnId: `conv-a-old-${index}`,
        conversationId: "conv-a",
        sourceNodeId: `node-a-${index}`,
        type: "user",
        content: `A old ${index}`,
        data: index === 0 ? {
          contextSnapshot: {
            version: 1,
            instruction: { prompt: "A old 0" },
            currentNode: { content: "NODE_SNAPSHOT_MUST_NOT_BE_COMPACTED" },
            graph: { connectedContext: "GRAPH_SNAPSHOT_MUST_NOT_BE_COMPACTED" },
            legacy: { canvasContext: "LEGACY_SNAPSHOT_MUST_NOT_BE_COMPACTED" },
          },
        } : undefined,
      }, dataDir);
      await appendProjectAgentEvent({
        projectId,
        turnId: `conv-a-old-${index}`,
        type: "assistant",
        content: `A reply ${index}`,
      }, dataDir);
    }
    await appendProjectAgentEvent({
      projectId,
      turnId: "conv-b-old",
      conversationId: "conv-b",
      sourceNodeId: "node-b",
      type: "user",
      content: "B old",
    }, dataDir);
    await appendProjectAgentEvent({
      projectId,
      turnId: "conv-b-old",
      type: "assistant",
      content: "B reply",
    }, dataDir);

    const result = await runProjectAgentTurn({
      projectId,
      conversationId: "conv-a",
      prompt: "/compact 保留 A 分支结论",
      model,
      turnId: "conv-a-compact",
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("A old 0");
        expect(input.context).not.toContain("NODE_SNAPSHOT_MUST_NOT_BE_COMPACTED");
        expect(input.context).not.toContain("GRAPH_SNAPSHOT_MUST_NOT_BE_COMPACTED");
        expect(input.context).not.toContain("LEGACY_SNAPSHOT_MUST_NOT_BE_COMPACTED");
        return { text: "A conversation summary", usage: null };
      },
    });

    expect(result.status).toBe("completed");
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context.activeSummary).toBe("");
    expect(session.conversations?.find((conversation) => conversation.id === "conv-a")).toMatchObject({
      summary: "A conversation summary",
    });
    expect(session.conversations?.find((conversation) => conversation.id === "conv-b")?.summary).toBeUndefined();
    expect(session.events).toContainEqual(expect.objectContaining({
      turnId: "conv-a-compact",
      conversationId: "conv-a",
      type: "compact",
      data: expect.objectContaining({ scope: "conversation" }),
    }));
  });

  it("runs cc-haha-compatible PreCompact and PostCompact Hooks around the checkpoint", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PreCompact: [{ hooks: [{ type: "http", url: "https://hooks.example.test/pre-compact" }] }],
        PostCompact: [{ hooks: [{ type: "http", url: "https://hooks.example.test/post-compact" }] }],
      },
    }), "utf8");
    const hookEvents: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { hook_event_name: string };
      hookEvents.push(payload.hook_event_name);
      return new Response(JSON.stringify({ systemMessage: `${payload.hook_event_name} context` }), { status: 200 });
    }));
    for (let index = 0; index < 5; index += 1) {
      await appendProjectAgentEvent({
        projectId,
        turnId: `hook-old-turn-${index}`,
        type: "user",
        content: `旧问题 ${index} ${"问题".repeat(12_000)}`,
      }, dataDir);
      await appendProjectAgentEvent({
        projectId,
        turnId: `hook-old-turn-${index}`,
        type: "assistant",
        content: `旧回答 ${index} ${"回答".repeat(12_000)}`,
      }, dataDir);
    }
    await updateProjectAgentContext({ projectId, inputTokens: 100_000 }, dataDir);
    let modelCalls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "继续", model, turnId: "hook-current-turn" }, {
      dataDir,
      callModel: async () => ({
        text: ++modelCalls === 1 ? "压缩后的上下文" : "已继续",
        usage: null,
      }),
    });

    expect(result).toMatchObject({ status: "completed", answer: "已继续" });
    expect(hookEvents).toEqual(["PreCompact", "PostCompact"]);
    const session = await getProjectAgentSession(projectId, dataDir);
    const lifecycle = session.events.filter((event) => event.turnId === "hook-current-turn" && event.data?.hookLifecycle === true);
    expect(lifecycle.map((event) => [event.data?.name, event.content])).toEqual([
      ["PreCompact", "PreCompact context"],
      ["PostCompact", "PostCompact context"],
    ]);
    expect(session.events.findIndex((event) => event.data?.name === "PreCompact"))
      .toBeLessThan(session.events.findIndex((event) => event.type === "compact" && event.turnId === "hook-current-turn"));
    expect(session.events.findIndex((event) => event.data?.name === "PostCompact"))
      .toBeGreaterThan(session.events.findIndex((event) => event.type === "compact" && event.turnId === "hook-current-turn"));
  });

  it("handles /compact as a local command with custom instructions and compact lifecycle hooks", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PreCompact: [{ hooks: [{ type: "http", url: "https://hooks.example.test/pre-compact" }] }],
        PostCompact: [{ hooks: [{ type: "http", url: "https://hooks.example.test/post-compact" }] }],
        SessionStart: [{ hooks: [{ type: "http", url: "https://hooks.example.test/session-start" }] }],
      },
    }), "utf8");
    const hookPayloads: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      hookPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({}), { status: 200 });
    }));
    for (let index = 0; index < 2; index += 1) {
      await appendProjectAgentEvent({
        projectId,
        turnId: `manual-old-turn-${index}`,
        type: "user",
        content: `旧问题 ${index}`,
      }, dataDir);
      await appendProjectAgentEvent({
        projectId,
        turnId: `manual-old-turn-${index}`,
        type: "assistant",
        content: `旧回答 ${index}`,
      }, dataDir);
    }
    let modelCalls = 0;

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "/compact 特别保留部署决策",
      model,
      turnId: "manual-compact-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        expect(input.prompt).toContain("特别保留部署决策");
        return { text: "保留部署决策的上下文摘要", usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      answer: "上下文已压缩，后续对话将基于整理后的摘要继续。",
    });
    expect(modelCalls).toBe(1);
    expect(hookPayloads.map((payload) => payload.hook_event_name))
      .toEqual(["PreCompact", "PostCompact", "SessionStart"]);
    expect(hookPayloads[0]).toMatchObject({
      trigger: "manual",
      customInstructions: "特别保留部署决策",
    });
    expect(hookPayloads[1]).toMatchObject({
      trigger: "manual",
      customInstructions: "特别保留部署决策",
    });
    expect(hookPayloads[2]).toMatchObject({ source: "compact", trigger: "manual" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context.activeSummary).toBe("保留部署决策的上下文摘要");
    expect(session.events.filter((event) => event.turnId === "manual-compact-turn").map((event) => event.type))
      .toEqual(["user", "status", "status", "compact", "assistant", "status"]);
  });

  it("does not call the model when /compact has no earlier turn to summarize", async () => {
    const callModel = vi.fn(async () => ({ text: "不应调用", usage: null }));

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "/compact",
      model,
      turnId: "empty-compact-turn",
    }, { dataDir, callModel });

    expect(result).toMatchObject({
      status: "completed",
      answer: "当前上下文还没有足够的历史内容可压缩。",
    });
    expect(callModel).not.toHaveBeenCalled();
  });

  it("reports the effective model context through /context without calling the model", async () => {
    await appendProjectAgentEvent({
      projectId,
      turnId: "context-history",
      type: "user",
      content: "保留这条历史",
    }, dataDir);
    await updateProjectAgentContext({
      projectId,
      inputTokens: 12_345,
    }, dataDir);
    const callModel = vi.fn(async () => ({ text: "不应调用", usage: null }));

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "/context",
      model,
      turnId: "context-command-turn",
    }, { dataDir, callModel });

    expect(result).toMatchObject({ status: "completed" });
    expect(result.answer).toContain("## 上下文使用情况");
    expect(result.answer).toContain("12,345 / 128,000 tokens");
    expect(result.answer).toContain("距自动压缩阈值");
    expect(result.answer).toContain("压缩检查点");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("reactively compacts and retries the same turn when the provider rejects an oversized context", async () => {
    for (let index = 0; index < 2; index += 1) {
      await appendProjectAgentEvent({
        projectId,
        turnId: `overflow-old-turn-${index}`,
        type: "user",
        content: `历史问题 ${index}`,
      }, dataDir);
      await appendProjectAgentEvent({
        projectId,
        turnId: `overflow-old-turn-${index}`,
        type: "assistant",
        content: `历史回答 ${index}`,
      }, dataDir);
    }
    let modelCalls = 0;

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "继续处理当前任务",
      model,
      turnId: "overflow-current-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) throw new Error("context_length_exceeded: prompt is too long");
        if (modelCalls === 2) {
          expect(input.prompt).toContain("结构化摘要");
          return { text: "响应式压缩摘要", usage: null };
        }
        return { text: "压缩后已继续处理。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "压缩后已继续处理。" });
    expect(modelCalls).toBe(3);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context.activeSummary).toBe("响应式压缩摘要");
    expect(session.events.some((event) =>
      event.turnId === "overflow-current-turn" && event.type === "status" && event.data?.stage === "compacting"
    )).toBe(true);
  });

  it("recovers max output token limits inside the same turn without surfacing the intermediate failure", async () => {
    const turnId = "max-output-recovery-turn";
    let modelCalls = 0;
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "完成一个很长的实现说明",
      model,
      turnId,
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.maxOutputTokens).toBeUndefined();
          throw new ProjectAgentModelStreamError(
            "模型输出达到长度上限，请继续生成剩余内容",
            "max_output_tokens",
            "第一次低上限输出应被静默重试",
            "",
            null,
          );
        }
        if (modelCalls === 2) {
          expect(input.maxOutputTokens).toBe(64_000);
          throw new ProjectAgentModelStreamError(
            "模型输出达到长度上限，请继续生成剩余内容",
            "max_output_tokens",
            "已经完成第一部分。",
            "",
            null,
          );
        }
        expect(input.maxOutputTokens).toBeUndefined();
        expect(input.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({ role: "assistant", content: "已经完成第一部分。" }),
          expect.objectContaining({ role: "user", content: expect.stringContaining("Resume directly") }),
        ]));
        return { text: "第二部分完成。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "第二部分完成。", turnId });
    expect(modelCalls).toBe(3);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "assistant").map((event) => event.content)).toEqual([
      "已经完成第一部分。",
      "第二部分完成。",
    ]);
    expect(session.events.some((event) =>
      event.type === "assistant" && event.data?.maxOutputTokensRecovery === true
    )).toBe(true);
    expect(session.events.some((event) =>
      event.type === "toolResult" && /输出达到长度上限/.test(event.content ?? "")
    )).toBe(false);
  });

  it("runs a safe workspace tool and continues the same turn to a final answer", async () => {
    await fs.writeFile(path.join(workspaceRoot, "README.md"), "hello");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let calls = 0;
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "列出项目根目录",
      model,
    }, {
      dataDir,
      callModel: async () => {
        calls += 1;
        return calls === 1
          ? { text: JSON.stringify({ type: "tool", name: "list_directory", arguments: { relativePath: "." } }), usage: null }
          : { text: "根目录包含 README.md。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "根目录包含 README.md。" });
    expect(result.executionId).toBeTruthy();
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.map((event) => event.type)).toEqual([
      "user", "status", "status", "toolCall", "toolResult", "status", "assistant", "status",
    ]);
    expect(session.events[4]?.data?.output).toEqual({
      entries: [{ kind: "file", relativePath: "README.md" }],
    });
  });

  it("applies project-level PreToolUse Hooks in the main Project Agent loop", async () => {
    await fs.writeFile(path.join(workspaceRoot, "README.md"), "hello");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Glob", hooks: [{ type: "http", url: "https://hooks.example.test/pre-tool" }] }],
      },
    }), "utf8");
    const hookRequest = vi.fn(async () => new Response(JSON.stringify({
      decision: "block",
      reason: "Project Hook blocked this glob",
    }), { status: 200 }));
    vi.stubGlobal("fetch", hookRequest);
    let calls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "查找 README", model, turnId: "hook-tool-turn" }, {
      dataDir,
      callModel: async () => ++calls === 1
        ? { text: "", toolCall: { name: "glob_files", arguments: { pattern: "**/README.md" } }, usage: null }
        : { text: "Hook 阻止了查找，我没有绕过它。", usage: null },
    });

    expect(result).toMatchObject({ status: "completed", answer: "Hook 阻止了查找，我没有绕过它。" });
    expect(hookRequest).toHaveBeenCalledOnce();
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) =>
      event.turnId === "hook-tool-turn" && event.type === "toolResult" && event.data?.name === "glob_files",
    )).toMatchObject({ content: "Project Hook blocked this glob", data: { status: "failed" } });
  });

  it("runs main Agent Session, prompt, stop, and end Hooks around one completed turn", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: Object.fromEntries(["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"].map((event) => [
        event,
        [{ hooks: [{ type: "http", url: `https://hooks.example.test/${event}` }] }],
      ])),
    }), "utf8");
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { hook_event_name: string };
      events.push(payload.hook_event_name);
      return new Response(payload.hook_event_name === "UserPromptSubmit"
        ? JSON.stringify({ systemMessage: "prompt hook context" })
        : "{}", { status: 200 });
    }));

    const result = await runProjectAgentTurn({ projectId, prompt: "完成一次会话", model, turnId: "lifecycle-turn" }, {
      dataDir,
      callModel: async (input) => {
        expect(modelInputText(input)).toContain("prompt hook context");
        return { text: "已完成。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "已完成。" });
    expect(events).toEqual(["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"]);
  });

  it("runs cc-haha Setup hooks only through the explicit init command", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: { Setup: [{ matcher: "init", hooks: [{ type: "http", url: "https://hooks.example.test/setup" }] }] },
    }), "utf8");
    const hookRequest = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({ hook_event_name: "Setup", trigger: "init" });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", hookRequest);
    const callModel = vi.fn();

    await expect(runProjectAgentTurn({ projectId, prompt: "/init", model, turnId: "setup-init-turn" }, {
      dataDir,
      callModel,
    })).resolves.toMatchObject({ status: "completed", answer: "Project Setup（init）Hook 已执行。" });
    expect(hookRequest).toHaveBeenCalledOnce();
    expect(callModel).not.toHaveBeenCalled();
  });

  it("runs StopFailure and SessionEnd Hooks when the main Agent turn fails", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: Object.fromEntries(["StopFailure", "SessionEnd"].map((event) => [
        event,
        [{ hooks: [{ type: "http", url: `https://hooks.example.test/${event}` }] }],
      ])),
    }), "utf8");
    const events: Array<{ event: string; input: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown> & {
        hook_event_name: string;
      };
      const event = payload.hook_event_name;
      events.push({
        event,
        input: event === "StopFailure"
          ? { error: payload.error }
          : { reason: payload.reason, error: payload.error },
      });
      return new Response("{}", { status: 200 });
    }));

    await expect(runProjectAgentTurn({
      projectId,
      prompt: "触发模型失败",
      model,
      turnId: "failure-lifecycle-turn",
    }, {
      dataDir,
      callModel: async () => { throw new Error("provider unavailable"); },
    })).rejects.toThrow("项目 Agent 执行失败");

    expect(events).toEqual([
      { event: "StopFailure", input: { error: "provider unavailable" } },
      { event: "SessionEnd", input: { reason: "failed", error: "provider unavailable" } },
    ]);
  });

  it("routes Shell through the same PreToolUse Hook lifecycle before execution", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "http", url: "https://hooks.example.test/pre-shell" }] }],
      },
    }), "utf8");
    const hookRequest = vi.fn(async () => new Response(JSON.stringify({
      decision: "block",
      reason: "Project Hook blocked this shell command",
    }), { status: 200 }));
    vi.stubGlobal("fetch", hookRequest);
    let calls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "创建标记文件", model, turnId: "hook-shell-turn" }, {
      dataDir,
      callModel: async () => ++calls === 1
        ? {
            text: "",
            toolCall: {
              name: "shell_command",
              arguments: {
                executable: "powershell",
                args: ["-NoProfile", "-Command", "Set-Content -LiteralPath hook-marker.txt -Value blocked"],
                reason: "创建测试标记文件",
              },
            },
            usage: null,
          }
        : { text: "Hook 阻止了命令，我没有绕过它。", usage: null },
    });

    expect(result).toMatchObject({ status: "completed", answer: "Hook 阻止了命令，我没有绕过它。" });
    expect(hookRequest).toHaveBeenCalledOnce();
    await expect(fs.stat(path.join(workspaceRoot, "hook-marker.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) =>
      event.turnId === "hook-shell-turn" && event.type === "toolResult" && event.data?.name === "shell_command",
    )).toMatchObject({ content: "Project Hook blocked this shell command", data: { status: "failed" } });
  });

  it("automatically injects root and newly relevant nested project instructions", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src", "feature"), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "AGENTS.md"), "ROOT_INSTRUCTION");
    await fs.writeFile(path.join(workspaceRoot, "src", "AGENTS.md"), "SRC_INSTRUCTION");
    await fs.writeFile(path.join(workspaceRoot, "src", "feature", "index.ts"), "export const value = 1;\n");
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: {
        InstructionsLoaded: [{ matcher: "^src/", hooks: [{ type: "http", url: "https://hooks.example.test/instructions" }] }],
      },
    }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const contexts: string[] = [];
    const hookPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { file_path: string };
      hookPaths.push(payload.file_path);
      return new Response("{}", { status: 200 });
    }));
    let calls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "检查 feature", model }, {
      dataDir,
      callModel: async (input) => {
        contexts.push(input.context);
        calls += 1;
        return calls === 1
          ? { text: "", toolCall: { name: "read_file", arguments: { relativePath: "src/feature/index.ts" } }, usage: null }
          : { text: "已检查。", usage: null };
      },
    });

    expect(result.answer).toBe("已检查。");
    expect(contexts[0]).toContain("ROOT_INSTRUCTION");
    expect(contexts[0]).not.toContain("SRC_INSTRUCTION");
    expect(contexts[1]).toContain("ROOT_INSTRUCTION");
    expect(contexts[1]).toContain("SRC_INSTRUCTION");
    expect(hookPaths).toEqual(["src/AGENTS.md"]);
  });

  it("rejects a concurrent turn for the same project", async () => {
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const enteredModel = new Promise<void>((resolve) => { started = resolve; });
    const first = runProjectAgentTurn({ projectId, prompt: "先执行", model }, {
      dataDir,
      callModel: async () => {
        started();
        await blocked;
        return { text: "完成", usage: null };
      },
    });
    await enteredModel;
    try {
      await expect(runProjectAgentTurn({ projectId, prompt: "并发执行", model }, {
        dataDir,
        callModel: async () => ({ text: "不应执行", usage: null }),
      })).rejects.toMatchObject<ProjectAgentTurnError>({ code: "busy" });
    } finally {
      release();
      await first;
    }
  });

  it("treats ordinary JSON prose as an answer and only accepts the strict tool protocol", () => {
    expect(parseProjectTurnDecision('{"example":true}')).toBeNull();
    expect(parseProjectTurnDecision("普通回答")).toBeNull();
    expect(parseProjectTurnDecision('{"type":"tool","name":"read_file","arguments":{"relativePath":"a.ts"}}'))
      .toEqual({ type: "tool", name: "read_file", arguments: { relativePath: "a.ts" } });
    expect(parseProjectTurnDecision('{"type":"tool","name":"shell_command","arguments":{"executable":"npm","args":["test"],"reason":"验证"}}'))
      .toEqual({ type: "tool", name: "shell_command", arguments: { executable: "npm", args: ["test"], reason: "验证" } });
    expect(parseProjectTurnDecision('{"type":"tool","name":"shell_command","arguments":{"command":"$env:ZENME_VALUE=\u0027ok\u0027; Write-Output $env:ZENME_VALUE","reason":"验证脚本"}}'))
      .toEqual(expect.objectContaining({
        type: "tool",
        name: "shell_command",
        arguments: {
          command: "$env:ZENME_VALUE='ok'; Write-Output $env:ZENME_VALUE",
          reason: "验证脚本",
        },
      }));
    expect(parseProjectTurnDecision('{"type":"tool","name":"dangerous","arguments":{}}')).toBeNull();
    expect(parseProjectTurnDecision('{"type":"tool","name":"read_file","arguments":{}}')).toBeNull();
  });

  it("pauses the tool loop when the model asks the user a structured question", async () => {
    const result = await runProjectAgentTurn({ projectId, prompt: "帮我制定方案", model }, {
      dataDir,
      callModel: async () => ({
        text: JSON.stringify({
          type: "tool",
          name: "ask_user_question",
          arguments: { question: "优先做哪个方向？", options: [{ label: "核心工具" }, { label: "子 Agent" }] },
        }),
        usage: null,
      }),
    });

    expect(result).toMatchObject({ status: "waitingInput", question: "优先做哪个方向？" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.map((event) => event.type)).toEqual(["user", "status", "status", "toolCall", "toolResult", "status"]);
    expect(session.events.at(-2)?.data).toMatchObject({ name: "ask_user_question", status: "waitingInput" });
  });

  it("persists TaskCreate as the active cross-turn task plan and a visible waterfall event", async () => {
    let calls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "完成一个复杂修复", model }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        if (calls === 1) return {
          text: "",
          toolCall: {
            name: "task_create",
            arguments: { subject: "修复缺陷", description: "检查实现后修复缺陷", activeForm: "正在修复缺陷" },
          },
          usage: null,
        };
        expect(input.context).toContain("当前 Agent 任务计划");
        expect(input.context).toContain("修复缺陷");
        return { text: "计划已建立并继续执行。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "计划已建立并继续执行。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.taskPlan).toEqual([
      expect.objectContaining({ content: "修复缺陷", description: "检查实现后修复缺陷", status: "pending" }),
    ]);
    expect(session.events.find((event) => event.type === "todo")?.data?.items).toEqual(session.taskPlan);
  });

  it("pauses the same Turn for a streamed ask_user_question result", async () => {
    const questionCall = {
      name: "ask_user_question",
      arguments: { question: "优先处理哪一项？", options: [{ label: "运行时" }, { label: "界面" }] },
    };

    const result = await runProjectAgentTurn({ projectId, prompt: "先确认优先级", model }, {
      dataDir,
      callModel: async (input) => {
        input.onToolCallComplete?.(questionCall, 0);
        return { text: "", toolCalls: [questionCall], usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "waitingInput",
      question: "优先处理哪一项？",
      options: [{ label: "运行时" }, { label: "界面" }],
    });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) =>
      event.type === "toolResult" && event.data?.name === "ask_user_question" && event.data?.status === "waitingInput"))
      .toHaveLength(1);
    expect(session.events.at(-1)?.data).toMatchObject({ stage: "waitingInput" });
  });

  it("keeps newly created shared project tasks in the same main Agent turn context", async () => {
    let calls = 0;
    await runProjectAgentTurn({ projectId, prompt: "拆分并继续复杂任务", model }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        if (calls === 1) return {
          text: "",
          toolCall: {
            name: "task_create",
            arguments: { subject: "检查运行时", description: "读取生产路径并确认行为" },
          },
          usage: null,
        };
        expect(input.context).toContain("当前 Agent 任务计划");
        expect(input.context).toContain("检查运行时");
        return { text: "共享任务已建立。", usage: null };
      },
    });

    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.taskPlan).toEqual([
      expect.objectContaining({ content: "检查运行时", description: "读取生产路径并确认行为", status: "pending" }),
    ]);
    expect(session.events.some((event) => event.type === "todo" && event.data?.items)).toBe(true);
  });

  it("records a structured answer and resumes the same Turn", async () => {
    const first = await runProjectAgentTurn({ projectId, prompt: "帮我制定方案", model, turnId: "question-turn" }, {
      dataDir,
      callModel: async () => ({
        text: "",
        toolCall: {
          name: "ask_user_question",
          arguments: { question: "优先做哪个方向？", options: [{ label: "核心工具" }, { label: "子 Agent" }] },
        },
        usage: null,
      }),
    });
    expect(first.status).toBe("waitingInput");
    const waitingSession = await getProjectAgentSession(projectId, dataDir);
    const questionEvent = waitingSession.events.find((event) =>
      event.type === "toolResult" && event.data?.name === "ask_user_question" && event.data?.status === "waitingInput",
    );
    expect(questionEvent).toBeDefined();

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "用户对上一条问题的回答：核心工具",
      model,
      turnId: "question-turn",
      resume: true,
      questionAnswer: { eventId: questionEvent!.id, value: "核心工具" },
    }, {
      dataDir,
      callModel: async (modelInput) => {
        expect(modelInputText(modelInput)).toContain('"answer":"核心工具"');
        return { text: "先完成核心工具。", usage: null };
      },
    });

    expect(resumed).toMatchObject({ status: "completed", answer: "先完成核心工具。", turnId: "question-turn" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "user")).toHaveLength(1);
    expect(session.events.find((event) => event.data?.questionEventId === questionEvent!.id)).toMatchObject({
      turnId: "question-turn",
      type: "toolResult",
      data: {
        name: "ask_user_question",
        status: "succeeded",
        output: expect.objectContaining({ answer: "核心工具", answers: { "优先做哪个方向？": "核心工具" } }),
      },
    });
  });

  it("pauses for multiple questions and replays the complete structured answer in the same Turn", async () => {
    const turnId = "multi-question-turn";
    const first = await runProjectAgentTurn({ projectId, prompt: "需要确认两个决策", model, turnId }, {
      dataDir,
      callModel: async () => ({
        text: "",
        toolCall: {
          name: "ask_user_question",
          arguments: {
            questions: [
              { question: "采用哪个方案？", header: "方案", options: [{ label: "A" }, { label: "B" }] },
              { question: "同时补哪些内容？", header: "范围", multiSelect: true, options: [{ label: "测试" }, { label: "文档" }] },
            ],
          },
        },
        usage: null,
      }),
    });
    expect(first.status).toBe("waitingInput");
    const waitingSession = await getProjectAgentSession(projectId, dataDir);
    const questionEvent = waitingSession.events.find((event) =>
      event.type === "toolResult" && event.data?.name === "ask_user_question" && event.data?.status === "waitingInput",
    );
    expect(questionEvent?.data?.output).toMatchObject({
      questions: [
        { question: "采用哪个方案？", header: "方案", multiSelect: false },
        { question: "同时补哪些内容？", header: "范围", multiSelect: true },
      ],
    });

    const answers = { "采用哪个方案？": "A", "同时补哪些内容？": "测试, 文档" };
    const annotations = { "采用哪个方案？": { preview: "A 方案预览", notes: "优先兼容现有数据" } };
    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "用户已回答多个问题",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: questionEvent!.id, answers, annotations },
    }, {
      dataDir,
      callModel: async (modelInput) => {
        expect(modelInputText(modelInput)).toContain('"answers":{"采用哪个方案？":"A","同时补哪些内容？":"测试, 文档"}');
        expect(modelInputText(modelInput)).toContain('"annotations":{"采用哪个方案？":{"preview":"A 方案预览","notes":"优先兼容现有数据"}}');
        return { text: "按 A 方案补齐测试和文档。", usage: null };
      },
    });

    expect(resumed).toMatchObject({ status: "completed", answer: "按 A 方案补齐测试和文档。", turnId });
  });

  it("enters Plan Mode, submits a plan for approval, and resumes implementation in the same Turn", async () => {
    const turnId = "plan-mode-turn";
    let calls = 0;
    const callModel = async (input: Parameters<typeof modelInputText>[0] & { allowedAgentTools?: string[] }) => {
      calls += 1;
      if (calls === 1) {
        expect(input.allowedAgentTools).toEqual(expect.arrayContaining(["enter_plan_mode", "write_file", "shell_command"]));
        expect(input.allowedAgentTools).not.toContain("exit_plan_mode");
        return {
          text: "",
          toolCall: { name: "enter_plan_mode", arguments: {} },
          usage: null,
        };
      }
      if (calls === 2) {
        expect(input.context).toContain("当前处于规划模式");
        expect(input.allowedAgentTools).toEqual(expect.arrayContaining(["read_file", "search_files", "write_file", "edit_file", "exit_plan_mode"]));
        expect(input.allowedAgentTools).not.toContain("shell_command");
        expect(input.allowedAgentTools).not.toContain("enter_plan_mode");
        return {
          text: "",
          toolCall: {
            name: "exit_plan_mode",
            arguments: { plan: "## 实施计划\n1. 阅读现有实现\n2. 修改并验证" },
          },
          usage: null,
        };
      }
      expect(input.context).toContain("当前处于普通执行模式");
      expect(modelInputText(input)).toContain("## 实施计划");
      expect(input.allowedAgentTools).toEqual(expect.arrayContaining(["write_file", "shell_command", "enter_plan_mode"]));
      expect(input.allowedAgentTools).not.toContain("exit_plan_mode");
      return { text: "计划已批准，开始实施。", usage: null };
    };

    const exitWaiting = await runProjectAgentTurn({ projectId, prompt: "设计并实现高影响架构调整", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    });
    expect(exitWaiting).toMatchObject({ status: "waitingInput", question: expect.stringContaining("批准") });
    let session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context).toMatchObject({
      interactionMode: "plan",
      activePlan: "## 实施计划\n1. 阅读现有实现\n2. 修改并验证",
    });
    expect(session.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.name === "enter_plan_mode"))
      .toMatchObject({ data: { status: "succeeded" } });
    const exitQuestion = session.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.name === "exit_plan_mode" && event.data?.status === "waitingInput");
    expect(exitQuestion).toBeDefined();

    const completed = await runProjectAgentTurn({
      projectId,
      prompt: "批准并开始实施",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: exitQuestion!.id, value: "批准并开始实施" },
    }, { dataDir, callModel: callModel as never });

    expect(completed).toMatchObject({ status: "completed", answer: "计划已批准，开始实施。", turnId });
    session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context).toMatchObject({
      interactionMode: "default",
      activePlan: "## 实施计划\n1. 阅读现有实现\n2. 修改并验证",
    });
    expect(session.events.filter((event) => event.turnId === turnId && event.type === "user")).toHaveLength(1);
    expect(calls).toBe(3);
  });

  it("keeps Plan Mode scoped to the active conversation", async () => {
    let aCalls = 0;
    await expect(runProjectAgentTurn({
      projectId,
      conversationId: "conv-a",
      sourceNodeId: "node-a",
      prompt: "规划 A 分支",
      model,
      turnId: "conv-a-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        aCalls += 1;
        if (aCalls === 1) {
          return { text: "", toolCall: { name: "enter_plan_mode", arguments: {} }, usage: null };
        }
        expect(input.context).toContain("当前处于规划模式");
        expect(input.allowedAgentTools).not.toContain("shell_command");
        return { text: "A 正在规划。", usage: null };
      },
    })).resolves.toMatchObject({ status: "completed", answer: "A 正在规划。" });

    const afterA = await getProjectAgentSession(projectId, dataDir);
    expect(afterA.context.interactionMode).toBe("default");
    expect(afterA.conversations?.find((item) => item.id === "conv-a")?.interactionMode).toBe("plan");

    await expect(runProjectAgentTurn({
      projectId,
      conversationId: "conv-b",
      sourceNodeId: "node-b",
      prompt: "执行 B 分支",
      model,
      turnId: "conv-b-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("当前处于普通执行模式");
        expect(input.allowedAgentTools).toContain("shell_command");
        return { text: "B 正常执行。", usage: null };
      },
    })).resolves.toMatchObject({ status: "completed", answer: "B 正常执行。" });

    const afterB = await getProjectAgentSession(projectId, dataDir);
    expect(afterB.conversations?.find((item) => item.id === "conv-a")?.interactionMode).toBe("plan");
    expect(afterB.conversations?.find((item) => item.id === "conv-b")?.interactionMode).toBeUndefined();
  });

  it("keeps permission mode scoped to the active conversation", async () => {
    await expect(runProjectAgentTurn({
      projectId,
      conversationId: "conv-permission-a",
      sourceNodeId: "node-permission-a",
      prompt: "A 使用 neverAsk",
      model,
      permissionMode: "neverAsk",
      turnId: "permission-a-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("默认会话权限：neverAsk");
        return { text: "A done", usage: null };
      },
    })).resolves.toMatchObject({ status: "completed", answer: "A done" });

    const afterA = await getProjectAgentSession(projectId, dataDir);
    expect(afterA.context.permissionMode).toBeUndefined();
    expect(afterA.conversations?.find((item) => item.id === "conv-permission-a")?.permissionMode).toBe("neverAsk");

    await expect(runProjectAgentTurn({
      projectId,
      conversationId: "conv-permission-a",
      sourceNodeId: "node-permission-a-continued",
      prompt: "A 继续沿用当前会话权限",
      model,
      turnId: "permission-a-follow-up-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("默认会话权限：neverAsk");
        return { text: "A continued", usage: null };
      },
    })).resolves.toMatchObject({ status: "completed", answer: "A continued" });

    await expect(runProjectAgentTurn({
      projectId,
      conversationId: "conv-permission-b",
      sourceNodeId: "node-permission-b",
      prompt: "B 使用默认权限",
      model,
      turnId: "permission-b-turn",
    }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain("默认会话权限：onRequest");
        return { text: "B done", usage: null };
      },
    })).resolves.toMatchObject({ status: "completed", answer: "B done" });
  });

  it("switches into Plan Mode from a streamed exclusive control tool", async () => {
    let calls = 0;
    const enterPlanCall = { name: "enter_plan_mode", arguments: {} };

    const result = await runProjectAgentTurn({ projectId, prompt: "先进入规划模式", model }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        if (calls === 1) {
          input.onToolCallComplete?.(enterPlanCall, 0);
          return { text: "", toolCalls: [enterPlanCall], usage: null };
        }
        expect(input.context).toContain("当前处于规划模式");
        expect(input.allowedAgentTools).toContain("write_file");
        expect(input.allowedAgentTools).not.toContain("enter_plan_mode");
        return { text: "已切换到只读规划模式。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "已切换到只读规划模式。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context.interactionMode).toBe("plan");
    expect(session.events.filter((event) => event.type === "toolResult" && event.data?.name === "enter_plan_mode"))
      .toHaveLength(1);
  });

  it("pauses for approval from a streamed exit_plan_mode result", async () => {
    await updateProjectAgentContext({ projectId, interactionMode: "plan" }, dataDir);
    const exitPlanCall = {
      name: "exit_plan_mode",
      arguments: { plan: "## 流式计划\n1. 核对实现\n2. 修改并验证" },
    };

    const result = await runProjectAgentTurn({ projectId, prompt: "提交计划", model }, {
      dataDir,
      callModel: async (input) => {
        input.onToolCallComplete?.(exitPlanCall, 0);
        return { text: "", toolCalls: [exitPlanCall], usage: null };
      },
    });

    expect(result).toMatchObject({ status: "waitingInput", question: expect.stringContaining("批准") });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.context).toMatchObject({
      interactionMode: "plan",
      activePlan: "## 流式计划\n1. 核对实现\n2. 修改并验证",
    });
    expect(session.events.filter((event) =>
      event.type === "toolResult" && event.data?.name === "exit_plan_mode" && event.data?.status === "waitingInput"))
      .toHaveLength(1);
  });

  it("keeps Plan Mode active when the submitted plan is not approved", async () => {
    const turnId = "plan-mode-revision-turn";
    await updateProjectAgentContext({
      projectId,
      interactionMode: "plan",
      activePlan: "## 原计划",
    }, dataDir);
    let calls = 0;
    const callModel = async (input: { allowedAgentTools?: string[]; context: string }) => {
      calls += 1;
      expect(input.allowedAgentTools).toContain("exit_plan_mode");
      expect(input.allowedAgentTools).toContain("write_file");
      if (calls === 1) return {
        text: "",
        toolCall: { name: "exit_plan_mode", arguments: { plan: "## 新计划\n1. 先补回归测试" } },
        usage: null,
      };
      expect(input.context).toContain("## 新计划");
      return { text: "我会继续修改计划。", usage: null };
    };

    const waiting = await runProjectAgentTurn({ projectId, prompt: "完善计划", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    });
    const session = await getProjectAgentSession(projectId, dataDir);
    const question = session.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.name === "exit_plan_mode" && event.data?.status === "waitingInput");
    expect(waiting.status).toBe("waitingInput");

    const revised = await runProjectAgentTurn({
      projectId,
      prompt: "先补充失败回滚方案",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: question!.id, value: "继续修改计划" },
    }, { dataDir, callModel: callModel as never });

    expect(revised).toMatchObject({ status: "completed", answer: "我会继续修改计划。" });
    expect((await getProjectAgentSession(projectId, dataDir)).context).toMatchObject({
      interactionMode: "plan",
      activePlan: "## 新计划\n1. 先补回归测试",
    });
  });

  it("allows only the plan virtual file and rejects ordinary writes and Shell while Plan Mode is active", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await updateProjectAgentContext({ projectId, interactionMode: "plan" }, dataDir);
    let calls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "先规划，不要实施", model }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        expect(input.allowedAgentTools).toContain("write_file");
        if (calls === 1) return {
          text: "",
          toolCall: {
            name: "write_file",
            arguments: { relativePath: "plan-mode-escape.txt", content: "should not exist" },
          },
          usage: null,
        };
        expect(modelInputText(input)).toContain("规划模式只能写入");
        return { text: "已停止实施并继续规划。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "已停止实施并继续规划。" });
    await expect(fs.stat(path.join(workspaceRoot, "plan-mode-escape.txt"))).rejects.toThrow();
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) =>
      event.type === "toolResult" && event.data?.name === "write_file" && event.data?.status === "failed"))
      .toMatchObject({ content: expect.stringContaining("规划模式只能写入") });
  });

  it("continues tool execution in the same Agent Execution after answering a question", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const turnId = "question-execution-continuity";
    let calls = 0;
    const callModel = async () => {
      calls += 1;
      if (calls === 1) return {
        text: "",
        toolCall: { name: "ask_user_question", arguments: { question: "继续检查 Workspace 吗？" } },
        usage: null,
      };
      if (calls === 2) return {
        text: "",
        toolCall: { name: "workspace_status", arguments: {} },
        usage: null,
      };
      return { text: "已在原执行轨迹中继续检查 Workspace。", usage: null };
    };

    const waiting = await runProjectAgentTurn({ projectId, prompt: "先确认是否继续", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    });
    expect(waiting).toMatchObject({ status: "waitingInput", executionId: expect.any(String) });
    const session = await getProjectAgentSession(projectId, dataDir);
    const question = session.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.name === "ask_user_question");

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "继续",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: question!.id, value: "继续" },
    }, { dataDir, callModel: callModel as never });

    expect(resumed).toMatchObject({
      status: "completed",
      answer: "已在原执行轨迹中继续检查 Workspace。",
      executionId: waiting.executionId,
    });
    const executions = (await listAgentExecutions(projectId, dataDir))
      .filter((execution) => execution.resultNodeId === turnId);
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      id: waiting.executionId,
      status: "succeeded",
      toolCalls: [
        expect.objectContaining({ name: "ask_user_question", status: "succeeded" }),
        expect.objectContaining({ name: "workspace_status", status: "succeeded" }),
      ],
    });
  }, 15_000);

  it("keeps an MCP tool call pending across Elicitation and resumes it without replay", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const turnId = "mcp-elicitation-continuity";
    let modelCalls = 0;
    const callMcpTool = vi.fn(async (input: {
      onElicitation?: (request: unknown) => Promise<unknown>;
      onElicitationComplete?: (completion: unknown) => Promise<void>;
    }) => {
      const result = await input.onElicitation!({
        serverId: "design-server",
        serverName: "Design Server",
        params: {
          message: "请选择导出格式",
          requestedSchema: {
            type: "object",
            properties: { format: { type: "string", enum: ["png", "svg"] } },
            required: ["format"],
          },
        },
      });
      await input.onElicitationComplete?.({
        serverId: "design-server",
        serverName: "Design Server",
        elicitationId: "export-auth",
      });
      return { text: JSON.stringify(result), structuredContent: result };
    });
    await startProjectAgentTurnRun({ projectId, prompt: "导出设计", model, turnId }, {
      dataDir,
      listMcpTools: async () => ({
        tools: [{
          name: "mcp__design_server__export",
          serverId: "design-server",
          serverName: "Design Server",
          remoteName: "export",
          description: "导出设计",
          parameters: { type: "object", properties: {} },
          readOnly: false,
        }],
        failures: [],
      }),
      callMcpTool: callMcpTool as never,
      callModel: (async () => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCall: { name: "tool_search", arguments: { query: "design_server export" } },
          usage: null,
        };
        return modelCalls === 2
          ? { text: "", toolCall: { name: "mcp__design_server__export", arguments: {} }, usage: null }
          : { text: "设计已导出。", usage: null };
      }) as never,
    });

    let question: Awaited<ReturnType<typeof getProjectAgentSession>>["events"][number] | undefined;
    await vi.waitFor(async () => {
      const session = await getProjectAgentSession(projectId, dataDir);
      question = session.events.find((event) =>
        event.turnId === turnId && event.type === "toolResult" &&
        event.data?.name === "ask_user_question" && event.data?.status === "waitingInput");
      expect(question, JSON.stringify(session.events.map((event) => ({ type: event.type, data: event.data, content: event.content })))).toBeDefined();
    }, { timeout: 15_000 });
    expect(question?.data?.output).toMatchObject({
      mcpElicitation: { serverName: "Design Server", mode: "form" },
    });

    await expect(answerProjectAgentTurnRun({
      projectId,
      turnId,
      eventId: question!.id,
      value: JSON.stringify({ format: "svg" }),
    }, dataDir)).resolves.toBe(true);
    await vi.waitFor(async () => {
      const session = await getProjectAgentSession(projectId, dataDir);
      expect(session.events.findLast((event) => event.turnId === turnId && event.type === "status")?.data?.stage)
        .toBe("completed");
    }, { timeout: 5_000 });
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(modelCalls).toBe(3);
  }, 15_000);

  it("preserves Turn reasoning effort and speed after waiting for user input", async () => {
    const turnId = "configured-question-turn";
    const received: Array<{ reasoningEffort?: string; modelSpeed?: string }> = [];
    let calls = 0;
    const callModel = async (input: { reasoningEffort?: string; modelSpeed?: string }) => {
      received.push({ reasoningEffort: input.reasoningEffort, modelSpeed: input.modelSpeed });
      calls += 1;
      return calls === 1
        ? { text: "", toolCall: { name: "ask_user_question", arguments: { question: "继续吗？" } }, usage: null }
        : { text: "继续完成。", usage: null };
    };
    const first = await runProjectAgentTurn({
      projectId,
      prompt: "先确认再继续",
      model,
      turnId,
      reasoningEffort: "xhigh",
      modelSpeed: "fast",
    }, { dataDir, callModel: callModel as never });
    expect(first.status).toBe("waitingInput");
    const waitingSession = await getProjectAgentSession(projectId, dataDir);
    const question = waitingSession.events.find((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.name === "ask_user_question");

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "继续",
      model,
      turnId,
      resume: true,
      questionAnswer: { eventId: question!.id, value: "继续" },
    }, { dataDir, callModel: callModel as never });

    expect(resumed).toMatchObject({ status: "completed", answer: "继续完成。" });
    expect(received).toEqual([
      { reasoningEffort: "xhigh", modelSpeed: "fast" },
      { reasoningEffort: "xhigh", modelSpeed: "fast" },
    ]);
    expect(waitingSession.events.find((event) => event.turnId === turnId && event.type === "user")?.data)
      .toMatchObject({ reasoningEffort: "xhigh", modelSpeed: "fast" });
  });

  it("routes an explicit git init request through the model and native Shell tool", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { gitWrite: true } }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "在当前目录初始化 git，默认分支使用 main",
      model,
    }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls > 1) return { text: "初始化完成。", usage: null };
        return {
          text: "",
          toolCall: {
            name: "shell_command",
            arguments: {
              executable: "git",
              args: ["init", "-b", "main"],
              reason: "在当前 Workspace 初始化 Git 仓库并将默认分支设为 main",
            },
          },
          usage: null,
        };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "初始化完成。" });
    expect(modelCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "approval")?.data).toMatchObject({
      args: ["init", "-b", "main"],
      executable: "git",
      status: "autoApproved",
    });
    await expect(fs.stat(path.join(workspaceRoot, ".git"))).resolves.toMatchObject({});
  }, 15_000);

  it("resumes an approval-gated turn without duplicating the user message or replaying the command", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    const first = await runProjectAgentTurn({ projectId, prompt: "运行需要提升权限的项目命令", model, turnId: "resume-turn" }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        const toolCall = {
          name: "shell_command",
          arguments: { command: "npm exec anything", reason: "运行外部包命令" },
        };
        input.onToolCallComplete?.(toolCall, 0);
        return {
          text: "",
          toolCalls: [toolCall],
          usage: null,
        };
      },
    });
    expect(first.status).toBe("waitingApproval");
    expect(modelCalls).toBe(1);
    const waitingExecution = await getAgentExecution(projectId, String(first.executionId), dataDir);
    expect(waitingExecution?.toolCalls).toEqual([]);
    expect(waitingExecution?.commandRequests).toEqual([
      expect.objectContaining({ status: "proposed", command: "npm exec anything" }),
    ]);
    expect((await getProjectAgentSession(projectId, dataDir)).events.find((event) =>
      event.turnId === "resume-turn" && event.type === "approval")?.data).toMatchObject({
        command: "npm exec anything",
        status: "pending",
      });

    const resumed = await runProjectAgentTurn({
      projectId, prompt: "运行需要提升权限的项目命令", model, turnId: "resume-turn", resume: true,
    }, {
      dataDir,
      callModel: async () => ({ text: JSON.stringify({ type: "complete", summary: "已继续处理" }), usage: null }),
    });
    expect(resumed).toMatchObject({ status: "completed", answer: "已继续处理" });
    expect(resumed.executionId).toBe(first.executionId);
    expect((await listAgentExecutions(projectId, dataDir)).filter((execution) => execution.resultNodeId === "resume-turn"))
      .toHaveLength(1);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.turnId === "resume-turn" && event.type === "user")).toHaveLength(1);
    expect(session.events.filter((event) => event.turnId === "resume-turn" && event.type === "approval")).toHaveLength(1);
  }, 15_000);

  it("feeds a neverAsk command denial back to the model instead of ending with a runtime-generated answer", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({
      projectId,
      prompt: "运行需要明确批准的命令并说明结果",
      model,
      permissionMode: "neverAsk",
    }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "",
            toolCall: {
              name: "shell_command",
              arguments: { executable: "npm", args: ["exec", "anything"], reason: "运行外部包命令" },
            },
            usage: null,
          };
        }
        expect(modelInputText(modelInput)).toContain("当前会话为“从不请求审批”，因此已直接拒绝");
        return { text: "该命令需要审批，但当前权限禁止请求审批，因此未执行。", usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      answer: "该命令需要审批，但当前权限禁止请求审批，因此未执行。",
    });
    expect(modelCalls).toBe(2);
  });

  it("applies an in-workspace edit before the Agent continues to verification", async () => {
    await fs.writeFile(path.join(workspaceRoot, "README.md"), "before\n");
    await fs.mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".claude", "settings.json"), JSON.stringify({
      hooks: { FileChanged: [{ matcher: "README\\.md$", hooks: [{ type: "http", url: "https://hooks.example.test/file" }] }] },
    }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true } }, dataDir);
    const changedPaths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { file_path: string };
      changedPaths.push(payload.file_path);
      return new Response("{}", { status: 200 });
    }));
    const decisions = [
      { type: "tool", name: "edit_file", arguments: { relativePath: "README.md", oldText: "before", newText: "after" } },
      { type: "tool", name: "read_file", arguments: { relativePath: "README.md" } },
      { type: "complete", summary: "修改并验证完成" },
    ];
    let index = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "修改 README 并验证", model }, {
      dataDir,
      callModel: async () => ({ text: JSON.stringify(decisions[index++]), usage: null }),
    });

    expect(result).toMatchObject({ status: "completed", answer: "修改并验证完成" });
    await expect(fs.readFile(path.join(workspaceRoot, "README.md"), "utf8")).resolves.toBe("after\n");
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "edit_file")?.data?.output)
      .toMatchObject({ status: "applied" });
    expect(changedPaths).toEqual(["README.md"]);
  }, 15_000);

  it("applies a multi-file apply_patch atomically before the Agent continues", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "src", "a.txt"), "before\n");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true } }, dataDir);
    const decisions = [
      {
        type: "tool",
        name: "apply_patch",
        arguments: {
          patch: "*** Begin Patch\n*** Update File: src/a.txt\n@@ -1,1 +1,1 @@\n-before\n+after\n*** Add File: src/b.txt\n+created\n*** End Patch",
        },
      },
      { type: "complete", summary: "补丁应用完成" },
    ];
    let index = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "同时更新两个文件", model }, {
      dataDir,
      callModel: async () => ({ text: JSON.stringify(decisions[index++]), usage: null }),
    });

    expect(result).toMatchObject({ status: "completed", answer: "补丁应用完成" });
    await expect(fs.readFile(path.join(workspaceRoot, "src", "a.txt"), "utf8")).resolves.toBe("after\n");
    await expect(fs.readFile(path.join(workspaceRoot, "src", "b.txt"), "utf8")).resolves.toBe("created\n");
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "apply_patch")?.data?.output)
      .toMatchObject({ operationCount: 2, status: "applied" });
  });

  it("does not replace the model's completion decision with forced code diagnostics after an edit", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }));
    await fs.writeFile(path.join(workspaceRoot, "src", "index.ts"), "export const value: number = 1;\n");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true } }, dataDir);
    let modelCall = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "修改 TypeScript", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCall += 1;
        if (modelCall === 1) return {
          text: "",
          toolCall: { name: "edit_file", arguments: { relativePath: "src/index.ts", oldText: "= 1", newText: "= 'broken'" } },
          usage: null,
        };
        expect(modelInput.allowedAgentTools).toContain("code_diagnostics");
        return { text: "修改完成，但我没有运行诊断。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "修改完成，但我没有运行诊断。" });
    expect(modelCall).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.some((event) => event.type === "toolResult" && event.data?.name === "code_diagnostics")).toBe(false);
  }, 15_000);

  it("lets the model choose code diagnostics and reason from the real diagnostic result", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }));
    await fs.writeFile(path.join(workspaceRoot, "src", "index.ts"), "export const value: number = 1;\n");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true } }, dataDir);
    let modelCall = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "修改 TypeScript 并自行判断如何验证", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCall += 1;
        if (modelCall === 1) return {
          text: "",
          toolCall: { name: "edit_file", arguments: { relativePath: "src/index.ts", oldText: "= 1", newText: "= 'broken'" } },
          usage: null,
        };
        if (modelCall === 2) return {
          text: "",
          toolCall: { name: "code_diagnostics", arguments: { relativePaths: ["src/index.ts"] } },
          usage: null,
        };
        expect(modelInputText(modelInput)).toContain("2322");
        return { text: "诊断发现类型错误，不能声称修改成功。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "诊断发现类型错误，不能声称修改成功。" });
    expect(modelCall).toBe(3);
  }, 15_000);

  it("lets the unified Project Agent navigate code semantically before answering", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({ include: ["src/**/*.ts"] }));
    await fs.writeFile(path.join(workspaceRoot, "src", "definition.ts"), "export function target() { return 1; }\n");
    await fs.writeFile(path.join(workspaceRoot, "src", "usage.ts"), "import { target } from './definition';\nexport const value = target();\n");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "target 定义在哪里？", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCall: {
            name: "code_intelligence",
            arguments: { operation: "goToDefinition", filePath: "src/usage.ts", line: 2, character: 22 },
          },
          usage: null,
        };
        expect(modelInputText(modelInput)).toContain("src/definition.ts");
        return { text: "target 定义在 src/definition.ts 第 1 行。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "target 定义在 src/definition.ts 第 1 行。" });
    expect(modelCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "code_intelligence")?.data?.output)
      .toMatchObject({ items: [expect.objectContaining({ file: "src/definition.ts", line: 1 })] });
  });

  it("executes every native tool call in one model batch before requesting the next response", async () => {
    await fs.writeFile(path.join(workspaceRoot, "a.ts"), "export const a = 1;\n");
    await fs.writeFile(path.join(workspaceRoot, "b.ts"), "export const b = 2;\n");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "同时检查两个文件", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "",
            toolCall: { name: "read_file", arguments: { relativePath: "a.ts" } },
            toolCalls: [
              { name: "read_file", arguments: { relativePath: "a.ts" } },
              { name: "read_file", arguments: { relativePath: "b.ts" } },
            ],
            usage: null,
          };
        }
        expect(modelInputText(modelInput)).toContain("export const a = 1");
        expect(modelInputText(modelInput)).toContain("export const b = 2");
        return { text: "两个文件均已检查。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "两个文件均已检查。" });
    expect(modelCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolResult").map((event) => event.data?.name))
      .toEqual(["read_file", "read_file"]);
  });

  it("starts a streamed concurrency-safe tool before model completion and executes it only once", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    let toolCalls = 0;
    let markToolStarted!: () => void;
    const toolStarted = new Promise<void>((resolve) => { markToolStarted = resolve; });

    const result = await runProjectAgentTurn({ projectId, prompt: "读取流式到达的文件", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          const toolCall = { name: "read_file", arguments: { relativePath: "streamed.ts" } };
          modelInput.onToolCallComplete?.(toolCall, 0);
          await toolStarted;
          return { text: "", toolCalls: [toolCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("streamed content");
        return { text: "流式读取完成。", usage: null };
      },
      executeTool: async (toolInput) => {
        toolCalls += 1;
        expect(toolInput.name).toBe("read_file");
        markToolStarted();
        return {
          content: "streamed content",
          startLine: 1,
          endLine: 1,
          totalLines: 1,
          relativePath: "streamed.ts",
        } as never;
      },
    });

    expect(result.answer).toBe("流式读取完成。");
    expect(modelCalls).toBe(2);
    expect(toolCalls).toBe(1);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolCall" && event.data?.name === "read_file"))
      .toHaveLength(1);
    expect(session.events.filter((event) => event.type === "toolResult" && event.data?.name === "read_file"))
      .toHaveLength(1);
  });

  it("settles and applies a streamed blocking file mutation exactly once", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true } }, dataDir);
    let modelCalls = 0;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
    const writeCall = {
      name: "write_file",
      arguments: { relativePath: "streamed-write.txt", content: "written once\n" },
    };

    const result = await runProjectAgentTurn({ projectId, prompt: "写入一个文件", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          modelInput.onToolCallComplete?.(writeCall, 0);
          markWriteStarted();
          await writeStarted;
          return { text: "", toolCalls: [writeCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("streamed-write.txt");
        expect(modelInputText(modelInput)).toContain("applied");
        return { text: "文件已写入。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "文件已写入。" });
    expect(modelCalls).toBe(2);
    await expect(fs.readFile(path.join(workspaceRoot, "streamed-write.txt"), "utf8"))
      .resolves.toBe("written once\n");
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolCall" && event.data?.name === "write_file"))
      .toHaveLength(1);
    expect(session.events.filter((event) => event.type === "toolResult" && event.data?.name === "write_file"))
      .toEqual([expect.objectContaining({ data: expect.objectContaining({ status: "succeeded" }) })]);
  });

  it("persists a streamed TaskCreate update before the model continues", async () => {
    let modelCalls = 0;
    const taskCall = {
      name: "task_create",
      arguments: {
        subject: "完成统一调度",
        description: "检查流式队列并完成统一调度",
        activeForm: "正在完成统一调度",
      },
    };

    const result = await runProjectAgentTurn({ projectId, prompt: "维护执行计划", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          modelInput.onToolCallComplete?.(taskCall, 0);
          return { text: "", toolCalls: [taskCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("完成统一调度");
        return { text: "计划已更新。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "计划已更新。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.taskPlan).toEqual([
      expect.objectContaining({
        content: "完成统一调度",
        description: "检查流式队列并完成统一调度",
        status: "pending",
      }),
    ]);
    expect(session.events.filter((event) => event.type === "todo")).toHaveLength(1);
    expect(session.events.filter((event) => event.type === "toolResult" && event.data?.name === "task_create"))
      .toHaveLength(1);
  });

  it("starts a proven read-only Shell call during streaming in never-ask mode", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: true } }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "neverAsk" }, dataDir);
    let modelCalls = 0;
    let shellCalls = 0;
    let markShellStarted!: () => void;
    const shellStarted = new Promise<void>((resolve) => { markShellStarted = resolve; });
    const shellCall = {
      name: "shell_command",
      arguments: { executable: "git", args: ["status", "--short"], reason: "检查状态" },
    };

    const result = await runProjectAgentTurn({ projectId, prompt: "检查 Git 状态", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          modelInput.onToolCallComplete?.(shellCall, 0);
          await shellStarted;
          return { text: "", toolCalls: [shellCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("Command completed with exit code 0");
        return { text: "Git 状态已检查。", usage: null };
      },
      executeTool: async () => {
        shellCalls += 1;
        markShellStarted();
        return {
          id: "read-only-shell",
          executable: "git",
          args: ["status", "--short"],
          cwd: workspaceRoot,
          timeoutMs: 30_000,
          reason: "检查状态",
          status: "succeeded",
          exitCode: 0,
          stdout: "",
          stderr: "",
        } as never;
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "Git 状态已检查。" });
    expect(modelCalls).toBe(2);
    expect(shellCalls).toBe(1);
  });

  it("returns an invalid streamed tool call to the model without discarding a valid sibling", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    let readCalls = 0;
    const validCall = { name: "read_file", arguments: { relativePath: "valid.ts" } };
    const invalidCall = { name: "missing_tool", arguments: { value: true } };

    const result = await runProjectAgentTurn({ projectId, prompt: "处理同批工具调用", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          modelInput.onToolCallComplete?.(validCall, 0);
          modelInput.onToolCallComplete?.(invalidCall, 1);
          return { text: "", toolCalls: [validCall, invalidCall], usage: null };
        }
        expect(modelInputText(modelInput)).toContain("valid content");
        expect(modelInputText(modelInput)).toContain("missing_tool 当前不可调用");
        return { text: "已根据工具失败结果修正。", usage: null };
      },
      executeTool: async () => {
        readCalls += 1;
        return {
          content: "valid content",
          startLine: 1,
          endLine: 1,
          totalLines: 1,
          relativePath: "valid.ts",
        } as never;
      },
    });

    expect(result.answer).toBe("已根据工具失败结果修正。");
    expect(modelCalls).toBe(2);
    expect(readCalls).toBe(1);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolResult").map((event) => [
      event.data?.name,
      event.data?.status,
    ])).toEqual([
      ["read_file", "succeeded"],
      ["missing_tool", "failed"],
    ]);
  });

  it("closes an already-started streamed tool when the model stream fails", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });

    await expect(runProjectAgentTurn({ projectId, prompt: "读取后继续", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelInput.onToolCallComplete?.({
          name: "read_file",
          arguments: { relativePath: "stream-failure.ts" },
        }, 0);
        await started;
        throw new Error("provider stream disconnected");
      },
      executeTool: async (toolInput) => {
        toolStarted();
        return new Promise<never>((_resolve, reject) => {
          toolInput.signal?.addEventListener("abort", () => reject(toolInput.signal?.reason), { once: true });
        });
      },
    })).rejects.toMatchObject({ code: "model_failed" });

    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolCall" && event.data?.name === "read_file"))
      .toHaveLength(1);
    expect(session.events.filter((event) => event.type === "toolResult" && event.data?.name === "read_file"))
      .toEqual([expect.objectContaining({
        content: "模型流式响应失败，本次提前启动的工具结果未纳入上下文。",
        data: expect.objectContaining({ status: "interrupted" }),
      })]);
    expect(session.events.at(-1)?.data).toMatchObject({ stage: "failed" });
  });

  it("discards a streamed tool omitted by the final provider response", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => { toolStarted = resolve; });
    let toolCalls = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "直接回答，不需要读取", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelInput.onToolCallComplete?.({
          name: "read_file",
          arguments: { relativePath: "orphaned.ts" },
        }, 0);
        await started;
        return { text: "最终回答不包含工具调用。", usage: null };
      },
      executeTool: async (toolInput) => {
        toolCalls += 1;
        toolStarted();
        return new Promise<never>((_resolve, reject) => {
          toolInput.signal?.addEventListener("abort", () => reject(toolInput.signal?.reason), { once: true });
        });
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "最终回答不包含工具调用。" });
    expect(toolCalls).toBe(1);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolResult" && event.data?.name === "read_file"))
      .toEqual([expect.objectContaining({
        content: "服务商最终响应未包含该工具调用，提前启动的结果已丢弃。",
        data: expect.objectContaining({ status: "interrupted" }),
      })]);
  });

  it("runs concurrency-safe reads together and persists their results in provider order", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const started: string[] = [];
    let releaseBoth!: () => void;
    const bothStarted = new Promise<void>((resolve) => { releaseBoth = resolve; });
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "并行读取两个文件", model }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCalls: [
            { name: "read_file", arguments: { relativePath: "slow.ts" } },
            { name: "read_file", arguments: { relativePath: "fast.ts" } },
          ],
          usage: null,
        };
        return { text: "并行读取完成。", usage: null };
      },
      executeTool: async (toolInput) => {
        const relativePath = String(toolInput.arguments.relativePath);
        started.push(relativePath);
        if (started.length === 2) releaseBoth();
        await bothStarted;
        if (relativePath === "slow.ts") await new Promise<void>((resolve) => setTimeout(resolve, 25));
        return { content: relativePath, startLine: 1, endLine: 1, totalLines: 1, relativePath } as never;
      },
    });

    expect(result.answer).toBe("并行读取完成。");
    expect(started).toEqual(["slow.ts", "fast.ts"]);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolResult").map((event) =>
      (event.data?.output as { relativePath?: string } | undefined)?.relativePath,
    )).toEqual(["slow.ts", "fast.ts"]);
  });

  it("returns one failed parallel read to the model without cancelling its sibling", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "读取存在和缺失的文件", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCalls: [
            { name: "read_file", arguments: { relativePath: "missing.ts" } },
            { name: "read_file", arguments: { relativePath: "present.ts" } },
          ],
          usage: null,
        };
        expect(modelInputText(modelInput)).toContain("missing.ts 不存在");
        expect(modelInputText(modelInput)).toContain("present.ts content");
        return { text: "已读取可用文件，并记录缺失文件。", usage: null };
      },
      executeTool: async (toolInput) => {
        const relativePath = String(toolInput.arguments.relativePath);
        if (relativePath === "missing.ts") throw new Error("missing.ts 不存在");
        return { content: "present.ts content", startLine: 1, endLine: 1, totalLines: 1, relativePath } as never;
      },
    });

    expect(result.answer).toBe("已读取可用文件，并记录缺失文件。");
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "toolResult").map((event) => event.data?.status))
      .toEqual(["failed", "succeeded"]);
  });

  it("runs proven read-only Shell calls concurrently and cancels a sibling after Shell failure", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: true } }, dataDir);
    let modelCalls = 0;
    const started: string[] = [];
    let releaseBoth!: () => void;
    const bothStarted = new Promise<void>((resolve) => { releaseBoth = resolve; });

    const result = await runProjectAgentTurn({ projectId, prompt: "并行检查仓库", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCalls: [
            { name: "shell_command", arguments: { executable: "git", args: ["status", "--short"], reason: "检查状态" } },
            { name: "shell_command", arguments: { executable: "git", args: ["diff", "--stat"], reason: "检查差异" } },
          ],
          usage: null,
        };
        expect(modelInputText(modelInput)).toContain("只读 Shell 失败");
        expect(modelInputText(modelInput)).toContain("failed");
        return { text: "并行检查已结束，并保留失败信息。", usage: null };
      },
      executeTool: async (toolInput) => {
        const verb = String((toolInput.arguments.args as string[])[0]);
        started.push(verb);
        if (started.length === 2) releaseBoth();
        await bothStarted;
        if (verb === "diff") {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          return {
            id: "diff-command",
            executable: "git",
            args: ["diff", "--stat"],
            cwd: workspaceRoot,
            timeoutMs: 30_000,
            reason: "检查差异",
            status: "failed",
            exitCode: 2,
            stderr: "failed",
          } as never;
        }
        await new Promise<void>((resolve, reject) => {
          if (toolInput.signal?.aborted) {
            reject(toolInput.signal.reason ?? new Error("aborted"));
            return;
          }
          const timer = setTimeout(resolve, 5_000);
          toolInput.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(toolInput.signal?.reason ?? new Error("aborted"));
          }, { once: true });
        });
        throw new Error("slow sibling unexpectedly completed");
      },
    });

    expect(result.answer).toBe("并行检查已结束，并保留失败信息。");
    expect(started).toEqual(["status", "diff"]);
    const session = await getProjectAgentSession(projectId, dataDir);
    const results = session.events.filter((event) =>
      event.type === "toolResult" && event.data?.name === "shell_command");
    expect(results.map((event) => event.data?.status)).toEqual(["failed", "failed"]);
    expect(results[0]?.content).toContain("只读 Shell 失败");
    expect((results[1]?.data?.output as { exitCode?: number } | undefined)?.exitCode).toBe(2);
  });

  it("serializes mutating Shell calls and preserves provider order", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true, execute: true } }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "neverAsk" }, dataDir);
    const markerPath = path.join(workspaceRoot, "serialized-shell-marker.txt");
    let modelCalls = 0;
    const startedAt = Date.now();

    const result = await runProjectAgentTurn({ projectId, prompt: "并行运行两个检查", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCalls: [
            {
              name: "shell_command",
              arguments: {
                executable: "node",
                args: ["-e", "setTimeout(() => require('node:fs').writeFileSync('serialized-shell-marker.txt', 'first'), 400)"],
                cwd: ".",
                reason: "运行较慢的兄弟检查",
              },
            },
            {
              name: "shell_command",
              arguments: {
                executable: "node",
                args: ["-e", "setTimeout(() => process.exit(2), 100)"],
                cwd: ".",
                reason: "运行会失败的兄弟检查",
              },
            },
          ],
          usage: null,
        };
        expect(modelInputText(modelInput)).toContain("serialized-shell-marker.txt");
        expect(modelInputText(modelInput)).toContain("failed");
        return { text: "两个命令已按顺序完成，并记录了第二个命令的失败。", usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      answer: "两个命令已按顺序完成，并记录了第二个命令的失败。",
    });
    expect(modelCalls).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(400);
    await expect(fs.readFile(markerPath, "utf8")).resolves.toBe("first");

    const session = await getProjectAgentSession(projectId, dataDir);
    const toolResults = session.events.filter((event) =>
      event.type === "toolResult" && event.data?.name === "shell_command");
    expect(toolResults).toHaveLength(2);
    expect(toolResults.map((event) => event.data?.status)).toEqual(["succeeded", "failed"]);
    expect(toolResults[0]?.content).toContain("succeeded");
    expect(toolResults[1]?.content).toContain("failed");
    expect((toolResults[1]?.data?.output as { exitCode?: unknown } | undefined)?.exitCode).toBe(2);

    const execution = await getAgentExecution(projectId, String(result.executionId), dataDir);
    expect(execution?.commandRequests.map((command) => command.status)).toEqual(["succeeded", "failed"]);
  }, 15_000);

  it("lets the ChatGPT Project Agent choose local web tools instead of runtime keyword routing", async () => {
    const chatGptProvider = createChatGptProvider();
    chatGptProvider.modelMapping.main = "gpt-5.6-sol";
    chatGptProvider.models = [{
      id: "gpt-5.6-sol",
      enabled: true,
      modalities: ["text", "tool"],
    }];
    await updateLocalSettings({ modelProviders: [chatGptProvider] }, dataDir);
    const managedModel = getProviderModelSelections([chatGptProvider], "text")[0]!.id;
    const prompts: string[] = [];
    const candidate = "https://weather.example.org/shanghai";
    const toolCalls: string[] = [];
    let modelCalls = 0;

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "帮我查一下最近上海受台风影响的新闻",
      model: managedModel,
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        prompts.push(input.prompt);
        expect(input.allowedAgentTools).toEqual(expect.arrayContaining(["web_search", "web_fetch"]));
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "web_search", arguments: { query: "上海 台风 近期影响" } }, usage: null };
        }
        if (modelCalls === 2) {
          return { text: "", toolCall: { name: "web_fetch", arguments: { url: candidate, prompt: "提取近期影响" } }, usage: null };
        }
        return { text: "根据已读取页面，上海近期受到台风外围影响。", usage: null };
      },
      executeTool: async (toolInput) => {
        toolCalls.push(toolInput.name);
        if (toolInput.name === "web_search") return { query: "上海 台风 近期影响", sources: [candidate] } as never;
        if (toolInput.name === "web_fetch") return {
          summary: "上海近期受到台风外围影响。",
          claims: [{ claim: "上海近期受到台风外围影响。" }],
          contentType: "text/html",
          finalUrl: candidate,
          truncated: false,
        } as never;
        throw new Error("unexpected tool");
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      answer: "根据已读取页面，上海近期受到台风外围影响。",
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).not.toContain("服务商会在请求需要最新网页信息时自动提供托管网页检索结果");
    expect(prompts[0]).toContain("web_search 用于发现未知候选 URL");
    expect(toolCalls).toEqual(["web_search", "web_fetch"]);
  });

  it("treats search results as private candidates and lets evidence sufficiency drive source count", async () => {
    const candidateOne = "https://news.example.com/one";
    const candidateTwo = "https://official.example.org/two";
    const modelPrompts: string[] = [];
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查一下今天上海的新闻", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        if (toolInput.name === "web_search") {
          return { query: "上海新闻", sources: [candidateOne, candidateTwo] } as never;
        }
        if (toolInput.name === "web_fetch") {
          const url = String(toolInput.arguments.url);
          return {
            summary: url === candidateOne ? "上海今天发布了新的公共信息。" : "另一独立来源确认了该信息。",
            claims: [{ claim: "上海今天发布了新的公共信息。", date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()) }],
            contentType: "text/html",
            finalUrl: url,
            title: "上海新闻",
            truncated: false,
          } as never;
        }
        throw new Error("unexpected tool");
      },
      callModel: async (call) => {
        modelCall += 1;
        modelPrompts.push(call.prompt);
        if (modelCall === 1) {
          return {
            text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "上海新闻" } }),
            usage: null,
          };
        }
        if (modelCall === 2) {
          return {
            text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: candidateOne, prompt: "提取上海今天的公共信息" } }),
            usage: null,
          };
        }
        return { text: "根据已读取的权威一手来源，上海今天发布了新的公共信息；当前结论仅基于该直接来源。", usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      answer: "根据已读取的权威一手来源，上海今天发布了新的公共信息；当前结论仅基于该直接来源。",
    });
    expect(modelPrompts[1]).toContain("本轮已搜索 1 个查询并读取 0 个页面");
    expect(modelPrompts[2]).toContain("自行根据问题风险、证据质量和冲突情况决定是否继续检索");
    expect(modelPrompts[2]).toContain("不按固定来源数或关键词规则停止");
    const session = await getProjectAgentSession(projectId, dataDir);
    const searchResult = session.events.find((event) => event.type === "toolResult" && event.data?.name === "web_search");
    expect(searchResult?.content).toBe("网页搜索完成，发现 2 个候选来源；重要事实仍需读取正文验证。");
    expect(session.events.find((event) => event.type === "thinking")?.content).toContain("归纳、去重");
    expect(session.events.filter((event) => event.type === "assistant")).toHaveLength(1);
  });

  it("lets the model choose an unfetched candidate after search", async () => {
    const candidate = "https://official.example.org/report";
    const tools: string[] = [];
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查一下最近上海的天气新闻", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        tools.push(toolInput.name);
        if (toolInput.name === "web_search") return { query: "上海天气", sources: [candidate] } as never;
        if (toolInput.name === "web_fetch") return {
          summary: "上海近期有大风降雨。",
          claims: [{ claim: "上海近期有大风降雨。" }],
          contentType: "text/html",
          finalUrl: candidate,
          title: "天气通报",
          truncated: false,
        } as never;
        throw new Error("unexpected tool");
      },
      callModel: async () => {
        modelCall += 1;
        if (modelCall === 1) return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "上海天气 最新消息" } }), usage: null };
        if (modelCall === 2) return { text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: candidate, prompt: "提取上海近期天气影响" } }), usage: null };
        return { text: "根据已读取的直接来源，上海近期有大风降雨。", usage: null };
      },
    });

    expect(result.answer).toContain("大风降雨");
    expect(tools).toEqual(["web_search", "web_fetch"]);
  });

  it("continues research with another candidate when one page cannot be fetched", async () => {
    const unavailable = "https://weather.example.org/unavailable";
    const available = "https://official.example.org/report";
    const tools: Array<{ name: string; url?: string }> = [];
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查一下最近上海的台风新闻", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        tools.push({ name: toolInput.name, url: typeof toolInput.arguments.url === "string" ? toolInput.arguments.url : undefined });
        if (toolInput.name === "web_search") return { query: "上海台风", sources: [unavailable, available] } as never;
        if (toolInput.name === "web_fetch" && toolInput.arguments.url === unavailable) throw new Error("网页连接失败");
        if (toolInput.name === "web_fetch") return {
          summary: "上海近期受到台风外围影响。",
          claims: [{ claim: "上海近期受到台风外围影响。" }],
          contentType: "text/html",
          finalUrl: available,
          title: "官方通报",
          truncated: false,
        } as never;
        throw new Error("unexpected tool");
      },
      callModel: async () => {
        modelCall += 1;
        if (modelCall === 1) return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "上海台风 最新消息" } }), usage: null };
        if (modelCall === 2) return {
          text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: unavailable, prompt: "提取台风影响" } }),
          usage: null,
        };
        if (modelCall === 3) return {
          text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: available, prompt: "提取台风影响" } }),
          usage: null,
        };
        return { text: "根据已读取的官方通报，上海近期受到台风外围影响。", usage: null };
      },
    });

    expect(result.answer).toContain("台风外围影响");
    expect(tools).toEqual([
      { name: "web_search", url: undefined },
      { name: "web_fetch", url: unavailable },
      { name: "web_fetch", url: available },
    ]);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.at(-1)?.data?.stage).toBe("completed");
  });

  it("lets the model continue research after older evidence instead of applying runtime source-count rules", async () => {
    const stale = "https://news.example.com/july-event";
    const fresh = "https://weather.example.org/august-event";
    let modelCall = 0;
    let searchCount = 0;
    const modelPrompts: string[] = [];
    const result = await runProjectAgentTurn({ projectId, prompt: "帮我查一下最近上海受台风影响的新闻", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        if (toolInput.name === "web_search") {
          searchCount += 1;
          return { query: String(toolInput.arguments.query), sources: searchCount === 1 ? [stale] : [fresh] } as never;
        }
        if (toolInput.name === "web_fetch") {
          const url = String(toolInput.arguments.url);
          return url === stale
            ? { summary: "7月11日旧台风影响上海。", claims: [{ claim: "旧事件", date: "2026-07-11" }], contentType: "text/html", finalUrl: url, truncated: false }
            : { summary: "8月11日白海豚残留云系影响华东。", claims: [{ claim: "上海周边出现新一轮降雨影响", date: "2026-08-11" }], contentType: "text/html", finalUrl: url, truncated: false } as never;
        }
        throw new Error("unexpected tool");
      },
      callModel: async (call) => {
        modelCall += 1;
        modelPrompts.push(call.prompt);
        if (modelCall === 1) return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "上海 台风 近期影响" } }), usage: null };
        if (modelCall === 2) return { text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: stale, prompt: "提取近期上海台风影响与日期" } }), usage: null };
        if (modelCall === 3) return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "2026年8月11日 上海 白海豚 台风 影响" } }), usage: null };
        if (modelCall === 4) return { text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: fresh, prompt: "核实8月11日事件及上海周边影响" } }), usage: null };
        return { text: "更新：8月11日仍有台风“白海豚”残留云系带来的相关天气影响。", usage: null };
      },
    });

    expect(result.answer).toContain("8月11日");
    expect(searchCount).toBe(2);
    expect(modelPrompts[2]).toContain("本轮已搜索 1 个查询并读取 1 个页面");
    expect(modelPrompts[2]).toContain("把这些数据视为当前 observation，自行判断下一步");
  });

  it("allows citations returned by web search without domain-specific URL mapping", async () => {
    const fetched = "https://news.example.com/fetched";
    const unfetched = "https://news.example.com/unfetched";
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查一下这个指定网页的内容", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        if (toolInput.name === "web_search") return { query: "最新报道", sources: [fetched, unfetched] } as never;
        return { summary: "正文摘要", claims: [{ claim: "事实" }], contentType: "text/html", finalUrl: fetched, truncated: false } as never;
      },
      callModel: async () => {
        modelCall += 1;
        if (modelCall === 1) return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "最新报道" } }), usage: null };
        if (modelCall === 2) return { text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: fetched, prompt: "提取报道事实" } }), usage: null };
        return { text: `检索来源：[来源](${unfetched})`, usage: null };
      },
    });

    expect(result.answer).toBe(`检索来源：[来源](${unfetched})`);
    expect(modelCall).toBe(3);
  });

  it("retries an unsupported citation once and then removes only the unverified link", async () => {
    const source = "https://source.example.org/report";
    const invented = "https://invented.example.org/report";
    const prompts: string[] = [];
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查一下最近的报告", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        if (toolInput.name === "web_search") return { query: "最近的报告", sources: [source] } as never;
        return { summary: "报告摘要", claims: [{ claim: "事实" }], contentType: "text/html", finalUrl: source, truncated: false } as never;
      },
      callModel: async (call) => {
        modelCall += 1;
        prompts.push(call.prompt);
        if (modelCall === 1) return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "最近的报告" } }), usage: null };
        if (modelCall === 2) return { text: JSON.stringify({ type: "tool", name: "web_fetch", arguments: { url: source, prompt: "提取事实" } }), usage: null };
        return { text: `报告结论。[错误来源](${invented})`, usage: null };
      },
    });

    expect(modelCall).toBe(4);
    expect(prompts[3]).toContain("本轮网页工具未返回的来源");
    expect(result.answer).toBe("报告结论。错误来源");
  });

  it("stops deterministically when the configured Agent Turn budget is exhausted", async () => {
    let modelCalls = 0;
    await expect(runProjectAgentTurn({ projectId, prompt: "持续检查项目状态", model }, {
      dataDir,
      maxTurns: 2,
      callModel: async () => {
        modelCalls += 1;
        return { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "持续检查" } }), usage: null };
      },
      executeTool: async () => ({ query: "持续检查", sources: [] }) as never,
    })).rejects.toMatchObject({
      code: "tool_failed",
      message: "Agent Turn 达到 2 轮安全上限",
    });

    expect(modelCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.findLast((event) => event.type === "status")).toMatchObject({
      data: { stage: "failed", error: "Agent Turn 达到 2 轮安全上限" },
    });
  });

  it("feeds an unavailable web tool result back to the model", async () => {
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查一下今天的新闻", model }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? { text: JSON.stringify({ type: "tool", name: "web_search", arguments: { query: "今天的新闻" } }), usage: null }
          : { text: "当前没有配置可用的网页搜索工具，因此无法可靠查询今天的新闻。", usage: null };
      },
    });
    expect(result).toMatchObject({ status: "completed", answer: expect.stringContaining("没有配置可用的网页搜索工具") });
    expect(modelCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "toolCall")?.data?.name).toBe("web_search");
    expect(session.events.find((event) => event.type === "toolResult")).toMatchObject({
      data: { name: "web_search", status: "failed" },
      content: expect.stringContaining("没有配置可用的网页搜索工具"),
    });
    expect(session.events.findLast((event) => event.type === "status")?.data?.stage).toBe("completed");
    const executionId = session.events.find((event) => event.type === "toolCall")?.data?.executionId;
    expect(typeof executionId).toBe("string");
    await expect(getAgentExecution(projectId, String(executionId), dataDir)).resolves.toMatchObject({
      status: "succeeded",
      stage: "completed",
    });
  });

  it("enforces untrusted and neverAsk permission defaults in the runtime", async () => {
    await fs.writeFile(path.join(workspaceRoot, "README.md"), "# Test workspace\n", "utf8");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { gitWrite: true } }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "untrusted" }, dataDir);
    let readModelCall = 0;
    await expect(runProjectAgentTurn({ projectId, prompt: "读取 README", model }, {
      dataDir,
      callModel: async () => {
        readModelCall += 1;
        return readModelCall === 1
          ? { text: JSON.stringify({ type: "tool", name: "read_file", arguments: { relativePath: "README.md" } }), usage: null }
          : { text: "README 已读取。", usage: null };
      },
    })).resolves.toMatchObject({ status: "completed", answer: "README 已读取。" });
    expect(readModelCall).toBe(2);

    let untrustedCalls = 0;
    await expect(runProjectAgentTurn({ projectId, prompt: "在当前目录初始化 git", model }, {
      dataDir,
      callModel: async () => {
        untrustedCalls += 1;
        return {
          text: "",
          toolCall: {
            name: "shell_command",
            arguments: { executable: "git", args: ["init"], reason: "初始化 Git 仓库" },
          },
          usage: null,
        };
      },
    })).resolves.toMatchObject({ status: "waitingApproval" });
    expect(untrustedCalls).toBe(1);
    expect((await getProjectAgentSession(projectId, dataDir)).events.findLast((event) =>
      event.type === "approval" && event.data?.status === "pending",
    )).toBeTruthy();
    await expect(fs.stat(path.join(workspaceRoot, ".git"))).rejects.toThrow();

    await updateLocalSettings({ defaultSessionPermissionMode: "neverAsk" }, dataDir);
    let neverAskCalls = 0;
    const initialized = await runProjectAgentTurn({ projectId, prompt: "在当前目录初始化 git", model, permissionMode: "neverAsk" }, {
      dataDir,
      callModel: async () => {
        neverAskCalls += 1;
        return neverAskCalls === 1
          ? {
              text: "",
              toolCall: {
                name: "shell_command",
                arguments: { executable: "git", args: ["init"], reason: "初始化 Git 仓库" },
              },
              usage: null,
            }
          : { text: "Git 仓库已初始化。", usage: null };
      },
    });
    expect(initialized).toMatchObject({ status: "completed", answer: "Git 仓库已初始化。" });
    expect(neverAskCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.findLast((event) => event.type === "approval")?.data?.status).toBe("pending");
    await expect(getAgentExecution(projectId, String(initialized.executionId), dataDir)).resolves.toMatchObject({
      status: "succeeded",
      stage: "completed",
      commandRequests: [expect.objectContaining({ status: "succeeded" })],
    });
    await expect(fs.stat(path.join(workspaceRoot, ".git"))).resolves.toMatchObject({});

  }, 30_000);

  it("uses the generic Shell lifecycle for a development server without service-specific tools", async () => {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
      scripts: {
        dev: "node -e \"const server=require('http').createServer((request,response)=>response.end('ok')); server.listen(0,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port+'/'))\"",
      },
    }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true, execute: true } }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "neverAsk" }, dataDir);
    let taskId = "";
    try {
      let modelCalls = 0;
      const result = await runProjectAgentTurn({ projectId, prompt: "启动开发模式", model }, {
        dataDir,
        callModel: async (input) => {
          modelCalls += 1;
          expect(input.allowedAgentTools).toEqual(expect.arrayContaining([
            "shell_command",
            "write_file",
            "enter_plan_mode",
          ]));
          expect(input.allowedAgentTools).not.toContain("exit_plan_mode");
          expect(input.prompt).not.toContain("启动开发模式只是一次 Shell 任务");
          expect(input.prompt).not.toContain("不得再次启动、重启或扫描端口");
          expect(input.prompt).not.toContain("严格返回：{\"type\":\"command\"");
          expect(input.prompt).toContain("需要真实执行命令时调用 shell_command");
          expect(input.prompt).toContain("Browser 只操作用户提供或工具输出中真实出现的 URL");
          if (modelCalls === 1) {
            return {
              text: "",
              toolCall: {
                name: "shell_command",
                arguments: {
                  executable: "node",
                  args: ["-e", "const server=require('http').createServer((request,response)=>response.end('ok')); server.listen(0,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+server.address().port+'/'))"],
                  cwd: ".",
                  reason: "启动开发模式",
                },
              },
              usage: null,
            };
          }
          expect(modelInputText(input)).toContain("http://127.0.0.1:");
          return { text: "开发模式已启动：http://127.0.0.1:5173/", usage: null };
        },
      });

      expect(result).toMatchObject({
        status: "completed",
        answer: "开发模式已启动：http://127.0.0.1:5173/",
      });
      expect(modelCalls).toBe(2);
      const session = await getProjectAgentSession(projectId, dataDir);
      expect(session.events.filter((event) => event.type === "toolResult").map((event) => event.data?.name))
        .toEqual(["shell_command"]);
      expect(session.events.find((event) => event.type === "approval")).toBeUndefined();
      const commandResult = session.events.find((event) => event.type === "toolResult" && event.data?.name === "shell_command");
      const commandProgress = session.events.find((event) => event.type === "toolCall" && event.data?.name === "shell_command");
      expect(commandProgress).toMatchObject({
        content: expect.stringContaining("Local: http://127.0.0.1:"),
        data: { progress: true, elapsedMs: expect.any(Number), outputFilePath: expect.any(String) },
      });
      const output = commandResult?.data?.output as { id?: unknown } | undefined;
      taskId = typeof output?.id === "string" ? output.id : "";
      expect(taskId).not.toBe("");
    } finally {
      if (taskId) await stopAgentBackgroundTask(projectId, taskId, dataDir).catch(() => undefined);
    }
  }, 70_000);

  it("does not replace repeated Shell calls with a synthetic reused-task result", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true, execute: true } }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "neverAsk" }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "连续检查两次 Node 版本", model }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls >= 3) return { text: "两次检查均已完成。", usage: null };
        return {
          text: "",
          toolCall: {
            name: "shell_command",
            arguments: { executable: "node", args: ["--version"], cwd: ".", reason: "检查 Node 版本" },
          },
          usage: null,
        };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "两次检查均已完成。" });
    expect(modelCalls).toBe(3);
    const session = await getProjectAgentSession(projectId, dataDir);
    const results = session.events.filter((event) => event.type === "toolResult" && event.data?.name === "shell_command");
    expect(results).toHaveLength(2);
    expect(results.every((event) => event.data?.reusedBackgroundTaskId === undefined)).toBe(true);
  }, 40_000);

  it("does not convert a missing preview URL into a terminal tool failure", async () => {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const executionId = (await createAgentExecution({
      projectId,
      instruction: "启动开发服务",
      resultNodeId: "previous-turn",
      triggerNodeId: "previous-turn",
    }, dataDir)).detail.id;
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "pnpm",
      args: ["run", "dev"],
      reason: "启动开发服务",
      background: true,
    }, dataDir);
    await updateAgentCommandRequest(projectId, executionId, command.id, (current) => {
      current.status = "succeeded";
      current.stdout = "开发任务已经退出，但没有输出预览地址";
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
    }, dataDir);

    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "打开刚才启动的页面", model }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        return { text: "后台任务已结束，但没有输出可打开的预览地址。", usage: null };
      },
    });

    expect(modelCalls).toBe(1);
    expect(result).toMatchObject({
      status: "completed",
      answer: "后台任务已结束，但没有输出可打开的预览地址。",
    });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.type === "approval")).toEqual([]);
    expect(session.events.filter((event) => event.type === "toolResult")).toEqual([]);
    expect(session.events.at(-1)).toMatchObject({ type: "status", data: { stage: "completed" } });
  });

  it("discovers and loads a matching project skill inside the same agent turn", async () => {
    const skillDirectory = path.join(workspaceRoot, ".zenme", "skills", "project-audit");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      "name: project-audit",
      "description: Audit the current project",
      "allowed-tools: [Bash(git config:*)]",
      "---",
      "First call workspace_status, then summarize $ARGUMENTS.",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({
      projectId,
      permissions: { write: true, execute: true, gitWrite: true },
    }, dataDir);
    let modelCall = 0;

    const result = await runProjectAgentTurn({ projectId, prompt: "使用项目审计技能检查发布状态", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCall += 1;
        if (modelCall === 1) {
          expect(modelInputText(modelInput)).toContain("project-audit: Audit the current project");
          return {
            text: "",
            toolCall: { name: "skill", arguments: { skill: "project-audit", args: "release" } },
            usage: null,
          };
        }
        if (modelCall === 2) {
          expect(modelInputText(modelInput)).toContain("First call workspace_status, then summarize release.");
          return {
            text: "",
            toolCall: {
              name: "shell_command",
              arguments: { executable: "git", args: ["config", "--list"], reason: "Inspect Git config" },
            },
            usage: null,
          };
        }
        expect(modelInputText(modelInput)).toContain("git config");
        return { text: "技能已加载。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "技能已加载。" });
    expect(modelCall).toBe(3);
    const events = (await getProjectAgentSession(projectId, dataDir)).events;
    expect(events)
      .toContainEqual(expect.objectContaining({ type: "toolResult", data: expect.objectContaining({ name: "skill", status: "succeeded" }) }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "toolResult",
      data: expect.objectContaining({ name: "shell_command", status: "succeeded" }),
    }));
    expect(events.some((event) => event.type === "approval" && event.data?.status === "pending")).toBe(false);
  }, 30_000);

  it("resumes a model-invoked Skill shell expansion after command approval", async () => {
    const skillDirectory = path.join(workspaceRoot, ".zenme", "skills", "runtime-audit");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      "name: runtime-audit",
      "description: Audit the runtime",
      "shell: bash",
      "---",
      "Runtime: !`curl --version | head -n 1`",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({
      projectId,
      permissions: { write: true, execute: true, gitWrite: true },
    }, dataDir);
    let modelCall = 0;
    const callModel = vi.fn(async (modelInput: Parameters<typeof modelInputText>[0]) => {
      modelCall += 1;
      if (modelCall === 1) {
        return { text: "", toolCall: { name: "skill", arguments: { skill: "runtime-audit" } }, usage: null };
      }
      expect(modelInputText(modelInput)).toMatch(/Runtime: curl /i);
      expect(modelInputText(modelInput)).not.toContain("!`curl --version");
      return { text: "运行时信息已载入。", usage: null };
    });

    const first = await runProjectAgentTurn({
      projectId,
      prompt: "使用运行时审计技能",
      model,
      permissionMode: "onRequest",
    }, { dataDir, callModel: callModel as never });
    expect(first).toMatchObject({ status: "waitingApproval" });
    expect(modelCall).toBe(1);
    if (first.status !== "waitingApproval" || !first.executionId) throw new Error("Expected Skill approval");
    await approveAgentCommand(projectId, first.executionId, first.commandRequestId, dataDir);
    await runApprovedAgentCommand({ projectId, executionId: first.executionId, commandId: first.commandRequestId }, dataDir);

    await expect(runProjectAgentTurn({
      projectId,
      turnId: first.turnId,
      prompt: "使用运行时审计技能",
      model,
      permissionMode: "onRequest",
      resume: true,
    }, { dataDir, callModel: callModel as never })).resolves.toMatchObject({
      status: "completed",
      answer: "运行时信息已载入。",
    });
    expect(modelCall).toBe(2);
  }, 60_000);

  it("expands a user slash command before the agent turn without a Skill tool round trip", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "release.md"), [
      "---",
      "description: Prepare release",
      "effort: high",
      "allowed-tools: [Read, Bash(pnpm test:*)]",
      "---",
      "Inspect $0 and prepare $ARGUMENTS.",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let calls = 0;

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "/release desktop beta",
      model,
    }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        expect(input.prompt).toContain("Inspect desktop and prepare desktop beta.");
        expect(input.prompt).not.toContain("/release desktop beta");
        expect(input.reasoningEffort).toBe("high");
        if (calls === 1) {
          return {
            text: "",
            toolCall: { name: "read_file", arguments: { relativePath: "README.md" } },
            usage: null,
          };
        }
        return { text: "发布检查已完成。", usage: null };
      },
      executeTool: async (toolInput) => {
        expect(toolInput.additionalAllowedTools).toEqual(["Read", "Bash(pnpm test:*)"]);
        return {
          relativePath: "README.md",
          content: "release notes",
          startLine: 1,
          endLine: 1,
          totalLines: 1,
          truncated: false,
        } as never;
      },
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({ status: "completed", answer: "发布检查已完成。" });
    const events = (await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.turnId === result.turnId);
    expect(events).toContainEqual(expect.objectContaining({
      type: "user",
      content: "/release desktop beta",
      data: expect.objectContaining({ uiProjection: true }),
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "user",
      content: expect.stringContaining("Inspect desktop and prepare desktop beta."),
      data: expect.objectContaining({
        meta: true,
        skillInvocation: true,
        skill: "release",
        allowedTools: ["Read", "Bash(pnpm test:*)"],
      }),
    }));
    expect(events.some((event) => event.data?.name === "skill")).toBe(false);
  });

  it("runs a direct context-fork slash command without querying the parent model", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "isolated-review.md"), [
      "---",
      "description: Review in a fork",
      "context: fork",
      "disable-model-invocation: true",
      "allowed-tools: [Read]",
      "---",
      "Review $ARGUMENTS in isolation.",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const callModel = vi.fn(async () => ({ text: "parent model must not run", usage: null }));
    const executeTool = vi.fn(async (input: { name: string; arguments: Record<string, unknown>; additionalAllowedTools?: string[] }) => {
      expect(input).toMatchObject({
        name: "skill",
        arguments: { skill: "isolated-review", args: "the release", invokedBy: "user" },
        additionalAllowedTools: ["Read"],
      });
      return {
        name: "isolated-review",
        forked: true,
        status: "succeeded",
        result: "独立审查已完成。",
      } as never;
    });

    const result = await runProjectAgentTurn({
      projectId,
      prompt: "/isolated-review the release",
      model,
    }, { dataDir, callModel, executeTool: executeTool as never });

    expect(callModel).not.toHaveBeenCalled();
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "completed", answer: "独立审查已完成。" });
    const events = (await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.turnId === result.turnId);
    expect(events).toContainEqual(expect.objectContaining({
      type: "toolResult",
      content: "独立审查已完成。",
      data: expect.objectContaining({ name: "skill", forked: true, status: "succeeded" }),
    }));
  });

  it("registers direct Skill hooks for the current and later Project turns", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "hooked-review.md"), [
      "---",
      "description: Review with a session hook",
      "hooks:",
      "  PreToolUse:",
      "    - matcher: Glob",
      "      hooks:",
      "        - type: http",
      "          url: https://hooks.example.test/skill-glob",
      "        - type: http",
      "          url: https://hooks.example.test/skill-glob-once",
      "          once: true",
      "---",
      "Inspect the project.",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const hookCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      hookCalls.push(String(url));
      return new Response(null, { status: 204 });
    }));
    const inspectThenFinish = () => {
      let calls = 0;
      return async () => {
        calls += 1;
        return calls === 1
          ? { text: "", toolCall: { name: "glob_files", arguments: { pattern: "**/*.ts" } }, usage: null }
          : { text: "检查完成。", usage: null };
      };
    };

    await expect(runProjectAgentTurn({ projectId, prompt: "/hooked-review", model }, {
      dataDir,
      callModel: inspectThenFinish() as never,
    })).resolves.toMatchObject({ status: "completed", answer: "检查完成。" });
    await expect(runProjectAgentTurn({ projectId, prompt: "再检查一次", model }, {
      dataDir,
      callModel: inspectThenFinish() as never,
    })).resolves.toMatchObject({ status: "completed", answer: "检查完成。" });

    expect(hookCalls).toEqual([
      "https://hooks.example.test/skill-glob",
      "https://hooks.example.test/skill-glob-once",
      "https://hooks.example.test/skill-glob",
    ]);
    expect((await getProjectAgentSession(projectId, dataDir)).context.skillHooks).toMatchObject({
      PreToolUse: [expect.objectContaining({
        matcher: "Glob",
        skillRoot: expect.stringContaining(".claude"),
      })],
    });
    expect((await getProjectAgentSession(projectId, dataDir)).context.consumedHookIds).toHaveLength(1);
  }, 30_000);

  it("expands direct Slash Command shell expressions before querying the model", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "runtime-info.md"), [
      "---",
      "shell: powershell",
      "---",
      "Runtime: !`Write-Output 7.4`",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const executeTool = vi.fn(async (toolInput: { name: string; arguments: Record<string, unknown> }) => {
      expect(toolInput).toMatchObject({
        name: "shell_command",
        arguments: { command: "Write-Output 7.4", shell: "powershell" },
      });
      return {
        id: "prompt-shell-command",
        executable: "powershell",
        args: ["-Command", "Write-Output 7.4"],
        command: "Write-Output 7.4",
        cwd: ".",
        timeoutMs: 120_000,
        reason: "Expand Skill prompt",
        status: "succeeded",
        stdout: "7.4\n",
        stderr: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });
    const callModel = vi.fn(async (request: { prompt: string }) => {
      expect(request.prompt).toContain("Runtime: 7.4");
      expect(request.prompt).not.toContain("!`Write-Output 7.4`");
      return { text: "已读取运行时信息。", usage: null };
    });

    await expect(runProjectAgentTurn({ projectId, prompt: "/runtime-info", model }, {
      dataDir,
      callModel: callModel as never,
      executeTool: executeTool as never,
    })).resolves.toMatchObject({ status: "completed", answer: "已读取运行时信息。" });
    expect(executeTool).toHaveBeenCalledOnce();
    expect(callModel).toHaveBeenCalledOnce();
    const meta = (await getProjectAgentSession(projectId, dataDir)).events.find((event) =>
      event.type === "user" && event.data?.skillInvocation === true);
    expect(meta).toMatchObject({ content: expect.stringContaining("Runtime: 7.4"), data: { promptShellExpanded: true } });
  });

  it("resumes the same direct Slash Command after an embedded shell approval", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "approved-info.md"), [
      "---",
      "shell: powershell",
      "---",
      "Approved value: !`Get-ApprovedValue`",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let commandExecutionId = "";
    const executeTool = vi.fn(async (toolInput: { executionId: string }) => {
      commandExecutionId = toolInput.executionId;
      const now = new Date().toISOString();
      const command = {
        id: "approved-prompt-shell",
        executable: "powershell",
        args: ["-Command", "Get-ApprovedValue"],
        command: "Get-ApprovedValue",
        cwd: ".",
        timeoutMs: 120_000,
        reason: "Expand Skill prompt",
        status: "proposed" as const,
        requiresExplicitApproval: true,
        sandboxMode: "danger-full-access" as const,
        createdAt: now,
        updatedAt: now,
      };
      await addAgentCommandRequest(projectId, commandExecutionId, command, dataDir);
      return command;
    });
    const callModel = vi.fn(async (request: { prompt: string }) => {
      expect(request.prompt).toContain("Approved value: ready");
      return { text: "审批后的命令输出已载入。", usage: null };
    });

    const first = await runProjectAgentTurn({ projectId, prompt: "/approved-info", model }, {
      dataDir,
      callModel: callModel as never,
      executeTool: executeTool as never,
    });
    expect(first).toMatchObject({
      status: "waitingApproval",
      executionId: commandExecutionId,
      commandRequestId: "approved-prompt-shell",
    });
    expect(callModel).not.toHaveBeenCalled();
    await updateAgentCommandRequest(projectId, commandExecutionId, "approved-prompt-shell", (command) => {
      command.status = "succeeded";
      command.stdout = "ready\n";
      command.stderr = "";
      command.exitCode = 0;
      command.completedAt = new Date().toISOString();
      command.updatedAt = command.completedAt;
    }, dataDir);

    await expect(runProjectAgentTurn({
      projectId,
      turnId: first.turnId,
      prompt: "/approved-info",
      model,
      resume: true,
    }, {
      dataDir,
      callModel: callModel as never,
      executeTool: executeTool as never,
    })).resolves.toMatchObject({ status: "completed", answer: "审批后的命令输出已载入。" });
    expect(executeTool).toHaveBeenCalledOnce();
    expect(callModel).toHaveBeenCalledOnce();
  }, 30_000);

  it("pauses a direct context-fork slash command when its sub-agent needs approval", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "fork-write.md"), [
      "---",
      "description: Write in a fork",
      "context: fork",
      "---",
      "Perform the requested write.",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const callModel = vi.fn(async () => ({ text: "parent model must not run", usage: null }));
    const executeTool = vi.fn(async () => ({
      name: "fork-write",
      forked: true,
      orchestrationId: "fork-orchestration",
      agentId: "fork-execution",
      status: "waitingApproval",
      result: "等待命令审批",
      pendingCommand: {
        id: "fork-command",
        executable: "git",
        args: ["init"],
        cwd: workspaceRoot,
        reason: "初始化 Git",
        externalRoot: false,
        sandboxMode: "workspaceWrite",
      },
    } as never));

    const result = await runProjectAgentTurn({ projectId, prompt: "/fork-write", model }, {
      dataDir,
      callModel,
      executeTool: executeTool as never,
    });

    expect(callModel).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "waitingApproval",
      executionId: "fork-execution",
      commandRequestId: "fork-command",
    });
    const events = (await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.turnId === result.turnId);
    expect(events).toContainEqual(expect.objectContaining({
      type: "approval",
      data: expect.objectContaining({
        executionId: "fork-execution",
        commandRequestId: "fork-command",
        orchestrationId: "fork-orchestration",
      }),
    }));
    expect(events.at(-1)).toMatchObject({ type: "status", data: { stage: "waitingApproval" } });
  });

  it("resumes an approved direct context-fork slash command without querying the parent model", async () => {
    const commandDirectory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(commandDirectory, { recursive: true });
    await fs.writeFile(path.join(commandDirectory, "fork-command.md"), [
      "---",
      "description: Run an isolated command",
      "context: fork",
      "allowed-tools: [shell_command]",
      "---",
      "Run the requested command and report the result.",
    ].join("\n"));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "untrusted" }, dataDir);
    const turnId = "direct-fork-approval-resume";
    let childCalls = 0;
    let parentCalls = 0;
    const callModel = async (input: { context: string; allowedAgentTools?: string[] }) => {
      if (isOneOffSubagentContext(input.context)) {
        childCalls += 1;
        return childCalls === 1
          ? {
              text: "",
              toolCall: {
                name: "shell_command",
                arguments: {
                  executable: "powershell",
                  args: ["-NoProfile", "-Command", "Write-Output fork-approved"],
                  reason: "验证 fork 审批恢复",
                },
              },
              usage: null,
            }
          : { text: "隔离命令已执行完成。", usage: null };
      }
      parentCalls += 1;
      return { text: "父模型不应运行。", usage: null };
    };

    const first = await runProjectAgentTurn({
      projectId,
      prompt: "/fork-command",
      model,
      turnId,
    }, { dataDir, callModel: callModel as never });
    expect(first).toMatchObject({ status: "waitingApproval" });
    const waitingSession = await getProjectAgentSession(projectId, dataDir);
    const approval = waitingSession.events.find((event) =>
      event.turnId === turnId && event.type === "approval" && event.data?.status === "pending");
    const childExecutionId = String(approval!.data!.executionId);
    const commandRequestId = String(approval!.data!.commandRequestId);
    await approveAgentCommand(projectId, childExecutionId, commandRequestId, dataDir);
    await runApprovedAgentCommand({ projectId, executionId: childExecutionId, commandId: commandRequestId }, dataDir);

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "/fork-command",
      model,
      turnId,
      resume: true,
    }, { dataDir, callModel: callModel as never });

    expect(resumed).toMatchObject({ status: "completed", answer: "隔离命令已执行完成。" });
    expect(parentCalls).toBe(0);
    expect(childCalls).toBe(2);
    const completedEvents = (await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.turnId === turnId);
    expect(completedEvents.filter((event) => event.type === "toolResult" && event.data?.name === "skill")).toHaveLength(2);
    expect(completedEvents.findLast((event) => event.type === "assistant")?.content).toBe("隔离命令已执行完成。");
  }, 30_000);

  it("reopens the agent loop when a background task terminal notification arrives", async () => {
    const notificationHook = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response("", { status: 204 });
    });
    vi.stubGlobal("fetch", notificationHook);
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.json"), JSON.stringify({
      hooks: {
        Notification: [{
          matcher: "^background_task$",
          hooks: [{ type: "http", url: "https://hooks.example/background" }],
        }],
      },
    }));
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
      scripts: {
        short: "node -e \"setTimeout(() => { console.log('background-finished'); process.exit(0) }, 1200)\"",
      },
    }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { read: true, write: true, execute: true } }, dataDir);
    let modelCall = 0;
    const result = await runProjectAgentTurn({
      projectId,
      conversationId: "background-conversation",
      sourceNodeId: "background-node",
      currentNodeContext: "CURRENT_BACKGROUND_NODE",
      connectedGraphContext: "CONNECTED_BACKGROUND_GRAPH",
      prompt: "启动一个短后台任务",
      model,
    }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCall += 1;
        if (modelCall === 1) {
          return {
              text: "",
              toolCall: {
                name: "shell_command",
                arguments: { executable: "npm", args: ["run", "short"], cwd: ".", run_in_background: true, reason: "运行短后台任务" },
              },
              usage: null,
            };
        }
        if (modelCall === 3) {
          expect(modelInput.context).toContain("CURRENT_BACKGROUND_NODE");
          expect(modelInput.context).toContain("CONNECTED_BACKGROUND_GRAPH");
        }
        return modelCall === 2
          ? { text: "短后台任务已经启动。", usage: null }
          : { text: "短后台任务已经完成。", usage: null };
      },
    });
    expect(result).toMatchObject({ status: "completed", answer: "短后台任务已经启动。" });

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 30 && !session.events.some((event) => event.data?.backgroundTaskNotification === true); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(session.events.find((event) => event.data?.backgroundTaskNotification === true)).toMatchObject({
      turnId: result.turnId,
      type: "toolResult",
      data: {
        name: "shell_command",
        status: "succeeded",
        output: expect.objectContaining({ status: "succeeded", stdout: expect.stringContaining("background-finished") }),
      },
    });
    expect(session.events.find((event) => event.turnId === result.turnId && event.type === "user"))
      .toMatchObject({ conversationId: "background-conversation", sourceNodeId: "background-node" });
    await vi.waitFor(async () => {
      expect(modelCall).toBe(3);
      session = await getProjectAgentSession(projectId, dataDir);
      expect(session.events.findLast((event) => event.turnId === result.turnId && event.type === "status")?.data?.stage)
        .toBe("completed");
    }, { timeout: 5_000 });
    expect(session.events.findLast((event) => event.type === "assistant")?.content).toBe("短后台任务已经完成。");
    await vi.waitFor(() => expect(notificationHook).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(notificationHook).toHaveBeenCalledWith("https://hooks.example/background", expect.objectContaining({
      method: "POST",
      body: expect.any(String),
    }));
    const hookPayload = JSON.parse(String(notificationHook.mock.calls[0]?.[1]?.body));
    expect(hookPayload).toMatchObject({
      hook_event_name: "Notification",
      notification_type: "background_task",
      title: "后台任务已结束",
      message: expect.stringContaining("background-finished"),
    });
    expect(hookPayload).not.toHaveProperty("tool_name");
  }, 30_000);

  it("feeds an interactive background prompt notification into the same Agent turn", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { read: true, execute: true } }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "运行可能要求确认的后台任务", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "",
            toolCall: {
              name: "shell_command",
              arguments: { executable: "npm", args: ["run", "prompt"], run_in_background: true, reason: "运行后台任务" },
            },
            usage: null,
          };
        }
        expect(modelInput.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("后台命令可能正在等待交互输入"),
          }),
        ]));
        expect(JSON.stringify(modelInput.messages)).toContain("Continue?");
        return { text: "检测到交互提示，应停止任务并改用非交互参数。", usage: null };
      },
      executeTool: async (toolInput) => {
        await toolInput.onCommandStall?.({
          commandId: "interactive-task",
          elapsedMs: 45_000,
          outputFilePath: "C:\\tmp\\interactive-task.log",
          tail: "Continue?",
        });
        return {
          id: "interactive-task",
          executable: "npm",
          args: ["run", "prompt"],
          cwd: ".",
          reason: "运行后台任务",
          status: "running",
          background: true,
          outputFilePath: "C:\\tmp\\interactive-task.log",
        } as never;
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      answer: "检测到交互提示，应停止任务并改用非交互参数。",
    });
    expect(modelCalls).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.filter((event) => event.data?.interactivePromptDetected === true)).toHaveLength(1);
  });

  it("reconciles a previous server instance task that was exposed as background even if its legacy background flag is false", async () => {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: true } }, dataDir);
    const turnId = "reconciled-background-turn";
    await appendProjectAgentEvent({ projectId, turnId, type: "user", content: "启动开发服务" }, dataDir);
    const created = await createAgentExecution({
      projectId,
      instruction: "启动开发服务",
      resultNodeId: turnId,
      triggerNodeId: turnId,
    }, dataDir);
    const command = await proposeAgentCommand({
      projectId,
      executionId: created.detail.id,
      executable: "npm",
      args: ["run", "dev"],
      reason: "启动开发服务",
      background: false,
    }, dataDir);
    await updateAgentCommandRequest(projectId, created.detail.id, command.id, (current) => {
      current.status = "running";
      current.runtimeInstanceId = "previous-server-instance";
      current.startedAt = new Date().toISOString();
      current.updatedAt = current.startedAt;
    }, dataDir);
    await appendProjectAgentEvent({
      projectId,
      turnId,
      type: "toolResult",
      data: { name: "run_command", status: "succeeded", output: { id: command.id, status: "running" } },
    }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);

    const legacyDetailPath = path.join(getProjectDir(projectId, dataDir), "executions", "agent", `${created.detail.id}.json`);
    const legacyDetail = JSON.parse(await fs.readFile(legacyDetailPath, "utf8")) as Record<string, unknown>;
    delete legacyDetail.resultNodeId;
    delete legacyDetail.triggerNodeId;
    await fs.writeFile(legacyDetailPath, JSON.stringify(legacyDetail, null, 2), "utf8");

    await expect(getAgentBackgroundTask(projectId, command.id, dataDir)).resolves.toMatchObject({ status: "stopped" });
    await reconcileProjectAgentBackgroundNotifications(projectId, dataDir);

    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.data?.backgroundTaskNotification === true)).toMatchObject({
      turnId,
      type: "toolResult",
      data: {
        name: "shell_command",
        status: "failed",
        reconciled: true,
        output: expect.objectContaining({ id: command.id, status: "stopped" }),
      },
    });
    expect(session.events.at(-1)).toMatchObject({ type: "status", data: { stage: "completed" } });
  });

  it("reconciles the same terminal background task into every Turn that observed it running", async () => {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: true } }, dataDir);
    const firstTurnId = "shared-background-first-turn";
    const secondTurnId = "shared-background-second-turn";
    for (const turnId of [firstTurnId, secondTurnId]) {
      await appendProjectAgentEvent({ projectId, turnId, type: "user", content: "观察开发服务" }, dataDir);
    }
    const created = await createAgentExecution({
      projectId,
      instruction: "启动开发服务",
      resultNodeId: firstTurnId,
      triggerNodeId: firstTurnId,
    }, dataDir);
    const command = await proposeAgentCommand({
      projectId,
      executionId: created.detail.id,
      executable: "npm",
      args: ["run", "dev"],
      reason: "启动开发服务",
      background: true,
    }, dataDir);
    await updateAgentCommandRequest(projectId, created.detail.id, command.id, (current) => {
      current.status = "failed";
      current.error = "开发服务启动失败";
      current.completedAt = new Date().toISOString();
      current.updatedAt = current.completedAt;
    }, dataDir);
    for (const turnId of [firstTurnId, secondTurnId]) {
      await appendProjectAgentEvent({
        projectId,
        turnId,
        type: "toolResult",
        data: { name: "run_command", status: "succeeded", output: { id: command.id, status: "running" } },
      }, dataDir);
      await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { stage: "failed" } }, dataDir);
    }
    await appendProjectAgentEvent({
      projectId,
      turnId: firstTurnId,
      type: "toolResult",
      content: "后台任务失败：开发服务启动失败",
      data: {
        name: "shell_command",
        status: "failed",
        backgroundTaskNotification: true,
        output: { id: command.id, status: "failed" },
      },
    }, dataDir);

    await reconcileProjectAgentBackgroundNotifications(projectId, dataDir);

    const session = await getProjectAgentSession(projectId, dataDir);
    const notifications = session.events.filter((event) =>
      event.data?.backgroundTaskNotification === true &&
      event.data?.output && typeof event.data.output === "object" &&
      (event.data.output as { id?: unknown }).id === command.id);
    expect(notifications.filter((event) => event.turnId === firstTurnId)).toHaveLength(1);
    expect(notifications.filter((event) => event.turnId === secondTurnId)).toHaveLength(1);
  });

  it("reconciles an undelivered terminal Sub-agent run exactly once", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const turnId = "reconciled-subagent-turn";
    await appendProjectAgentEvent({ projectId, turnId, type: "user", content: "并行检查项目" }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: turnId,
      triggerNodeId: turnId,
      parentTurnId: turnId,
      teamName: "reviewers",
    }, dataDir);
    const member = await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "tester",
      instruction: "检查回归测试",
    }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const executionId = dispatched.dispatched.find((task) => task.id === member.id)?.agentExecutionId;
    expect(executionId).toBeTruthy();
    await completeAgentExecution({
      projectId,
      executionId: executionId!,
      status: "succeeded",
      resultSummary: "回归测试检查完成",
    }, dataDir);
    await reconcileProjectAgentBackgroundNotifications(projectId, dataDir);
    await reconcileProjectAgentBackgroundNotifications(projectId, dataDir);

    const session = await getProjectAgentSession(projectId, dataDir);
    const notifications = session.events.filter((event) =>
      event.turnId === turnId && event.data?.backgroundTaskNotification === true && event.data.name === "agent_spawn");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "toolResult",
      content: expect.stringContaining("回归测试检查完成"),
      data: {
        status: "succeeded",
        reconciled: true,
        output: expect.objectContaining({ agentId: member.id, completedAt: expect.any(String) }),
      },
    });
  }, 15_000);

  it("adopts a manually approved background command into terminal notifications only", async () => {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
      scripts: { short: "node -e \"setTimeout(() => { console.log('approved-background-finished'); process.exit(0) }, 800)\"" },
    }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: true } }, dataDir);
    const turnId = "approved-background-turn";
    await appendProjectAgentEvent({ projectId, turnId, type: "user", content: "运行后台任务", data: { model } }, dataDir);
    const created = await createAgentExecution({
      projectId,
      instruction: "运行后台任务",
      resultNodeId: turnId,
      triggerNodeId: turnId,
    }, dataDir);
    const command = await proposeAgentCommand({
      projectId,
      executionId: created.detail.id,
      executable: "npm",
      args: ["run", "short"],
      reason: "运行后台任务",
      background: true,
    }, dataDir);
    await approveAgentCommand(projectId, created.detail.id, command.id, dataDir);
    const output = await runApprovedAgentCommand({
      projectId,
      executionId: created.detail.id,
      commandId: command.id,
    }, dataDir);
    expect(output.status).toBe("running");
    await appendProjectAgentEvent({
      projectId,
      turnId,
      type: "toolResult",
      content: `后台任务已启动：${command.id}`,
      data: { name: "run_command", status: "succeeded", executionId: created.detail.id, output },
    }, dataDir);
    await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);

    const callModel = vi.fn(async () => ({ text: "不应调用模型。", usage: null }));
    await reconcileProjectAgentBackgroundNotifications(projectId, dataDir, { callModel });

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 30 && !session.events.some((event) => event.data?.backgroundTaskNotification === true); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(session.events.find((event) => event.data?.backgroundTaskNotification === true)).toMatchObject({
      turnId,
      type: "toolResult",
      data: { name: "shell_command", status: "succeeded" },
    });
    expect(session.events.findLast((event) => event.type === "assistant")).toBeUndefined();
    expect(callModel).not.toHaveBeenCalled();
  }, 30_000);

  it("auto-runs a validated declared project script in on-request mode", async () => {
    await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
      scripts: { test: "node -e \"console.log('sandbox-test-ok')\"" },
    }));
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "运行项目测试", model }, {
      dataDir,
      callModel: async () => {
        modelCall += 1;
        return modelCall === 1
          ? { text: "", toolCall: { name: "shell_command", arguments: { executable: "npm", args: ["test"], reason: "运行项目测试" } }, usage: null }
          : { text: "项目测试已通过。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "项目测试已通过。" });
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "approval")?.data?.status).toBe("autoApproved");
    expect(session.events.some((event) => event.type === "approval" && event.data?.status === "pending")).toBe(false);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "shell_command")?.content)
      .toContain("sandbox-test-ok");
  }, 30_000);

  it("delegates independent work from the same project-agent turn and waits for collected results", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCall = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "并行检查模块 A 和模块 B", model }, {
      dataDir,
      executeTool: async (toolInput) => {
        expect(toolInput.name).toBe("delegate_tasks");
        expect(toolInput.arguments).toMatchObject({ goal: "检查两个模块", model });
        return {
          orchestrationId: "orchestration-1",
          status: "completed",
          tasks: [
            { id: "a", title: "模块 A", status: "succeeded", resultSummary: "A 正常", changeSetIds: [] },
            { id: "b", title: "模块 B", status: "succeeded", resultSummary: "B 正常", changeSetIds: [] },
          ],
        } as never;
      },
      callModel: async () => {
        modelCall += 1;
        if (modelCall === 1) return {
          text: "",
          toolCall: {
            name: "delegate_tasks",
            arguments: {
              goal: "检查两个模块",
              concurrencyLimit: 2,
              tasks: [
                { title: "模块 A", instruction: "检查 A", allowedPathPrefixes: ["src/a"], allowedTools: ["read_file"] },
                { title: "模块 B", instruction: "检查 B", allowedPathPrefixes: ["src/b"], allowedTools: ["read_file"] },
              ],
            },
          },
          usage: null,
        };
        return { text: "两个模块已并行检查，结果均正常。", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "两个模块已并行检查，结果均正常。" });
    expect(modelCall).toBe(2);
    const session = await getProjectAgentSession(projectId, dataDir);
    expect(session.events.find((event) => event.type === "toolResult" && event.data?.name === "delegate_tasks"))
      .toMatchObject({ data: { status: "succeeded" } });
  });

  it("delivers a completed background Team member as a task notification without model polling", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "src", "index.ts"), "export const value = 1;\n");
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const turnId = "team-notification-turn";
    let parentCalls = 0;
    let childCalls = 0;
    const callModel = async (input: {
      context: string;
      onToolCallComplete?: (toolCall: { name: string; arguments: Record<string, unknown> }, index: number) => void;
    }) => {
      if (isDelegatedSubagentContext(input.context)) {
        childCalls += 1;
        return { text: "后台检查完成，未发现问题。", usage: null };
      }
      parentCalls += 1;
      if (parentCalls === 1) {
        const toolCall = { name: "team_create", arguments: { teamName: "reviewers", description: "持续代码检查" } };
        input.onToolCallComplete?.(toolCall, 0);
        return { text: "", toolCalls: [toolCall], usage: null };
      }
      if (parentCalls === 2) {
        const toolCall = {
          name: "agent_spawn",
          arguments: {
            name: "tester",
            instruction: "检查 src/index.ts",
            allowedPathPrefixes: ["src"],
            allowedTools: ["read_file"],
          },
        };
        input.onToolCallComplete?.(toolCall, 0);
        return { text: "", toolCalls: [toolCall], usage: null };
      }
      return { text: "tester 已在后台检查，我会在完成后收到通知。", usage: null };
    };

    await expect(runProjectAgentTurn({ projectId, prompt: "让 tester 后台检查代码", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    })).resolves.toMatchObject({
      status: "completed",
      answer: "tester 已在后台检查，我会在完成后收到通知。",
    });

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 100 && !session.events.some((event) =>
      event.turnId === turnId && event.data?.backgroundTaskNotification === true && event.data?.name === "agent_spawn"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect({ parentCalls, childCalls }).toEqual({ parentCalls: 3, childCalls: 1 });
    expect(session.events.find((event) =>
      event.turnId === turnId && event.data?.backgroundTaskNotification === true && event.data?.name === "agent_spawn"))
      .toMatchObject({
        type: "toolResult",
        content: expect.stringContaining("后台检查完成"),
        data: { status: "succeeded", output: { name: "tester", status: "succeeded" } },
      });
  }, 30_000);

  it("stops delegated Sub-agents when their parent project turn is stopped", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const turnId = "stop-delegated-turn";
    let releaseChildStarted!: () => void;
    const childStarted = new Promise<void>((resolve) => { releaseChildStarted = resolve; });
    let parentCalls = 0;
    const callModel = async (input: { context: string; allowedAgentTools?: string[]; signal?: AbortSignal }) => {
      if (isOneOffSubagentContext(input.context)) {
        releaseChildStarted();
        return new Promise<never>((_resolve, reject) => {
          const abort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (input.signal?.aborted) abort();
          else input.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      parentCalls += 1;
      return {
        text: "",
        toolCall: {
          name: "delegate_tasks",
          arguments: {
            goal: "持续检查项目",
            tasks: [{
              title: "持续检查",
              instruction: "检查项目直至父任务停止",
              allowedPathPrefixes: ["."],
              allowedTools: ["workspace_status"],
            }],
          },
        },
        usage: null,
      };
    };

    await startProjectAgentTurnRun({ projectId, prompt: "启动持续检查", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    });
    await childStarted;
    expect(stopProjectAgentTurnRun(projectId, turnId, dataDir)).toBe(true);

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 100 && session.events.findLast((event) => event.turnId === turnId && event.type === "status")?.data?.stage !== "stopped"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    const orchestration = (await listGlobalOrchestrations(projectId, dataDir))[0];
    expect(parentCalls).toBe(1);
    expect(orchestration).toMatchObject({
      status: "stopped",
      tasks: [expect.objectContaining({ status: "stopped", agentExecutionId: expect.any(String) })],
    });
    const childExecutionId = orchestration!.tasks[0].agentExecutionId!;
    await expect(getAgentExecution(projectId, childExecutionId, dataDir)).resolves.toMatchObject({ status: "stopped" });
    expect(session.events.findLast((event) => event.turnId === turnId && event.type === "status")?.data?.stage)
      .toBe("stopped");
  }, 30_000);

  it("routes parent Turn steering into a running delegated Sub-agent without restarting it", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    const turnId = "steer-delegated-turn";
    let releaseChild!: () => void;
    let markChildStarted!: () => void;
    const childStarted = new Promise<void>((resolve) => { markChildStarted = resolve; });
    const childRelease = new Promise<void>((resolve) => { releaseChild = resolve; });
    const childContexts: string[] = [];
    let parentCalls = 0;
    const callModel = async (input: { context: string }) => {
      if (isOneOffSubagentContext(input.context)) {
        childContexts.push(input.context);
        if (childContexts.length === 1) {
          markChildStarted();
          await childRelease;
          return { text: "旧方向已完成", usage: null };
        }
        return { text: "已按父 Turn 的补充指令检查边界条件", usage: null };
      }
      parentCalls += 1;
      return parentCalls === 1
        ? {
            text: "",
            toolCall: {
              name: "delegate_tasks",
              arguments: {
                goal: "检查模块 A",
                tasks: [{
                  title: "检查 A",
                  instruction: "检查模块 A",
                  allowedPathPrefixes: ["src/a"],
                  allowedTools: ["read_file"],
                }],
              },
            },
            usage: null,
          }
        : { text: "子任务已根据补充指令完成。", usage: null };
    };

    await startProjectAgentTurnRun({ projectId, prompt: "检查模块 A", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    });
    await childStarted;
    await steerProjectAgentTurnRun({ projectId, turnId, prompt: "改为优先检查边界条件" }, dataDir);
    releaseChild();

    let session = await getProjectAgentSession(projectId, dataDir);
    for (let attempt = 0; attempt < 200 && session.events.findLast((event) =>
      event.turnId === turnId && event.type === "status")?.data?.stage !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      session = await getProjectAgentSession(projectId, dataDir);
    }
    expect(childContexts).toHaveLength(2);
    expect(childContexts[1]).toContain("改为优先检查边界条件");
    expect(parentCalls).toBe(2);
    expect(session.events.findLast((event) => event.turnId === turnId && event.type === "assistant")?.content)
      .toBe("子任务已根据补充指令完成。");
  }, 30_000);

  it("surfaces a Sub-agent command approval and resumes the same orchestration in the parent Turn", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "untrusted" }, dataDir);
    const turnId = "delegated-approval-turn";
    let parentCalls = 0;
    let childCalls = 0;
    const childConfiguration: Array<{ reasoningEffort?: string; modelSpeed?: string }> = [];
    const callModel = async (input: { context: string; prompt: string; allowedAgentTools?: string[]; reasoningEffort?: string; modelSpeed?: string }) => {
      if (input.allowedAgentTools?.includes("shell_command") && isOneOffSubagentContext(input.context)) {
        childConfiguration.push({ reasoningEffort: input.reasoningEffort, modelSpeed: input.modelSpeed });
        childCalls += 1;
        return childCalls > 1
          ? { text: "提升权限命令执行完成", usage: null }
          : { text: "", toolCall: { name: "shell_command", arguments: { executable: "powershell", args: ["-NoProfile", "-Command", "Write-Output delegated-ok"], reason: "运行提升权限命令" } }, usage: null };
      }
      parentCalls += 1;
      return parentCalls === 1
        ? {
            text: "",
            toolCall: {
              name: "delegate_tasks",
              arguments: {
                goal: "运行提升权限命令",
                tasks: [{
                  title: "运行命令",
                  instruction: "运行需要提升权限的命令",
                  allowedPathPrefixes: ["."],
                  allowedTools: ["shell_command"],
                }],
              },
            },
            usage: null,
          }
        : { text: "子任务已完成，提升权限命令已执行。", usage: null };
    };

    const first = await runProjectAgentTurn({
      projectId,
      prompt: "并行处理项目初始化准备",
      model,
      turnId,
      reasoningEffort: "xhigh",
      modelSpeed: "fast",
    }, {
      dataDir,
      callModel: callModel as never,
    });
    expect(first).toMatchObject({ status: "waitingApproval" });
    const waitingSession = await getProjectAgentSession(projectId, dataDir);
    const approval = waitingSession.events.find((event) =>
      event.turnId === turnId && event.type === "approval" && event.data?.status === "pending");
    expect(approval?.data).toMatchObject({ executable: "powershell", orchestrationId: expect.any(String) });
    const childExecutionId = String(approval!.data!.executionId);
    const commandRequestId = String(approval!.data!.commandRequestId);

    await approveAgentCommand(projectId, childExecutionId, commandRequestId, dataDir);
    await runApprovedAgentCommand({ projectId, executionId: childExecutionId, commandId: commandRequestId }, dataDir);
    expect((await getAgentExecution(projectId, childExecutionId, dataDir))?.commandRequests[0].status).toBe("succeeded");
    const orchestrationId = String(approval!.data!.orchestrationId);
    expect((await getGlobalOrchestration(projectId, orchestrationId, dataDir))?.tasks[0].status).toBe("running");
    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "并行处理项目初始化准备",
      model,
      turnId,
      resume: true,
    }, { dataDir, callModel: callModel as never });

    expect({ resumed, parentCalls, childCalls }).toMatchObject({
      resumed: { status: "completed", answer: "子任务已完成，提升权限命令已执行。" },
      parentCalls: 2,
      childCalls: 2,
    });
    expect(childConfiguration).toEqual([
      { reasoningEffort: "xhigh", modelSpeed: "fast" },
      { reasoningEffort: "xhigh", modelSpeed: "fast" },
    ]);
    const completedSession = await getProjectAgentSession(projectId, dataDir);
    const delegateResults = completedSession.events.filter((event) =>
      event.turnId === turnId && event.type === "toolResult" && event.data?.name === "delegate_tasks");
    expect(delegateResults).toHaveLength(2);
    expect(delegateResults.map((event) => (event.data?.output as { orchestrationId: string }).orchestrationId))
      .toEqual([expect.any(String), expect.any(String)]);
    expect((delegateResults[0].data?.output as { orchestrationId: string }).orchestrationId)
      .toBe((delegateResults[1].data?.output as { orchestrationId: string }).orchestrationId);
  }, 30_000);

  it("returns a rejected Sub-agent command to the same child and parent trajectories", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await updateLocalSettings({ defaultSessionPermissionMode: "untrusted" }, dataDir);
    const turnId = "delegated-rejection-turn";
    let parentCalls = 0;
    let childCalls = 0;
    const callModel = async (input: { context: string; allowedAgentTools?: string[] }) => {
      if (input.allowedAgentTools?.includes("shell_command") && isOneOffSubagentContext(input.context)) {
        childCalls += 1;
        return childCalls === 1
          ? { text: "", toolCall: { name: "shell_command", arguments: { executable: "powershell", args: ["-NoProfile", "-Command", "Write-Output delegated-ok"], reason: "运行提升权限命令" } }, usage: null }
          : { text: "用户拒绝提升权限命令，未修改 Workspace。", usage: null };
      }
      parentCalls += 1;
      return parentCalls === 1
        ? {
            text: "",
            toolCall: {
              name: "delegate_tasks",
              arguments: {
                goal: "准备项目",
                tasks: [{ title: "准备", instruction: "运行需要提升权限的命令", allowedPathPrefixes: ["."], allowedTools: ["shell_command"] }],
              },
            },
            usage: null,
          }
        : { text: "已遵从拒绝，没有运行提升权限命令。", usage: null };
    };

    const first = await runProjectAgentTurn({ projectId, prompt: "并行准备项目环境", model, turnId }, {
      dataDir,
      callModel: callModel as never,
    });
    expect(first.status).toBe("waitingApproval");
    const session = await getProjectAgentSession(projectId, dataDir);
    const approval = session.events.find((event) =>
      event.turnId === turnId && event.type === "approval" && event.data?.status === "pending");
    const childExecutionId = String(approval!.data!.executionId);
    const commandRequestId = String(approval!.data!.commandRequestId);
    await rejectAgentCommand(projectId, childExecutionId, commandRequestId, dataDir);
    await appendProjectAgentEvent({
      projectId,
      turnId,
      type: "approval",
      content: "用户拒绝执行命令",
      data: { commandRequestId, executionId: childExecutionId, status: "rejected" },
    }, dataDir);

    const resumed = await runProjectAgentTurn({
      projectId,
      prompt: "用户拒绝了上一条命令。请继续。",
      model,
      turnId,
      resume: true,
    }, { dataDir, callModel: callModel as never });

    expect(resumed).toMatchObject({ status: "completed", answer: "已遵从拒绝，没有运行提升权限命令。" });
    expect(parentCalls).toBe(2);
    expect(childCalls).toBe(2);
    expect((await getAgentExecution(projectId, childExecutionId, dataDir))?.commandRequests[0].status).toBe("rejected");
  }, 30_000);

  it("lets the model reason across repeated identical tool outcomes", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    let toolCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "检查目录", model }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 4) return { text: "目录检查完成。", usage: null };
        return {
          text: "",
          toolCall: { name: "list_directory", arguments: { relativePath: "." } },
          usage: null,
        };
      },
      executeTool: async (toolInput) => {
        if (toolInput.name === "list_directory") toolCalls += 1;
        return { path: ".", entries: [] } as never;
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "目录检查完成。" });
    expect(modelCalls).toBe(4);
    expect(toolCalls).toBe(3);
  }, 30_000);

  it("returns actionable native tool validation feedback so the model can repair its own call", async () => {
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    let modelCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "读取 README", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "read_file", arguments: { invented: true } }, usage: null };
        }
        if (modelCalls === 2) {
          expect(modelInputText(modelInput)).toContain("不支持的字段：invented");
          return { text: "", toolCall: { name: "read_file", arguments: { relativePath: "README.md" } }, usage: null };
        }
        return { text: "已根据真实工具反馈修正调用并完成读取。", usage: null };
      },
      executeTool: async (toolInput) => {
        expect(toolInput.name).toBe("read_file");
        return { relativePath: "README.md", content: "ok" } as never;
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "已根据真实工具反馈修正调用并完成读取。" });
    expect(modelCalls).toBe(3);
  });

  it("uses the cc-haha-compatible task_list name and continues to a final answer", async () => {
    let modelCalls = 0;
    let taskListCalls = 0;
    const result = await runProjectAgentTurn({ projectId, prompt: "查看共享任务后告诉我结果", model }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        expect(modelInput.allowedAgentTools).toContain("task_list");
        expect(modelInput.allowedAgentTools).not.toContain("project_task_list");
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "task_list", arguments: {} }, usage: null };
        }
        expect(modelInput.context).not.toContain('"type":"toolCall"');
        expect(modelInput.messages).toEqual(expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            toolCalls: [expect.objectContaining({ name: "task_list", arguments: {} })],
          }),
          expect.objectContaining({ role: "tool", name: "task_list" }),
        ]));
        return { text: "当前没有待处理的共享任务。", usage: null };
      },
      executeTool: async (toolInput) => {
        expect(toolInput.name).toBe("task_list");
        taskListCalls += 1;
        return { tasks: [] } as never;
      },
    });

    expect(result).toMatchObject({ status: "completed", answer: "当前没有待处理的共享任务。" });
    expect(modelCalls).toBe(2);
    expect(taskListCalls).toBe(1);
  });

  it("passes the persisted thinking preference into model calls", async () => {
    await updateLocalSettings({
      thinkingEnabled: true,
      defaultReasoningEffort: "low",
      defaultModelSpeed: "fast",
    }, dataDir);
    let thinkingEnabled: boolean | undefined;
    let reasoningEffort: string | undefined;
    let modelSpeed: string | undefined;
    await runProjectAgentTurn({ projectId, prompt: "简单回答", model }, {
      dataDir,
      callModel: async (input) => {
        thinkingEnabled = input.thinkingEnabled;
        reasoningEffort = input.reasoningEffort;
        modelSpeed = input.modelSpeed;
        return { text: "完成", usage: null };
      },
    });
    expect(thinkingEnabled).toBe(true);
    expect(reasoningEffort).toBe("low");
    expect(modelSpeed).toBe("fast");
  });

  it("lets a single turn override the persisted reasoning effort and speed", async () => {
    let received: { reasoningEffort?: string; modelSpeed?: string } = {};
    await runProjectAgentTurn({
      projectId,
      prompt: "深入分析",
      model,
      reasoningEffort: "xhigh",
      modelSpeed: "standard",
    }, {
      dataDir,
      callModel: async (input) => {
        received = { reasoningEffort: input.reasoningEffort, modelSpeed: input.modelSpeed };
        return { text: "完成", usage: null };
      },
    });
    expect(received).toEqual({ reasoningEffort: "xhigh", modelSpeed: "standard" });
  });
});
