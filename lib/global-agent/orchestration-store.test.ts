import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { completeAgentExecution, getAgentExecution } from "@/lib/agent/execution-store";
import { executeAgentWorkspaceTool } from "@/lib/agent/workspace-tools";
import {
  createGlobalOrchestration,
  createGlobalTeam,
  addGlobalTeamMember,
  closeGlobalTeam,
  broadcastProjectTurnMessageToSubagents,
  claimGlobalSubtaskMessages,
  dispatchGlobalSubtasks,
  getGlobalOrchestration,
  refreshGlobalOrchestration,
  requestGlobalTeamPlanApproval,
  respondGlobalTeamPlanApproval,
  retryGlobalSubtask,
  sendGlobalSubtaskMessage,
  sendGlobalSubtaskReport,
  sendGlobalTeamMessage,
  stopGlobalOrchestration,
} from "@/lib/global-agent/orchestration-store";
import { createLocalProject } from "@/lib/local/project-repository";
import { addLocalWorkspaceRoot, bindLocalWorkspace, getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";

let dataDir: string;
let projectId: string;
let workspaceRoot: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-global-agent-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-global-agent-root-"));
  await fs.mkdir(path.join(workspaceRoot, "src", "a"), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, "src", "b"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "src", "a", "index.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(workspaceRoot, "src", "b", "index.ts"), "export const b = 1;\n");
  projectId = (await createLocalProject({ name: "Global", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
  await fs.rm(workspaceRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
});

describe("Global Agent orchestration", { timeout: 15_000 }, () => {
  it("keeps one open named team, routes messages by teammate name, and refuses early deletion", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "team-result",
      triggerNodeId: "team-trigger",
      teamName: "implementation",
      description: "实现并复核功能",
    }, dataDir);
    expect(team).toMatchObject({ kind: "team", teamName: "implementation", tasks: [] });
    await expect(createGlobalTeam({
      projectId,
      resultNodeId: "other-result",
      triggerNodeId: "other-trigger",
      teamName: "other-team",
    }, dataDir)).rejects.toMatchObject({ code: "invalid_status" });

    const reviewer = await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "reviewer",
      title: "复核实现",
      instruction: "检查实现与失败路径",
      allowedPathPrefixes: ["src/a"],
      allowedTools: ["read_file"],
    }, dataDir);
    expect(reviewer).toMatchObject({ name: "reviewer", status: "queued" });
    await expect(addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "reviewer",
      instruction: "重复成员",
    }, dataDir)).rejects.toMatchObject({ code: "invalid_input" });

    const delivery = await sendGlobalSubtaskMessage({
      projectId,
      orchestrationId: team.id,
      recipientNames: ["reviewer"],
      text: "请增加中断恢复检查。",
    }, dataDir);
    expect(delivery).toMatchObject({ recipients: [reviewer.id], recipientNames: ["reviewer"] });
    await expect(claimGlobalSubtaskMessages(projectId, team.id, reviewer.id, dataDir)).resolves.toEqual([
      expect.objectContaining({ from: "parent", text: "请增加中断恢复检查。" }),
    ]);

    await expect(closeGlobalTeam(projectId, team.id, dataDir)).resolves.toMatchObject({
      success: false,
      activeMembers: ["reviewer"],
    });
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    await completeAgentExecution({
      projectId,
      executionId: dispatched.dispatched[0].agentExecutionId!,
      status: "succeeded",
      resultSummary: "复核完成",
    }, dataDir);
    await refreshGlobalOrchestration(projectId, team.id, dataDir);
    await expect(closeGlobalTeam(projectId, team.id, dataDir)).resolves.toMatchObject({ success: true });
  });

  it("uses a persistent named mailbox, resumes stopped teammates, and completes the shutdown handshake", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "team-result",
      triggerNodeId: "team-trigger",
      parentTurnId: "parent-turn",
      teamName: "implementation",
    }, dataDir);
    const alice = await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "alice",
      instruction: "实现功能",
    }, dataDir);
    const bob = await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "bob",
      instruction: "复核功能",
    }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const aliceExecutionId = dispatched.dispatched.find((task) => task.id === alice.id)?.agentExecutionId;
    const bobExecutionId = dispatched.dispatched.find((task) => task.id === bob.id)?.agentExecutionId;
    expect(aliceExecutionId).toBeTruthy();
    expect(bobExecutionId).toBeTruthy();

    await expect(sendGlobalTeamMessage({
      projectId,
      orchestrationId: team.id,
      senderSubtaskId: alice.id,
      executionId: aliceExecutionId!,
      to: "bob",
      summary: "Review Windows behavior",
      message: "请优先复核 Windows 行为。",
    }, dataDir)).resolves.toMatchObject({
      recipients: ["bob"],
      recipientAgentIds: [bob.id],
      reactivatedAgentIds: [],
    });
    await expect(claimGlobalSubtaskMessages(projectId, team.id, bob.id, dataDir)).resolves.toEqual([
      expect.objectContaining({
        from: "subagent",
        senderName: "alice",
        recipientName: "bob",
        summary: "Review Windows behavior",
      }),
    ]);

    await completeAgentExecution({
      projectId,
      executionId: bobExecutionId!,
      status: "succeeded",
      resultSummary: "首次复核完成",
    }, dataDir);
    await refreshGlobalOrchestration(projectId, team.id, dataDir);
    await expect(sendGlobalTeamMessage({
      projectId,
      orchestrationId: team.id,
      senderSubtaskId: alice.id,
      executionId: aliceExecutionId!,
      to: "bob",
      message: "请补充复核恢复路径。",
    }, dataDir)).resolves.toMatchObject({
      recipients: ["bob"],
      reactivatedAgentIds: [bob.id],
    });
    await expect(getAgentExecution(projectId, bobExecutionId!, dataDir)).resolves.toMatchObject({ status: "running" });

    const shutdown = await sendGlobalSubtaskMessage({
      projectId,
      orchestrationId: team.id,
      recipientNames: ["alice"],
      kind: "shutdown_request",
      text: "当前工作已经完成，请退出。",
    }, dataDir);
    expect(shutdown.requestId).toBeTruthy();
    await expect(claimGlobalSubtaskMessages(projectId, team.id, alice.id, dataDir)).resolves.toEqual([
      expect.objectContaining({ kind: "shutdown_request", requestId: shutdown.requestId }),
    ]);
    await expect(sendGlobalTeamMessage({
      projectId,
      orchestrationId: team.id,
      senderSubtaskId: alice.id,
      executionId: aliceExecutionId!,
      to: "team-lead",
      kind: "shutdown_response",
      message: "已保存进度，可以退出。",
      requestId: shutdown.requestId,
      approve: true,
    }, dataDir)).resolves.toMatchObject({ recipients: ["team-lead"] });
    await expect(sendGlobalTeamMessage({
      projectId,
      orchestrationId: team.id,
      senderSubtaskId: alice.id,
      executionId: aliceExecutionId!,
      to: "team-lead",
      kind: "shutdown_response",
      message: "重复响应。",
      requestId: shutdown.requestId,
      approve: true,
    }, dataDir)).rejects.toMatchObject({ code: "invalid_status" });
  });

  it("persists the cc-haha teammate plan approval handshake and resumes the same execution", async () => {
    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "parent-source",
      parentTurnId: "parent-turn",
      teamName: "planned-team",
    }, dataDir);
    const member = await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "planner",
      instruction: "先规划再实现",
      planModeRequired: true,
    }, dataDir);
    expect(member.allowedTools).toContain("exit_plan_mode");
    const dispatched = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const executionId = dispatched.dispatched[0].agentExecutionId!;

    const request = await requestGlobalTeamPlanApproval({
      projectId,
      orchestrationId: team.id,
      subtaskId: member.id,
      executionId,
      plan: "1. 阅读实现\n2. 修改代码\n3. 运行测试",
    }, dataDir);
    expect(request.requestId).toBeTruthy();
    await expect(getAgentExecution(projectId, executionId, dataDir)).resolves.toMatchObject({
      id: executionId,
      stage: "waitingApproval",
      status: "running",
    });
    await expect(getGlobalOrchestration(projectId, team.id, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        id: member.id,
        status: "waitingApproval",
        planApproval: expect.objectContaining({ requestId: request.requestId, status: "pending" }),
      })],
    });

    await expect(respondGlobalTeamPlanApproval({
      projectId,
      orchestrationId: team.id,
      teammateName: "planner",
      requestId: request.requestId,
      approve: false,
      feedback: "补充失败回滚步骤",
    }, dataDir)).resolves.toMatchObject({ approved: false, agentExecutionId: executionId });
    await expect(getAgentExecution(projectId, executionId, dataDir)).resolves.toMatchObject({ stage: "planning" });
    await expect(claimGlobalSubtaskMessages(projectId, team.id, member.id, dataDir)).resolves.toEqual([
      expect.objectContaining({
        kind: "plan_approval_response",
        requestId: request.requestId,
        approve: false,
        feedback: "补充失败回滚步骤",
      }),
    ]);
  });

  it("treats identical relative paths in different Workspace Roots as isolated tasks", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-global-agent-additional-"));
    try {
      await fs.mkdir(path.join(additionalRoot, "src", "a"), { recursive: true });
      await fs.writeFile(path.join(additionalRoot, "src", "a", "index.ts"), "export const additional = true;\n");
      const withAdditional = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const primaryRootId = withAdditional.id;
      const additionalRootId = withAdditional.additionalRoots?.at(-1)?.id;
      expect(additionalRootId).toBeTruthy();

      const orchestration = await createGlobalOrchestration({
        projectId,
        resultNodeId: "global-node",
        triggerNodeId: "source-node",
        goal: "分别检查两个根中的同名模块",
        tasks: [
          { title: "主根", instruction: "检查主根", rootId: primaryRootId, allowedPathPrefixes: ["src/a"] },
          { title: "附加根", instruction: "检查附加根", rootId: additionalRootId, allowedPathPrefixes: ["src/a"] },
        ],
      }, dataDir);
      expect(orchestration.conflicts).toEqual([]);
      expect(orchestration.tasks.map((task) => task.rootId)).toEqual([primaryRootId, additionalRootId]);
      expect(orchestration.tasks.map((task) => task.rootDisplayName)).toEqual([
        path.basename(workspaceRoot),
        path.basename(additionalRoot),
      ]);
      expect(orchestration.tasks[1].baselineHashes).toHaveProperty("src/a/index.ts");

      const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
      const details = await Promise.all(dispatched.dispatched.map((task) =>
        getAgentExecution(projectId, task.agentExecutionId!, dataDir)));
      expect(details.map((detail) => detail?.context.workspaceRootId)).toEqual([primaryRootId, additionalRootId]);
      expect((await getLocalWorkspaceBinding(projectId, dataDir))?.additionalRoots).toHaveLength(1);
    } finally {
      await fs.rm(additionalRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
    }
  }, 30_000);

  it("does not grant user-question or Team coordination tools to a one-off Sub-agent", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "检查模块",
      tasks: [{
        title: "检查",
        instruction: "检查模块",
        allowedPathPrefixes: ["src/a"],
        allowedTools: ["read_file", "ask_user_question"],
      }],
    }, dataDir);

    expect(orchestration.tasks[0].allowedTools).toEqual(["read_file"]);
  });

  it("persists one structured context snapshot across orchestration reloads", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "structured-global-node",
      triggerNodeId: "structured-source-node",
      goal: "检查结构化上下文",
      currentNodeContext: "CURRENT_ORCHESTRATION_NODE",
      connectedGraphContext: "CONNECTED_ORCHESTRATION_GRAPH",
      conversationId: "orchestration-conversation",
      selectedNodeIds: ["node-a"],
      fileDocumentIds: ["file-a"],
      tasks: [{ title: "检查", instruction: "检查上下文", allowedPathPrefixes: ["src/a"] }],
    }, dataDir);

    expect(orchestration.contextSnapshot).toMatchObject({
      version: 1,
      instruction: { prompt: "检查结构化上下文" },
      currentNode: { content: "CURRENT_ORCHESTRATION_NODE" },
      graph: { connectedContext: "CONNECTED_ORCHESTRATION_GRAPH" },
      conversation: { conversationId: "orchestration-conversation" },
      references: { selectedNodeIds: ["node-a"], fileDocumentIds: ["file-a"] },
    });
    await expect(getGlobalOrchestration(projectId, orchestration.id, dataDir)).resolves.toMatchObject({
      contextSnapshot: orchestration.contextSnapshot,
    });
  });

  it("gives a default one-off Sub-agent the cc-haha development tool pool without lifecycle tools", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "实现并验证模块",
      tasks: [{
        title: "实现",
        instruction: "修改模块并运行测试",
        allowedPathPrefixes: ["src/a"],
      }],
    }, dataDir);

    expect(orchestration.tasks[0].allowedTools).toEqual(expect.arrayContaining([
      "read_file",
      "edit_file",
      "apply_patch",
      "shell_command",
      "code_diagnostics",
      "skill",
    ]));
    for (const disallowed of [
      "ask_user_question",
      "delegate_tasks",
      "send_message",
      "task_output",
      "task_stop",
      "task_list",
      "todo_write",
    ] as const) expect(orchestration.tasks[0].allowedTools).not.toContain(disallowed);
  });

  it("dispatches non-overlapping Sub-agents in parallel with isolated ChangeSets", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "并行修改两个模块",
      concurrencyLimit: 2,
      contextEvidence: [{ kind: "pathScope", id: "src", reason: "用户目标涉及两个模块" }],
      tasks: [
        { title: "模块 A", instruction: "修改 A", allowedPathPrefixes: ["src/a"] },
        { title: "模块 B", instruction: "修改 B", allowedPathPrefixes: ["src/b"] },
      ],
    }, dataDir);
    expect(orchestration.conflicts).toEqual([]);
    expect(orchestration.tasks[0].baselineHashes).toHaveProperty("src/a/index.ts");
    expect(orchestration.tasks[0].baselineHashes).not.toHaveProperty("src/b/index.ts");

    const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    expect(dispatched.dispatched).toHaveLength(2);
    const [left, right] = dispatched.dispatched;
    expect(left.agentExecutionId).not.toBe(right.agentExecutionId);

    await executeAgentWorkspaceTool({
      projectId,
      executionId: left.agentExecutionId!,
      name: "propose_patch",
      arguments: { title: "A", operations: [{ kind: "modify", relativePath: "src/a/index.ts", proposedContent: "export const a = 2;\n" }] },
    }, dataDir);
    await executeAgentWorkspaceTool({
      projectId,
      executionId: right.agentExecutionId!,
      name: "propose_patch",
      arguments: { title: "B", operations: [{ kind: "modify", relativePath: "src/b/index.ts", proposedContent: "export const b = 2;\n" }] },
    }, dataDir);
    await completeAgentExecution({ projectId, executionId: left.agentExecutionId!, status: "succeeded", resultSummary: "A 完成" }, dataDir);
    await completeAgentExecution({ projectId, executionId: right.agentExecutionId!, status: "failed", error: "B 测试失败" }, dataDir);

    const refreshed = await refreshGlobalOrchestration(projectId, orchestration.id, dataDir);
    expect(refreshed.status).toBe("failed");
    expect(refreshed.tasks.map((task) => task.changeSetIds.length)).toEqual([1, 1]);
    expect(refreshed.conflicts).toEqual([]);
    expect(refreshed.convergenceProposal).toMatchObject({
      suggestedLifecycle: "archived",
      foldExecutionDetails: true,
      preserveChangeSetIds: expect.arrayContaining(refreshed.tasks.flatMap((task) => task.changeSetIds)),
    });
    expect(refreshed.convergenceProposal?.rationale.join(" ")).toContain("不会因画布收敛被删除");
    await expect(fs.readFile(path.join(workspaceRoot, "src", "a", "index.ts"), "utf8")).resolves.toBe("export const a = 1;\n");
    await expect(fs.readFile(path.join(workspaceRoot, "src", "b", "index.ts"), "utf8")).resolves.toBe("export const b = 1;\n");
  }, 30_000);

  it("detects overlapping files before dispatch and enforces task scopes", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "同时修改同一文件",
      tasks: [
        { title: "A1", instruction: "修改 A", allowedPathPrefixes: ["src/a/index.ts"] },
        { title: "A2", instruction: "也修改 A", allowedPathPrefixes: ["src/a"] },
      ],
    }, dataDir);
    expect(orchestration.conflicts).toHaveLength(1);
    const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId: dispatched.dispatched[0].agentExecutionId!,
      name: "read_file",
      arguments: { relativePath: "src/b/index.ts" },
    }, dataDir)).rejects.toThrow("超出任务范围");
  });

  it("dispatches dependency tasks only after prerequisites succeed", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "串行任务",
      concurrencyLimit: 2,
      tasks: [
        { title: "基础", instruction: "先完成基础", allowedPathPrefixes: ["src/a"] },
        { title: "后续", instruction: "再完成后续", allowedPathPrefixes: ["src/b"], dependsOn: [0] },
      ],
    }, dataDir);
    const first = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    expect(first.dispatched.map((task) => task.title)).toEqual(["基础"]);
    await completeAgentExecution({ projectId, executionId: first.dispatched[0].agentExecutionId!, status: "succeeded", resultSummary: "基础接口已确定" }, dataDir);
    await refreshGlobalOrchestration(projectId, orchestration.id, dataDir);
    const second = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    expect(second.dispatched.map((task) => task.title)).toEqual(["后续"]);
    await expect(getAgentExecution(projectId, second.dispatched[0].agentExecutionId!, dataDir)).resolves.toMatchObject({
      instruction: expect.stringContaining("基础接口已确定"),
    });
  });

  it("persists parent steering in active Sub-agent mailboxes and claims it only once", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "source-node",
      parentTurnId: "parent-turn",
      goal: "检查模块",
      tasks: [
        { title: "A", instruction: "检查 A", allowedPathPrefixes: ["src/a"] },
        { title: "B", instruction: "检查 B", allowedPathPrefixes: ["src/b"] },
      ],
    }, dataDir);
    await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);

    await expect(broadcastProjectTurnMessageToSubagents(
      projectId,
      "parent-turn",
      "优先检查边界条件",
      dataDir,
    )).resolves.toHaveLength(2);
    await expect(sendGlobalSubtaskMessage({
      projectId,
      orchestrationId: orchestration.id,
      subtaskIds: [orchestration.tasks[0].id],
      text: "同时补充回归测试",
    }, dataDir)).resolves.toMatchObject({ recipients: [orchestration.tasks[0].id] });

    await expect(claimGlobalSubtaskMessages(projectId, orchestration.id, orchestration.tasks[0].id, dataDir))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ from: "parent", text: "优先检查边界条件", readAt: expect.any(String) }),
        expect.objectContaining({ from: "parent", text: "同时补充回归测试", readAt: expect.any(String) }),
      ]));
    await expect(claimGlobalSubtaskMessages(projectId, orchestration.id, orchestration.tasks[0].id, dataDir))
      .resolves.toEqual([]);
  });

  it("persists Sub-agent reports for the parent without delivering them back to the child", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "parent-execution",
      triggerNodeId: "source-node",
      parentTurnId: "parent-turn",
      goal: "检查模块",
      tasks: [{ title: "A", instruction: "检查 A", allowedPathPrefixes: ["src/a"] }],
    }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    const task = dispatched.dispatched[0];

    await expect(sendGlobalSubtaskReport({
      projectId,
      orchestrationId: orchestration.id,
      subtaskId: task.id,
      executionId: task.agentExecutionId!,
      kind: "progress",
      summary: "接口检查完成",
      text: "发现调用方还需要补一个边界测试。",
    }, dataDir)).resolves.toMatchObject({
      from: "subagent",
      kind: "progress",
      summary: "接口检查完成",
    });
    await expect(sendGlobalSubtaskReport({
      projectId,
      orchestrationId: orchestration.id,
      subtaskId: task.id,
      executionId: "another-execution",
      kind: "blocked",
      summary: "越权报告",
      text: "不应写入。",
    }, dataDir)).rejects.toMatchObject({ code: "invalid_status" });

    await expect(claimGlobalSubtaskMessages(projectId, orchestration.id, task.id, dataDir)).resolves.toEqual([]);
    await expect(getGlobalOrchestration(projectId, orchestration.id, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        messages: [expect.objectContaining({ from: "subagent", text: "发现调用方还需要补一个边界测试。" })],
      })],
    });
  });

  it("keeps one-off and Team tool pools separate when shell access is requested", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "运行项目检查",
      tasks: [{
        title: "检查",
        instruction: "运行测试",
        allowedPathPrefixes: ["src"],
        allowedTools: ["read_file", "shell_command"],
      }],
    }, dataDir);

    const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    await expect(getAgentExecution(projectId, dispatched.dispatched[0].agentExecutionId!, dataDir)).resolves.toMatchObject({
      context: { allowedTools: ["read_file", "shell_command"] },
    });

    const team = await createGlobalTeam({
      projectId,
      resultNodeId: "team-node",
      triggerNodeId: "team-source",
      teamName: "verification",
    }, dataDir);
    await addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: "tester",
      instruction: "运行测试",
      allowedPathPrefixes: ["src"],
      allowedTools: ["read_file", "shell_command"],
    }, dataDir);
    const teamDispatch = await dispatchGlobalSubtasks(projectId, team.id, dataDir);
    const teamDetail = await getAgentExecution(projectId, teamDispatch.dispatched[0].agentExecutionId!, dataDir);
    expect(teamDetail?.context.allowedTools).toEqual(expect.arrayContaining([
      "read_file",
      "shell_command",
      "task_create",
      "task_get",
      "task_list",
      "task_update",
    ]));
    expect(teamDetail?.context.allowedTools).not.toContain("task_output");
    expect(teamDetail?.context.allowedTools).not.toContain("task_stop");
  });

  it("retries one failed Sub-agent independently and stops the active orchestration safely", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      resultNodeId: "global-node",
      triggerNodeId: "source-node",
      goal: "重试失败任务",
      tasks: [{ title: "可重试任务", instruction: "修改 A", allowedPathPrefixes: ["src/a"] }],
    }, dataDir);
    const dispatched = await dispatchGlobalSubtasks(projectId, orchestration.id, dataDir);
    const task = dispatched.dispatched[0];
    await completeAgentExecution({
      projectId,
      executionId: task.agentExecutionId!,
      status: "failed",
      error: "temporary failure",
    }, dataDir);
    await refreshGlobalOrchestration(projectId, orchestration.id, dataDir);

    const retried = await retryGlobalSubtask(projectId, orchestration.id, task.id, dataDir);
    expect(retried.status).toBe("running");
    await expect(getAgentExecution(projectId, task.agentExecutionId!, dataDir)).resolves.toMatchObject({
      status: "running",
      stage: "planning",
    });

    const stopped = await stopGlobalOrchestration(projectId, orchestration.id, dataDir);
    expect(stopped.status).toBe("stopped");
    expect(stopped.tasks[0].status).toBe("stopped");
    await expect(getGlobalOrchestration(projectId, orchestration.id, dataDir)).resolves.toMatchObject({
      status: "stopped",
      tasks: [expect.objectContaining({ status: "stopped" })],
    });
    await expect(getAgentExecution(projectId, task.agentExecutionId!, dataDir)).resolves.toMatchObject({ status: "stopped" });
  });
});
