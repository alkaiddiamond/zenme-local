import type { CanvasNodeData } from "@/components/zenme/node-types";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

export type AgentContextEntry = {
  nodeId: string;
  kind: CanvasNodeData["kind"];
  content: string;
};

export type AgentProjectContextLayer = {
  summary?: string;
};

export type AgentConversationContextLayer = {
  conversationId?: string;
  events: ProjectAgentEvent[];
  summary?: string;
};

export type AgentGraphContextLayer = {
  directParents: AgentContextEntry[];
  ancestors: AgentContextEntry[];
  selectedNodes: AgentContextEntry[];
  connectedContext?: string;
};

export type AgentCurrentNodeContextLayer = {
  content: string;
  nodeId?: string;
  kind?: CanvasNodeData["kind"];
} | null;

export type AgentCurrentInstructionLayer = {
  prompt: string;
};

export type AgentContextLayers = {
  project: AgentProjectContextLayer;
  conversation: AgentConversationContextLayer;
  graph: AgentGraphContextLayer;
  currentNode: AgentCurrentNodeContextLayer;
  instruction: AgentCurrentInstructionLayer;
};

export function createAgentContextLayers(input: {
  projectSummary?: string;
  conversationId?: string;
  conversationSummary?: string;
  conversationEvents?: ProjectAgentEvent[];
  currentNodeContext?: string;
  connectedGraphContext?: string;
  prompt: string;
}): AgentContextLayers {
  return {
    project: { summary: input.projectSummary },
    conversation: {
      conversationId: input.conversationId,
      events: input.conversationEvents ?? [],
      summary: input.conversationSummary,
    },
    graph: {
      directParents: [],
      ancestors: [],
      selectedNodes: [],
      connectedContext: input.connectedGraphContext,
    },
    currentNode: input.currentNodeContext
      ? { content: input.currentNodeContext }
      : null,
    instruction: { prompt: input.prompt },
  };
}

export type AgentContextSnapshot = {
  version: 1;
  instruction: { prompt: string };
  currentNode?: { content: string };
  graph?: { connectedContext: string };
  conversation?: { conversationId: string };
  references?: {
    selectedNodeIds?: string[];
    fileDocumentIds?: string[];
  };
  legacy?: { canvasContext?: string };
};

export function createAgentContextSnapshot(input: {
  prompt: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  selectedNodeIds?: string[];
  fileDocumentIds?: string[];
}): AgentContextSnapshot {
  return {
    version: 1,
    instruction: { prompt: input.prompt },
    ...(input.currentNodeContext ? { currentNode: { content: input.currentNodeContext } } : {}),
    ...(input.connectedGraphContext ? { graph: { connectedContext: input.connectedGraphContext } } : {}),
    ...(input.conversationId ? { conversation: { conversationId: input.conversationId } } : {}),
    ...((input.selectedNodeIds?.length || input.fileDocumentIds?.length) ? {
      references: {
        ...(input.selectedNodeIds?.length ? { selectedNodeIds: [...input.selectedNodeIds] } : {}),
        ...(input.fileDocumentIds?.length ? { fileDocumentIds: [...input.fileDocumentIds] } : {}),
      },
    } : {}),
  };
}

export function applyAgentContextSnapshot<T extends {
  prompt: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  selectedNodeIds?: string[];
  fileDocumentIds?: string[];
  canvasContext?: string;
  contextSnapshot?: AgentContextSnapshot;
}>(input: T): T {
  const snapshot = input.contextSnapshot;
  if (!snapshot || snapshot.version !== 1) return input;
  return {
    ...input,
    prompt: snapshot.instruction?.prompt || input.prompt,
    currentNodeContext: snapshot.currentNode?.content ?? input.currentNodeContext,
    connectedGraphContext: snapshot.graph?.connectedContext ?? input.connectedGraphContext,
    conversationId: snapshot.conversation?.conversationId ?? input.conversationId,
    selectedNodeIds: snapshot.references?.selectedNodeIds ?? input.selectedNodeIds,
    fileDocumentIds: snapshot.references?.fileDocumentIds ?? input.fileDocumentIds,
    canvasContext: snapshot.legacy?.canvasContext ?? input.canvasContext,
  };
}

export function parseAgentContextSnapshot(value: unknown): AgentContextSnapshot | undefined {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.instruction) ||
    typeof value.instruction.prompt !== "string") return undefined;
  const currentNode = isRecord(value.currentNode) && typeof value.currentNode.content === "string"
    ? { content: value.currentNode.content }
    : undefined;
  const graph = isRecord(value.graph) && typeof value.graph.connectedContext === "string"
    ? { connectedContext: value.graph.connectedContext }
    : undefined;
  const conversation = isRecord(value.conversation) && typeof value.conversation.conversationId === "string"
    ? { conversationId: value.conversation.conversationId }
    : undefined;
  const references = isRecord(value.references)
    ? {
        selectedNodeIds: stringValues(value.references.selectedNodeIds),
        fileDocumentIds: stringValues(value.references.fileDocumentIds),
      }
    : undefined;
  const legacy = isRecord(value.legacy) && typeof value.legacy.canvasContext === "string"
    ? { canvasContext: value.legacy.canvasContext }
    : undefined;
  return {
    version: 1,
    instruction: { prompt: value.instruction.prompt },
    ...(currentNode ? { currentNode } : {}),
    ...(graph ? { graph } : {}),
    ...(conversation ? { conversation } : {}),
    ...(references ? { references } : {}),
    ...(legacy ? { legacy } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

export const AGENT_CONTEXT_PRIORITY = [
  "instruction",
  "currentNode",
  "graph",
  "conversation",
  "project",
] as const;
