import type { CanvasNode } from "@/components/zenme/canvas/types";
import { getCanvasNodeCapability } from "@/components/zenme/canvas/node-capabilities";

export type ExecutionPreflightIssue = {
  code:
    | "node_not_found"
    | "node_not_executable"
    | "prompt_missing"
    | "model_missing"
    | "model_unavailable";
  message: string;
  field?: "model" | "prompt";
};

export function inspectCanvasNodeExecution(input: {
  availableModelIds: string[];
  node?: CanvasNode;
  requestedModel?: string;
  requestedPrompt?: string;
}) {
  const issues: ExecutionPreflightIssue[] = [];
  if (!input.node) {
    issues.push({ code: "node_not_found", message: "待执行节点不存在" });
    return { issues, ok: false as const };
  }

  const capability = getCanvasNodeCapability(input.node.data.kind);
  if (!capability.executable || !capability.executionKind) {
    issues.push({
      code: "node_not_executable",
      message: "该节点不支持直接执行",
    });
    return { issues, ok: false as const };
  }

  const prompt = resolvePrompt(input.node, input.requestedPrompt);
  if (!prompt) {
    issues.push({
      code: "prompt_missing",
      field: "prompt",
      message: "请输入提示词后再执行",
    });
  }

  const model = resolveModel(input.node, input.requestedModel);
  if (!model) {
    issues.push({
      code: "model_missing",
      field: "model",
      message: "请先配置并选择模型",
    });
  } else if (!input.availableModelIds.includes(model)) {
    issues.push({
      code: "model_unavailable",
      field: "model",
      message: "所选模型未启用或所属服务商已不可用",
    });
  }

  return {
    issues,
    kind: capability.executionKind,
    model,
    ok: issues.length === 0,
    prompt,
  };
}

function resolvePrompt(node: CanvasNode, requestedPrompt?: string) {
  const requested = requestedPrompt?.trim();
  if (requested) return requested;
  if (node.data.kind === "imageGeneration" || node.data.kind === "image") {
    return node.data.imagePrompt?.trim() ?? "";
  }
  if (node.data.kind === "videoGeneration") return node.data.videoPrompt?.trim() ?? "";
  return (
    node.data.textGenerationPrompt?.trim() ||
    node.data.aiPrompt?.trim() ||
    node.data.plainText?.trim() ||
    ""
  );
}

function resolveModel(node: CanvasNode, requestedModel?: string) {
  const requested = requestedModel?.trim();
  if (requested) return requested;
  if (node.data.kind === "imageGeneration" || node.data.kind === "image") {
    return node.data.imageModel?.trim() ?? "";
  }
  if (node.data.kind === "videoGeneration") return node.data.videoModel?.trim() ?? "";
  return (
    node.data.textGenerationModel?.trim() ||
    node.data.aiModel?.trim() ||
    ""
  );
}
