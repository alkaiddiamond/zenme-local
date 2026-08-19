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
};

export type AgentGraphContextLayer = {
  directParents: AgentContextEntry[];
  ancestors: AgentContextEntry[];
  selectedNodes: AgentContextEntry[];
};

export type AgentCurrentNodeContextLayer = AgentContextEntry | null;

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

export const AGENT_CONTEXT_PRIORITY = [
  "instruction",
  "currentNode",
  "graph",
  "conversation",
  "project",
] as const;
