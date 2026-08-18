import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("text generation request boundary", () => {
  it("keeps CanvasClient from owning AI chat request details", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");

    expect(source).toContain("requestTextGenerationResponse");
    expect(source).not.toContain('fetch("/api/ai/chat"');
    expect(source).not.toContain("readAiChatStream(");
    expect(source).not.toContain("没有可用的上游上下文。");
  });

  it("routes the composer beneath an existing node into the unified Project Agent", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");

    expect(source).toContain("const submitNodeToProjectAgent = useCallback");
    expect(source).toContain("onSubmitTextGenerationNode: submitNodeToProjectAgent");
    expect(source).toContain("runProjectAgentTurnFromApi");
    expect(source).toContain("createAiResponseChildCanvasNode");
    expect(source).toContain("agentTurnId: turnId");
    expect(source).toContain("steerProjectAgentTurnFromApi");
    expect(source).toContain("onSteerTextGenerationNode: steerNodeProjectAgent");
    expect(source).toContain("turnId,");
    const nodeSubmitSource = source.slice(
      source.indexOf("const submitNodeToProjectAgent"),
      source.indexOf("const stopNodeProjectAgent"),
    );
    expect(nodeSubmitSource).not.toContain("setIsAgentOpen(true)");
    expect(source).not.toContain('onSubmitTextGenerationNode: submitTextGenerationNode');
  });

  it("routes every canvas Agent entry into the same AI reply node composer", () => {
    const canvasSource = readProjectFile("components/zenme/canvas-client.tsx");
    const menuSource = readProjectFile("components/zenme/canvas/menus.tsx");

    expect(canvasSource).toContain("createUnifiedAgentPrompt");
    expect(menuSource).toContain('onCreateConnectedPlaceholder("textGeneration")');
    expect(canvasSource).not.toContain("<AgentPanel");
    expect(canvasSource).not.toContain("<GlobalAgentDialog");
    expect(canvasSource).not.toContain("<WorkspaceAgentTaskDialog");
    expect(menuSource).toContain("继续对话或执行任务");
    expect(menuSource).not.toContain("作为 Workspace Agent 任务运行");
    expect(menuSource).not.toContain("作为 Agent 任务运行");
  });

  it("passes structured upstream node and file references into Project Agent turns", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");
    const nodeSubmitSource = source.slice(
      source.indexOf("const submitNodeToProjectAgent"),
      source.indexOf("const stopNodeProjectAgent"),
    );

    expect(nodeSubmitSource).toContain("collectAgentTurnReferences");
    expect(nodeSubmitSource).toContain("fileDocumentIds: references.fileDocumentIds");
    expect(nodeSubmitSource).toContain("selectedNodeIds: references.selectedNodeIds");
    expect(nodeSubmitSource).not.toContain("selectedNodeIds: [sourceNode.id]");
  });

  it("remounts the canvas session when navigating between projects", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");

    expect(source).toContain("<ReactFlowProvider key={props.projectId}>");
  });

  it("allows the text node composer to submit an empty prompt", () => {
    const source = readProjectFile(
      "components/zenme/nodes/text-node-composer.tsx",
    );

    expect(source).toContain(
      "!configuredModels.some((option) => option.id === model)",
    );
    expect(source).not.toContain("!prompt.trim()");
    expect(source).not.toContain("!nextPrompt || isGenerating");
  });

  it("gives the node composer functional Codex-style controls", () => {
    const source = readProjectFile(
      "components/zenme/nodes/text-node-composer.tsx",
    );

    expect(source).toContain('aria-label="节点对话框"');
    expect(source).toContain('aria-label="会话权限"');
    expect(source).toContain('aria-label="添加图片上下文"');
    expect(source).toContain("imageDataUrls: images.map");
    expect(source).toContain("nodeData.onStopTextGenerationNode?.(nodeId)");
    expect(source).toContain("nodeData.onSteerTextGenerationNode?.(nodeId, nextPrompt)");
    expect(source).toContain('isGenerating ? "追加指令"');
    expect(source).toContain("createImagePreview(file)");
    expect(source).toContain('fetch("/api/settings"');
    expect(source).toContain("getProjectAgentSessionFromApi(nodeData.projectId)");
    expect(source).toContain("updateProjectAgentSessionPermissionFromApi(nodeData.projectId, nextMode)");
    expect(source).not.toContain("defaultSessionPermissionMode: nextMode");
    expect(source).toContain('aria-label="推理强度"');
    expect(source).toContain("reasoningEffort,");
    expect(source).toContain("modelSpeed,");
    expect(source).toContain("permissionMode,");
  });

  it("retries a failed AI reply in the same node and Project Agent Turn", () => {
    const source = readProjectFile("components/zenme/nodes/text-node.tsx");
    const canvasSource = readProjectFile("components/zenme/canvas-client.tsx");
    const timeline = readProjectFile("components/zenme/nodes/agent-turn-timeline.tsx");

    expect(source).toContain("onRetry={() => nodeData.onSubmitTextGenerationNode?.(id,");
    expect(source).toContain("prompt: nodeData.aiPrompt");
    expect(source).toContain("model: nodeData.aiModel || nodeData.textGenerationModel");
    expect(source).toContain("retryExistingTurn: true");
    expect(canvasSource).toContain("const retryExistingTurn = input?.retryExistingTurn === true");
    expect(canvasSource).toContain("const turnId = retryExistingTurn ? sourceNode.data.agentTurnId! : crypto.randomUUID()");
    expect(canvasSource).toContain("const resultNodeId = retryExistingTurn ? nodeId : crypto.randomUUID()");
    expect(canvasSource).toContain("resume: retryExistingTurn");
    expect(timeline).toContain("projectTurnCanRetry(events) && onRetry");
    expect(timeline).toContain("重试");
    expect(timeline).toContain("border-zinc-200");
    expect(timeline).not.toContain("border-red-200 bg-white px-3 text-xs font-medium text-red-700");
  });

  it("carries image context and an abort signal through the unified Project Agent", () => {
    const canvasSource = readProjectFile("components/zenme/canvas-client.tsx");
    const apiSource = readProjectFile("lib/zenme-api.ts");
    const modelSource = readProjectFile("lib/agent/project-agent-model.ts");

    expect(canvasSource).toContain("collectTextGenerationImageUrls");
    expect(canvasSource).toContain("fetchImageAsDataUrl(url)");
    expect(canvasSource).toContain("imageDataUrls: mergedImageDataUrls");
    expect(canvasSource).toContain("signal: controller.signal");
    expect(canvasSource).toContain("active.controller.abort()");
    expect(canvasSource).toContain("stopProjectAgentTurnFromApi(projectId");
    expect(apiSource).toContain("imageDataUrls: input.imageDataUrls");
    expect(modelSource).toContain("imageDataUrls: input.imageDataUrls");
  });

  it("does not write implicit source text back into the composer", () => {
    const source = readProjectFile("components/zenme/canvas-client.tsx");

    expect(source).toContain("prompt: input?.prompt");
    expect(source).not.toContain("prompt: preflight.prompt");
  });

  it("does not paint an empty composer placeholder as selected", () => {
    const source = readProjectFile("app/globals.css");

    expect(source).toContain(
      ".zenme-text-ai-input:placeholder-shown::selection",
    );
    expect(source).toContain(
      ".zenme-text-ai-input:placeholder-shown::-moz-selection",
    );
    expect(source).toContain("background-color: transparent");
  });

  it("uses the same compact model picker as image nodes", () => {
    for (const filePath of [
      "components/zenme/nodes/text-generation-node.tsx",
      "components/zenme/nodes/text-node-composer.tsx",
    ]) {
      const source = readProjectFile(filePath);

      expect(source).toMatch(/<ZenmeModelPicker\s+compact/);
      expect(source).toContain('<Sparkles className="size-3.5" />');
    }
  });

  it("uses matching arrow and pending-square submit buttons across nodes", () => {
    for (const filePath of [
      "components/zenme/nodes/text-generation-node.tsx",
      "components/zenme/nodes/text-node-composer.tsx",
      "components/zenme/nodes/image-edit-node.tsx",
      "components/zenme/nodes/image-node.tsx",
    ]) {
      const source = readProjectFile(filePath);

      expect(source).toContain(
        '<ArrowUp className="size-5" strokeWidth={1.75} />',
      );
      expect(source).toContain('className="size-4 rounded-[2px] bg-white"');
      expect(source).toContain("focus-visible:shadow-[var(--shadow-focus-ring)]");
    }
  });
});
