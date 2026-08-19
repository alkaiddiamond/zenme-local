import { afterEach, describe, expect, it, vi } from "vitest";

import { executeAgentWorkspaceToolFromApi, runProjectAgentTurnFromApi, steerProjectAgentTurnFromApi, stopProjectAgentTurnFromApi } from "@/lib/zenme-api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Project Agent Turn API client", () => {
  it("starts once and polls durable server state until the Turn settles", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "running", turnId: "turn-1" }, 202))
      .mockResolvedValueOnce(jsonResponse({ status: "completed", turnId: "turn-1", answer: "完成" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = runProjectAgentTurnFromApi({
      projectId: "project-1",
      prompt: "检查项目",
      model: "provider:model",
      contextSnapshot: {
        version: 1,
        instruction: { prompt: "检查项目" },
        currentNode: { content: "当前节点" },
        conversation: { conversationId: "conv-1" },
      },
      permissionMode: "neverAsk",
      turnId: "turn-1",
      questionAnswer: { eventId: "question-1", value: "核心工具" },
    });
    await vi.advanceTimersByTimeAsync(400);

    await expect(result).resolves.toEqual({ status: "completed", turnId: "turn-1", answer: "完成" });
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      contextSnapshot: {
        version: 1,
        instruction: { prompt: "检查项目" },
        currentNode: { content: "当前节点" },
        conversation: { conversationId: "conv-1" },
      },
      permissionMode: "neverAsk",
      questionAnswer: { eventId: "question-1", value: "核心工具" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      "/api/projects/project-1/agent-session/turns?turnId=turn-1",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses an explicit stop endpoint instead of treating renderer cancellation as execution cancellation", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ stopped: true, turnId: "turn-2" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stopProjectAgentTurnFromApi("project-1", "turn-2"))
      .resolves.toEqual({ stopped: true, turnId: "turn-2" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/agent-session/turns?turnId=turn-2",
      { method: "DELETE" },
    );
  });

  it("adds a steering message to the active server-owned Turn without starting another poll", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ revision: 2, status: "steered", turnId: "turn-2" }, 202));
    vi.stubGlobal("fetch", fetchMock);

    await expect(steerProjectAgentTurnFromApi({ projectId: "project-1", prompt: "同时打开预览", turnId: "turn-2" }))
      .resolves.toEqual({ revision: 2, status: "steered", turnId: "turn-2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)))
      .toEqual({ prompt: "同时打开预览", steer: true, turnId: "turn-2" });
  });

  it("associates an approved command request with one durable progress event", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "command-1", status: "succeeded" }));
    vi.stubGlobal("fetch", fetchMock);

    await executeAgentWorkspaceToolFromApi({
      projectId: "project-1",
      executionId: "execution-1",
      name: "run_approved_command",
      arguments: { commandRequestId: "command-1" },
      progressEventId: "event-1",
    });

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      action: "tool",
      name: "run_approved_command",
      arguments: { commandRequestId: "command-1" },
      progressEventId: "event-1",
    });
  });
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
