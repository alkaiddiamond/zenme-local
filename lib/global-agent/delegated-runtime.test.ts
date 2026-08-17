import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { buildDelegatedSubagentContext, runDelegatedOrchestration, runDelegatedSubagent, startDelegatedSubagentRun } from "@/lib/global-agent/delegated-runtime";
import { createAgentExecution, finishAgentToolCall, getAgentExecution, startAgentToolCall } from "@/lib/agent/execution-store";
import { approveAgentCommand, runApprovedAgentCommand } from "@/lib/agent/command-runtime";
import {
  addGlobalTeamMember,
  claimGlobalSubtaskMessages,
  createGlobalOrchestration,
  createGlobalTeam,
  dispatchGlobalSubtasks,
  getGlobalOrchestration,
  respondGlobalTeamPlanApproval,
  sendGlobalSubtaskMessage,
} from "@/lib/global-agent/orchestration-store";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";
import { createProjectAgentTask, getProjectAgentTask } from "@/lib/agent/project-session-store";
import { updateLocalSettings } from "@/lib/local/settings";

let dataDir: string;
let projectId: string;
let workspaceRoot: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-delegated-agent-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-delegated-workspace-"));
  await fs.mkdir(path.join(workspaceRoot, "src", "a"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "src", "b"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "src", "a", "index.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(workspaceRoot, "src", "b", "index.ts"), "export const b = 1;\n");
  await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
    scripts: { test: "node -e \"console.log('delegated-test-ok')\"" },
  }));
  projectId = (await createLocalProject({ name: "Delegated", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
});

describe("delegated Sub-agent runtime", { timeout: 15_000 }, () => {
  it("keeps the same Workflow Sub-agent alive to correct an invalid structured result", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "structured-agent",
      triggerNodeId: "workflow-parent",
      instruction: "返回结构化检查结果",
      allowedPathPrefixes: ["src/a"],
      allowedTools: [],
      structuredResultSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
    }, dataDir);
    let calls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        if (calls === 1) return { text: '{"summary":1}', usage: null };
        expect(input.context).toContain("不符合 JSON Schema");
        expect(input.context).toContain("请修正最终结果");
        return { text: '{"summary":"检查完成"}', usage: null };
      },
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({
      id: detail.id,
      status: "succeeded",
      resultSummary: '{"summary":"检查完成"}',
    });
  });

  it("lets a persistent Team teammate claim and complete a shared project task atomically", async () => {
    const sharedTask = await createProjectAgentTask({
      projectId,
      subject: "检查模块 A",
      description: "读取模块 A 并汇报结果",
    }, dataDir);
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "parent-turn",
      triggerNodeId: "parent-turn",
      teamName: "shared-task-team",
    }, dataDir);
    await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "subagent",
      instruction: "领取并完成共享任务",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["read_file"],
    }, dataDir);
    let calls = 0;

    const result = await runDelegatedOrchestration({
      projectId,
      orchestrationId: team.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        calls += 1;
        expect(input.allowedAgentTools).toEqual(expect.arrayContaining(["task_list", "task_get", "task_update"]));
        if (calls === 1) return { text: "", toolCall: { name: "task_list", arguments: {} }, usage: null };
        if (calls === 2) {
          expect(input.context).toContain(sharedTask.id);
          return { text: "", toolCall: { name: "task_update", arguments: { taskId: sharedTask.id, owner: "subagent", status: "completed" } }, usage: null };
        }
        return { text: "共享任务已完成", usage: null };
      },
    });

    expect(result.status).toBe("waitingReview");
    await expect(getProjectAgentTask(projectId, sharedTask.id, dataDir)).resolves.toMatchObject({
      owner: "subagent",
      status: "completed",
    });
  }, 30_000);

  it("feeds images observed by a scoped Sub-agent into its next model turn", async () => {
    await sharp({ create: { width: 320, height: 200, channels: 3, background: "#f59e0b" } })
      .png().toFile(path.join(workspaceRoot, "src", "a", "ui.png"));
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "image-agent",
      triggerNodeId: "image-source",
      instruction: "分析模块 A 的界面截图",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["view_image"],
    }, dataDir);
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.imageDataUrls ?? []).toEqual([]);
          return { text: "", toolCall: { name: "view_image", arguments: { relativePath: "src/a/ui.png" } }, usage: null };
        }
        expect(input.imageDataUrls?.[0]).toMatch(/^data:image\/webp;base64,/);
        expect(input.context).toContain("src/a/ui.png");
        expect(input.context).not.toContain("data:image/webp;base64");
        return { text: "界面截图分析完成", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "界面截图分析完成" });
    const persisted = await getAgentExecution(projectId, detail.id, dataDir);
    expect(persisted?.toolCalls[0]?.output).not.toHaveProperty("dataUrl");
  });

  it("lets an explicitly scoped Sub-agent verify a local preview with a transient screenshot", async () => {
    const previousUrl = process.env.ZENME_BROWSER_CONTROL_URL;
    const previousToken = process.env.ZENME_DESKTOP_TOKEN;
    process.env.ZENME_BROWSER_CONTROL_URL = "http://127.0.0.1:4567/browser";
    process.env.ZENME_DESKTOP_TOKEN = "desktop-secret";
    const screenshotDataUrl = `data:image/png;base64,${Buffer.from("subagent-preview").toString("base64")}`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      url: "http://127.0.0.1:5173/",
      title: "Sub-agent preview",
      text: "Ready",
      elements: [],
      screenshot: { dataUrl: screenshotDataUrl, mimeType: "image/png", width: 1280, height: 800 },
    }), { status: 200, headers: { "content-type": "application/json" } })));
    try {
      const { detail } = await createAgentExecution({
        projectId,
        resultNodeId: "browser-agent",
        triggerNodeId: "browser-source",
        instruction: "验证本地页面",
        allowedPathPrefixes: ["src/a"],
        allowedTools: ["browser"],
      }, dataDir);
      let modelCalls = 0;
      const result = await runDelegatedSubagent({
        projectId,
        executionId: detail.id,
        model: "test:model",
      }, {
        dataDir,
        callModel: async (input) => {
          modelCalls += 1;
          if (modelCalls === 1) return {
            text: "",
            toolCall: { name: "browser", arguments: { operation: "navigate", url: "http://127.0.0.1:5173/", includeScreenshot: true } },
            usage: null,
          };
          expect(input.imageDataUrls).toEqual([screenshotDataUrl]);
          expect(input.context).toContain("Sub-agent preview");
          expect(input.context).not.toContain("data:image/png;base64");
          return { text: "本地页面验证完成", usage: null };
        },
      });

      expect(result).toMatchObject({ status: "succeeded", resultSummary: "本地页面验证完成" });
      const persisted = await getAgentExecution(projectId, detail.id, dataDir);
      expect(JSON.stringify(persisted?.toolCalls[0]?.output)).not.toContain("base64");
    } finally {
      vi.unstubAllGlobals();
      if (previousUrl === undefined) delete process.env.ZENME_BROWSER_CONTROL_URL;
      else process.env.ZENME_BROWSER_CONTROL_URL = previousUrl;
      if (previousToken === undefined) delete process.env.ZENME_DESKTOP_TOKEN;
      else process.env.ZENME_DESKTOP_TOKEN = previousToken;
    }
  });

  it("does not let a Sub-agent bypass untrusted browser interaction approval", async () => {
    await updateLocalSettings({ defaultSessionPermissionMode: "untrusted" }, dataDir);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { detail } = await createAgentExecution({
        projectId,
        resultNodeId: "browser-untrusted-agent",
        triggerNodeId: "browser-untrusted-source",
        instruction: "点击本地页面按钮",
        allowedPathPrefixes: ["src/a"],
        allowedTools: ["browser"],
      }, dataDir);
      const result = await runDelegatedSubagent({
        projectId,
        executionId: detail.id,
        model: "test:model",
      }, {
        dataDir,
        callModel: async () => ({
          text: "",
          toolCall: { name: "browser", arguments: { operation: "click", ref: "e1" } },
          usage: null,
        }),
      });

      expect(result).toMatchObject({
        status: "failed",
        error: expect.stringContaining("必须由主 Agent 向用户请求批准"),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets a cc-haha-style Stop hook require another Agent turn", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "stop-hook-agent",
      triggerNodeId: "stop-hook-source",
      instruction: "完成任务并验证",
      allowedPathPrefixes: ["."],
      allowedTools: ["read_file"],
      agentHooks: {
        Stop: [{ hooks: [{ type: "prompt", prompt: "Verify completion." }] }],
      },
    }, dataDir);
    let verificationCount = 0;
    let agentTurnCount = 0;
    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        if (input.mode === "agent_planning") {
          verificationCount += 1;
          return {
            text: JSON.stringify(verificationCount === 1
              ? { ok: false, reason: "Run one more verification." }
              : { ok: true }),
            usage: null,
          };
        }
        agentTurnCount += 1;
        return { text: agentTurnCount === 1 ? "Initial result" : "Verified result", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "Verified result" });
    expect(agentTurnCount).toBe(2);
    expect(verificationCount).toBe(2);
  });

  it("lets TaskCompleted and TeammateIdle hooks keep a named teammate working", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "team-hook-parent",
      triggerNodeId: "team-hook-source",
      goal: "verify teammate completion",
      kind: "team",
      teamName: "review-team",
      tasks: [{
        name: "reviewer",
        title: "Review changes",
        instruction: "Review the change and finish.",
        allowedPathPrefixes: ["."],
        allowedTools: ["read_file"],
        hooks: {
          TaskCompleted: [{ hooks: [{ type: "prompt", prompt: "Check task completion." }] }],
          TeammateIdle: [{ hooks: [{ type: "prompt", prompt: "Check whether the teammate may idle." }] }],
        },
      }],
    }, dataDir);
    let agentTurns = 0;
    let taskCompletedHooks = 0;
    let teammateIdleHooks = 0;

    const result = await runDelegatedOrchestration({
      projectId,
      orchestrationId: orchestration.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (modelInput) => {
        if (modelInput.mode === "agent_planning") {
          const isIdle = modelInput.prompt.includes('"hook_event_name":"TeammateIdle"');
          if (isIdle) {
            teammateIdleHooks += 1;
            return {
              text: JSON.stringify(teammateIdleHooks === 1
                ? { ok: false, reason: "Inspect one more file before going idle." }
                : { ok: true }),
              usage: null,
            };
          }
          taskCompletedHooks += 1;
          return { text: JSON.stringify({ ok: true }), usage: null };
        }
        agentTurns += 1;
        return { text: agentTurns === 1 ? "Initial review" : "Verified review", usage: null };
      },
    });

    expect(result.tasks[0]).toMatchObject({ status: "succeeded", resultSummary: "Verified review" });
    expect(agentTurns).toBe(2);
    expect(taskCompletedHooks).toBe(2);
    expect(teammateIdleHooks).toBe(2);
  }, 15_000);

  it("does not expose background task enumeration or preview tools to a delegated agent", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "preview-agent",
      triggerNodeId: "preview-source",
      instruction: "打开开发页面",
      allowedPathPrefixes: ["."],
      allowedTools: ["shell_command", "task_output"],
    }, dataDir);
    const context = buildDelegatedSubagentContext(detail, "neverAsk", [{
      id: "task-1",
      executionId: detail.id,
      executable: "pnpm",
      args: ["run", "dev"],
      cwd: ".",
      timeoutMs: 120_000,
      reason: "启动开发服务",
      background: true,
      requiresExplicitApproval: false,
      sandboxMode: "workspace-write",
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }], [{ relativePath: "src/AGENTS.md", content: "Only edit src." }]);

    expect(context).not.toContain("open_preview");
    expect(context).not.toContain("- task_list [");
    expect(context).not.toContain('允许工具：["shell_command","task_list"');
    expect(context).not.toContain('"taskId":"task-1"');
    expect(context).toContain("同一进程自动转为后台");
    expect(context).toContain("src/AGENTS.md");
    expect(context).toContain("Only edit src.");
    const skillContext = buildDelegatedSubagentContext(
      detail,
      "neverAsk",
      [],
      [],
      [],
      [],
      [],
      [],
      [{
        name: "release-check",
        description: "Validate release",
        source: "project",
        rootId: "root-a",
        rootDisplayName: "workspace-a",
        primary: false,
      }],
    );
    expect(skillContext).toContain("release-check");
    expect(skillContext).toContain("rootId=root-a");

    const { detail: semanticDetail } = await createAgentExecution({
      projectId,
      resultNodeId: "semantic-agent",
      triggerNodeId: "semantic-source",
      instruction: "分析模块 A 的定义与调用关系",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["code_intelligence"],
    }, dataDir);
    const semanticContext = buildDelegatedSubagentContext(semanticDetail, "neverAsk", [], []);
    expect(semanticContext).toContain("code_intelligence");
    expect(semanticContext).toContain("定义、引用、实现、类型或调用关系");
  });

  it("runs independent scoped Sub-agents concurrently and collects their results", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "parent-turn",
      triggerNodeId: "parent-turn",
      goal: "并行检查两个模块",
      concurrencyLimit: 2,
      tasks: [
        { title: "检查 A", instruction: "读取并检查模块 A", allowedPathPrefixes: ["src/a"], allowedTools: ["read_file"] },
        { title: "检查 B", instruction: "读取并检查模块 B", allowedPathPrefixes: ["src/b"], allowedTools: ["read_file"] },
      ],
    }, dataDir);
    let firstCalls = 0;
    let releaseFirstCalls!: () => void;
    const bothStarted = new Promise<void>((resolve) => { releaseFirstCalls = resolve; });

    const result = await runDelegatedOrchestration({
      projectId,
      orchestrationId: orchestration.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        const isA = input.context.includes("读取并检查模块 A");
        const relativePath = isA ? "src/a/index.ts" : "src/b/index.ts";
        if (!input.context.includes('"name":"read_file"')) {
          firstCalls += 1;
          if (firstCalls === 2) releaseFirstCalls();
          await bothStarted;
          return { text: "", toolCall: { name: "read_file", arguments: { relativePath } }, usage: null };
        }
        return { text: `${isA ? "A" : "B"} 检查完成`, usage: null };
      },
    });

    expect(firstCalls).toBe(2);
    expect(result.status).toBe("completed");
    expect(result.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "检查 A", status: "succeeded", resultSummary: "A 检查完成" }),
      expect.objectContaining({ title: "检查 B", status: "succeeded", resultSummary: "B 检查完成" }),
    ]));
  }, 30_000);

  it("reports child tool progress before the orchestration finishes", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "parent-turn",
      triggerNodeId: "parent-turn",
      goal: "读取模块 A",
      tasks: [
        { title: "检查 A", instruction: "读取模块 A", allowedPathPrefixes: ["src/a"], allowedTools: ["read_file"] },
      ],
    }, dataDir);
    let modelCalls = 0;
    let sawToolBeforeCompletion = false;

    const result = await runDelegatedOrchestration({
      projectId,
      orchestrationId: orchestration.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "read_file", arguments: { relativePath: "src/a/index.ts" } }, usage: null };
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
        return { text: "A 检查完成", usage: null };
      },
      onProgress: async (current) => {
        const executionId = current.tasks[0]?.agentExecutionId;
        if (!executionId || current.status !== "running") return;
        const detail = await getAgentExecution(projectId, executionId, dataDir);
        if (detail?.toolCalls.some((call) => call.name === "read_file" && call.status === "succeeded")) {
          sawToolBeforeCompletion = true;
        }
      },
    });

    expect(result.status).toBe("completed");
    expect(sawToolBeforeCompletion).toBe(true);
  }, 30_000);

  it("discards a stale child decision when parent steering arrives during the model call", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "parent-source",
      parentTurnId: "parent-turn",
      goal: "检查模块 A",
      tasks: [{ title: "检查 A", instruction: "检查模块 A", allowedPathPrefixes: ["src/a"], allowedTools: ["read_file"] }],
    }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    const task = dispatched.dispatched[0];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const contexts: string[] = [];

    const running = runDelegatedSubagent({
      projectId,
      executionId: task.agentExecutionId!,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        contexts.push(input.context);
        if (contexts.length === 1) {
          markFirstStarted();
          await firstRelease;
          return { text: "旧方向已经完成", usage: null };
        }
        return { text: "已按补充指令检查边界条件", usage: null };
      },
    });
    await firstStarted;
    await sendGlobalSubtaskMessage({
      projectId,
      orchestrationId: orchestration.id,
      subtaskIds: [task.id],
      text: "改为优先检查边界条件",
    }, dataDir);
    releaseFirst();

    await expect(running).resolves.toMatchObject({
      status: "succeeded",
      resultSummary: "已按补充指令检查边界条件",
    });
    expect(contexts).toHaveLength(2);
    expect(contexts[1]).toContain("改为优先检查边界条件");
  });

  it("exposes send_message only to a persistent Team teammate and persists progress", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "parent-source",
      parentTurnId: "parent-turn",
      teamName: "module-review",
    }, dataDir);
    await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "reviewer",
      instruction: "检查模块 A",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["read_file"],
    }, dataDir);
    const task = (await dispatchGlobalSubtasks(projectId, team.id, dataDir)).dispatched[0];
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: task.agentExecutionId!,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        expect(input.additionalAgentTools).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: "send_message" }),
        ]));
        if (modelCalls === 1) {
          return {
            text: "",
            toolCall: {
              name: "send_message",
              arguments: { kind: "progress", summary: "完成初步检查", message: "接口没有破坏性变更，继续补测试。" },
            },
            usage: null,
          };
        }
        expect(input.context).toContain("完成初步检查");
        return { text: "模块 A 检查完成", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "模块 A 检查完成" });
    expect(result.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "send_message", status: "succeeded" }),
    ]));
    await expect(getGlobalOrchestration(projectId, team.id, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        messages: [expect.objectContaining({ from: "subagent", kind: "progress", summary: "完成初步检查" })],
      })],
    });
  }, 30_000);

  it("delivers canonical Team messages directly to a named teammate mailbox", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "parent-source",
      parentTurnId: "parent-turn",
      teamName: "implementation",
    }, dataDir);
    const alice = await addGlobalTeamMember({ projectId, teamId: team.id, name: "alice", instruction: "实现功能" }, dataDir);
    const bob = await addGlobalTeamMember({ projectId, teamId: team.id, name: "bob", instruction: "复核功能" }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const aliceExecutionId = dispatched.dispatched.find((task) => task.id === alice.id)?.agentExecutionId;
    expect(aliceExecutionId).toBeTruthy();
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: aliceExecutionId!,
      model: "test:model",
    }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        return modelCalls === 1
          ? {
              text: "",
              toolCall: {
                name: "send_message",
                arguments: { to: "bob", summary: "Review Windows behavior", message: "请复核 Windows 行为。" },
              },
              usage: null,
            }
          : { text: "已通知复核成员", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "已通知复核成员" });
    await expect(claimGlobalSubtaskMessages(projectId, team.id, bob.id, dataDir)).resolves.toEqual([
      expect.objectContaining({ from: "subagent", senderName: "alice", recipientName: "bob", text: "请复核 Windows 行为。" }),
    ]);
  });

  it("honors a structured shutdown request and stops after approving it", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "parent-source",
      parentTurnId: "parent-turn",
      teamName: "implementation",
    }, dataDir);
    const alice = await addGlobalTeamMember({ projectId, teamId: team.id, name: "alice", instruction: "实现功能" }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const executionId = dispatched.dispatched[0].agentExecutionId!;
    const shutdown = await sendGlobalSubtaskMessage({
      projectId,
      orchestrationId: team.id,
      recipientNames: ["alice"],
      kind: "shutdown_request",
      text: "当前工作已经完成，请退出。",
    }, dataDir);
    expect(shutdown.requestId).toBeTruthy();

    const result = await runDelegatedSubagent({ projectId, executionId, model: "test:model" }, {
      dataDir,
      callModel: async (input) => {
        expect(input.context).toContain(`request_id=${shutdown.requestId}`);
        return {
          text: "",
          toolCall: {
            name: "send_message",
            arguments: {
              to: "team-lead",
              message: { type: "shutdown_response", request_id: shutdown.requestId, approve: true },
            },
          },
          usage: null,
        };
      },
    });

    expect(result).toMatchObject({ status: "stopped", stage: "stopped" });
    await expect(getGlobalOrchestration(projectId, team.id, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        id: alice.id,
        messages: expect.arrayContaining([
          expect.objectContaining({ kind: "shutdown_response", requestId: shutdown.requestId, approve: true }),
        ]),
      })],
    });
  });

  it("requires a mode=plan teammate to obtain lead approval before write tools are exposed", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "parent-source",
      parentTurnId: "parent-turn",
      teamName: "planned-implementation",
    }, dataDir);
    const member = await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "planner",
      instruction: "先提交计划，再修改实现",
      planModeRequired: true,
    }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const executionId = dispatched.dispatched[0].agentExecutionId!;

    const waiting = await runDelegatedSubagent({ projectId, executionId, model: "test:model" }, {
      dataDir,
      callModel: async (input) => {
        expect(input.allowedAgentTools).toContain("exit_plan_mode");
        expect(input.allowedAgentTools).toContain("read_file");
        expect(input.allowedAgentTools).not.toContain("write_file");
        expect(input.allowedAgentTools).not.toContain("shell_command");
        expect(input.context).toContain("强制计划阶段");
        return {
          text: "",
          toolCall: {
            name: "exit_plan_mode",
            arguments: { plan: "1. 阅读当前实现\n2. 修改目标文件\n3. 运行相关测试" },
          },
          usage: null,
        };
      },
    });
    expect(waiting).toMatchObject({ status: "running", stage: "waitingApproval" });
    const current = await getGlobalOrchestration(projectId, team.id, dataDir);
    const requestId = current?.tasks[0].planApproval?.requestId;
    expect(requestId).toBeTruthy();

    await respondGlobalTeamPlanApproval({
      projectId,
      orchestrationId: team.id,
      teammateName: member.name!,
      requestId: requestId!,
      approve: true,
    }, dataDir);
    const completed = await runDelegatedSubagent({ projectId, executionId, model: "test:model" }, {
      dataDir,
      callModel: async (input) => {
        expect(input.allowedAgentTools).toContain("write_file");
        expect(input.allowedAgentTools).toContain("shell_command");
        expect(input.context).not.toContain("强制计划阶段");
        expect(input.context).toContain("计划已批准，可以开始实施");
        return { text: "已按批准计划完成实现", usage: null };
      },
    });
    expect(completed).toMatchObject({ status: "succeeded", resultSummary: "已按批准计划完成实现" });
  });

  it("executes a Sub-agent native read batch before the next model response", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "batch-agent",
      triggerNodeId: "batch-source",
      instruction: "同时检查模块 A 和 B",
      allowedPathPrefixes: ["src"],
      allowedTools: ["read_file"],
    }, dataDir);
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            text: "",
            toolCall: { name: "read_file", arguments: { relativePath: "src/a/index.ts" } },
            toolCalls: [
              { name: "read_file", arguments: { relativePath: "src/a/index.ts" } },
              { name: "read_file", arguments: { relativePath: "src/b/index.ts" } },
            ],
            usage: null,
          };
        }
        expect(modelInput.context).toContain("export const a = 1");
        expect(modelInput.context).toContain("export const b = 1");
        return { text: "两个模块检查完成", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "两个模块检查完成" });
    expect(modelCalls).toBe(2);
    expect(result.toolCalls.filter((call) => call.name === "read_file")).toHaveLength(2);
  }, 30_000);

  it("discovers and executes a deferred MCP tool inside a Sub-agent Turn", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "mcp-agent",
      triggerNodeId: "mcp-source",
      instruction: "读取外部说明",
      allowedPathPrefixes: ["."],
      allowedTools: ["tool_search"],
      agentMcpServers: [
        "filesystem",
        { privateNotes: { type: "stdio", command: "node", args: ["private-notes.mjs"] } },
      ],
    }, dataDir);
    const mcpTool = {
      name: "mcp__filesystem__read_external" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_external",
      description: "Read external project notes",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      readOnly: true,
    };
    let modelCalls = 0;
    let mcpCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      listMcpTools: async (_projectId, _dataDir, _rootId, selection) => {
        expect(selection).toEqual({
          specs: [
            "filesystem",
            { privateNotes: { type: "stdio", command: "node", args: ["private-notes.mjs"] } },
          ],
          connectionScope: detail.id,
        });
        return { tools: [mcpTool], failures: [] };
      },
      callMcpTool: async (input) => {
        mcpCalls += 1;
        expect(input).toMatchObject({
          name: mcpTool.name,
          arguments: { path: "notes.md" },
          agentMcpServers: [
            "filesystem",
            { privateNotes: { type: "stdio", command: "node", args: ["private-notes.mjs"] } },
          ],
          connectionScope: detail.id,
        });
        return { text: "external project notes", structuredContent: { path: "notes.md" } };
      },
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.additionalAgentTools).toEqual([]);
          expect(input.context).toContain("1 个 MCP 工具可通过 tool_search 按需发现");
          return { text: "", toolCall: { name: "tool_search", arguments: { query: "external notes" } }, usage: null };
        }
        expect(input.additionalAgentTools).toEqual([
          expect.objectContaining({ name: mcpTool.name }),
        ]);
        if (modelCalls === 2) {
          return { text: "", toolCall: { name: mcpTool.name, arguments: { path: "notes.md" } }, usage: null };
        }
        expect(input.context).toContain("external project notes");
        return { text: "外部说明读取完成", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "外部说明读取完成" });
    expect(modelCalls).toBe(3);
    expect(mcpCalls).toBe(1);
    expect(result.toolCalls.map((call) => call.name)).toEqual(["tool_search", mcpTool.name]);
    expect(result.toolCalls[0]?.output).toMatchObject({
      tools: [expect.objectContaining({ name: mcpTool.name })],
    });
  }, 30_000);

  it("defers a heavy built-in tool inside a Sub-agent Turn until tool_search activates it", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "deferred-browser-agent",
      triggerNodeId: "deferred-browser-source",
      instruction: "按需检查明确给出的预览页面",
      allowedPathPrefixes: ["."],
      allowedTools: ["tool_search", "browser"],
    }, dataDir);
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          expect(input.allowedAgentTools).toEqual(["tool_search"]);
          expect(input.context).not.toContain("- browser [");
          return { text: "", toolCall: { name: "tool_search", arguments: { query: "browser 页面" } }, usage: null };
        }
        expect(input.allowedAgentTools).toEqual(["tool_search", "browser"]);
        expect(input.context).toContain("- browser [");
        return { text: "浏览器工具已按需激活", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "浏览器工具已按需激活" });
    expect(modelCalls).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      name: "tool_search",
      output: { tools: [expect.objectContaining({ name: "browser" })] },
    });
  }, 30_000);

  it("restores an activated MCP tool when a delegated Execution resumes", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "resumed-mcp-agent",
      triggerNodeId: "resumed-mcp-source",
      instruction: "继续外部读取任务",
      allowedPathPrefixes: ["."],
      allowedTools: ["tool_search"],
    }, dataDir);
    const mcpTool = {
      name: "mcp__filesystem__read_external" as const,
      serverId: "filesystem",
      serverName: "filesystem",
      remoteName: "read_external",
      description: "Read external project notes",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      readOnly: true,
    };
    const searchCall = await startAgentToolCall({
      projectId,
      executionId: detail.id,
      name: "tool_search",
      arguments: { query: "external notes" },
    }, dataDir);
    await finishAgentToolCall({
      projectId,
      executionId: detail.id,
      toolCallId: searchCall.id,
      output: { tools: [{ name: mcpTool.name, description: mcpTool.description }] },
    }, dataDir);

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      listMcpTools: async () => ({ tools: [mcpTool], failures: [] }),
      callModel: async (input) => {
        expect(input.additionalAgentTools).toEqual([
          expect.objectContaining({ name: mcpTool.name }),
        ]);
        expect(input.context).toContain("当前 Sub-agent Turn 已激活");
        return { text: "恢复后继续完成", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "恢复后继续完成" });
  });

  it("returns a failed tool result to the Sub-agent so it can change course", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "recovering-agent",
      triggerNodeId: "recovering-source",
      instruction: "读取模块 A",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["read_file"],
    }, dataDir);
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (input) => {
        modelCalls += 1;
        if (modelCalls === 1) {
          return { text: "", toolCall: { name: "read_file", arguments: { relativePath: "src/a/missing.ts" } }, usage: null };
        }
        if (modelCalls === 2) {
          expect(input.context).toContain('"status":"failed"');
          expect(input.context).toContain("missing.ts");
          return { text: "", toolCall: { name: "read_file", arguments: { relativePath: "src/a/index.ts" } }, usage: null };
        }
        expect(input.context).toContain("export const a = 1");
        return { text: "已改用存在的文件并完成检查", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "已改用存在的文件并完成检查" });
    expect(modelCalls).toBe(3);
    expect(result.toolCalls.map((call) => call.status)).toEqual(["failed", "succeeded"]);
  });

  it("lets a Sub-agent reason across repeated failed tool outcomes", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "looping-agent",
      triggerNodeId: "looping-source",
      instruction: "读取不存在的文件",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["read_file"],
    }, dataDir);
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async () => {
        modelCalls += 1;
        if (modelCalls === 4) return { text: "文件不存在，已完成诊断。", usage: null };
        return { text: "", toolCall: { name: "read_file", arguments: { relativePath: "src/a/missing.ts" } }, usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      resultSummary: "文件不存在，已完成诊断。",
    });
    expect(modelCalls).toBe(4);
    expect(result.toolCalls).toHaveLength(3);
  });

  it("diagnoses a Sub-agent ChangeSet overlay before accepting completion", async () => {
    await fs.writeFile(path.join(workspaceRoot, "src", "a", "index.ts"), "export const a: number = 1;\n");
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }));
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "diagnostic-agent",
      triggerNodeId: "diagnostic-source",
      instruction: "修改模块 A",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["read_file", "edit_file", "code_diagnostics"],
    }, dataDir);
    let modelCalls = 0;

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async (modelInput) => {
        modelCalls += 1;
        if (modelCalls === 1) return {
          text: "",
          toolCall: { name: "edit_file", arguments: { relativePath: "src/a/index.ts", oldText: "= 1", newText: "= 'broken'" } },
          usage: null,
        };
        if (modelCalls === 2) return { text: "修改完成", usage: null };
        expect(modelInput.context).toContain("code_diagnostics");
        expect(modelInput.context).toContain("2322");
        return { text: "发现类型错误，尚未完成", usage: null };
      },
    });

    expect(result).toMatchObject({ status: "succeeded", resultSummary: "发现类型错误，尚未完成" });
    expect(modelCalls).toBe(3);
    expect(result.toolCalls.find((call) => call.name === "code_diagnostics")?.output)
      .toMatchObject({ available: true, errorCount: 1 });
    await expect(fs.readFile(path.join(workspaceRoot, "src", "a", "index.ts"), "utf8"))
      .resolves.toContain("= 1");
  }, 30_000);

  it("auto-runs a declared sandboxed test command without creating a hidden approval", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "parent-turn",
      triggerNodeId: "parent-turn",
      goal: "运行项目测试",
      tasks: [{
        title: "测试",
        instruction: "运行项目测试",
        allowedPathPrefixes: ["."],
        allowedTools: ["shell_command"],
      }],
    }, dataDir);
    let modelCall = 0;
    const result = await runDelegatedOrchestration({
      projectId,
      orchestrationId: orchestration.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async () => {
        modelCall += 1;
        return modelCall === 1
          ? { text: "", toolCall: { name: "shell_command", arguments: { executable: "npm", args: ["test"], reason: "验证项目" } }, usage: null }
          : { text: "测试通过", usage: null };
      },
    });

    expect(result).toMatchObject({
      status: "completed",
      tasks: [expect.objectContaining({ status: "succeeded", resultSummary: "测试通过" })],
    });
  }, 30_000);

  it("keeps elevated commands waiting for approval in on-request mode", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "agent-node",
      triggerNodeId: "source-node",
      instruction: "初始化 Git",
      allowedPathPrefixes: ["."],
      allowedTools: ["shell_command"],
    }, dataDir);

    const result = await runDelegatedSubagent({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, {
      dataDir,
      callModel: async () => ({
        text: "",
        toolCall: { name: "shell_command", arguments: { executable: "npm", args: ["exec", "anything"], reason: "运行需要提升权限的命令" } },
        usage: null,
      }),
    });

    expect(result).toMatchObject({
      status: "running",
      stage: "waitingApproval",
      commandRequests: [expect.objectContaining({ executable: "npm", status: "proposed" })],
    });
  });

  it("resumes an existing delegated task after its approved command finishes", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "approval-parent",
      triggerNodeId: "approval-source",
      goal: "运行提升权限命令",
      tasks: [{
        title: "运行命令",
        instruction: "运行需要提升权限的命令",
        allowedPathPrefixes: ["."],
        allowedTools: ["shell_command"],
      }],
    }, dataDir);
    let modelCalls = 0;
    const callModel = async (input: { context: string }) => {
      modelCalls += 1;
      return input.context.includes('"status":"succeeded"')
        ? { text: "命令执行完成", usage: null }
        : { text: "", toolCall: { name: "shell_command", arguments: { executable: "powershell", args: ["-NoProfile", "-Command", "Write-Output delegated-ok"], reason: "运行提升权限命令" } }, usage: null };
    };

    const waiting = await runDelegatedOrchestration({
      projectId,
      orchestrationId: orchestration.id,
      model: "test:model",
    }, { dataDir, callModel });
    const task = waiting.tasks[0];
    const detail = await getAgentExecution(projectId, task.agentExecutionId!, dataDir);
    const command = detail!.commandRequests[0];
    expect(task.status).toBe("waitingApproval");

    await approveAgentCommand(projectId, detail!.id, command.id, dataDir);
    await runApprovedAgentCommand({
      projectId,
      executionId: detail!.id,
      commandId: command.id,
    }, dataDir);
    const completed = await runDelegatedOrchestration({
      projectId,
      orchestrationId: orchestration.id,
      model: "test:model",
    }, { dataDir, callModel });

    expect(completed).toMatchObject({
      status: "completed",
      tasks: [expect.objectContaining({ status: "succeeded", resultSummary: "命令执行完成" })],
    });
    expect(modelCalls).toBe(2);
  }, 30_000);

  it("keeps a deduplicated server-owned Sub-agent run alive after the start request returns", async () => {
    const { detail } = await createAgentExecution({
      projectId,
      resultNodeId: "agent-node-detached",
      triggerNodeId: "source-node-detached",
      instruction: "检查项目",
      allowedPathPrefixes: ["."],
      allowedTools: ["workspace_status"],
    }, dataDir);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const callModel = async () => {
      await gate;
      return { text: "后台检查完成", usage: null };
    };

    const started = await startDelegatedSubagentRun({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, { dataDir, callModel });
    const duplicate = await startDelegatedSubagentRun({
      projectId,
      executionId: detail.id,
      model: "test:model",
    }, { dataDir, callModel });

    expect(started).toMatchObject({ started: true, detail: { status: "running" } });
    expect(duplicate).toMatchObject({ started: false, detail: { id: detail.id } });
    release();
    let current = await getAgentExecution(projectId, detail.id, dataDir);
    for (let attempt = 0; attempt < 500 && current?.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = await getAgentExecution(projectId, detail.id, dataDir);
    }
    expect(current).toMatchObject({ status: "succeeded", resultSummary: "后台检查完成" });
  });
});
