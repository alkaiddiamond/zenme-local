import { AGENT_CONTEXT_PRIORITY } from "@/lib/agent/context-model";

const CONTEXT_PRIORITY_LABELS: Record<(typeof AGENT_CONTEXT_PRIORITY)[number], string> = {
  instruction: "当前用户指令",
  currentNode: "当前节点",
  graph: "显式连线/选择的画布上下文",
  conversation: "当前 Conversation 历史",
  project: "Project 背景",
};

export function formatAgentCanvasContext(input: {
  currentNodeContext?: string;
  connectedGraphContext?: string;
  legacyCanvasContext?: string;
}) {
  const currentNodeContext = input.currentNodeContext?.trim();
  const connectedGraphContext = input.connectedGraphContext?.trim();
  const legacyCanvasContext = input.legacyCanvasContext?.trim();
  const hasLayeredCanvasContext = Boolean(currentNodeContext || connectedGraphContext);

  if (!hasLayeredCanvasContext) {
    return legacyCanvasContext
      ? `本轮明确选择的画布上下文：\n${legacyCanvasContext.slice(0, 200_000)}`
      : "";
  }

  return [
    `当前上下文优先级：${AGENT_CONTEXT_PRIORITY.map((layer) => CONTEXT_PRIORITY_LABELS[layer]).join(" > ")}。较低层级不得覆盖较高层级表达的当前意图。`,
    currentNodeContext
      ? `当前节点（本轮主要语义焦点）：\n${currentNodeContext.slice(0, 200_000)}`
      : "",
    connectedGraphContext
      ? `显式连线的上游画布上下文（背景与依赖，不得替代当前节点）：\n${connectedGraphContext.slice(0, 200_000)}`
      : "",
  ].filter(Boolean).join("\n\n");
}

export function buildAgentRetrievalQuery(input: {
  instruction: string;
  currentNodeContext?: string;
}) {
  const instruction = input.instruction.trim();
  const currentNodeContext = input.currentNodeContext?.trim();
  return [
    instruction ? `当前指令：\n${instruction.slice(0, 20_000)}` : "",
    currentNodeContext ? `当前节点：\n${currentNodeContext.slice(0, 40_000)}` : "",
  ].filter(Boolean).join("\n\n");
}
