import type { Edge, Node } from "@xyflow/react";

import type { AgentMessage } from "@/components/zenme/agent-types";
import type { CanvasNodeData } from "@/components/zenme/node-types";

export type SaveStatus = "未保存" | "保存中" | "已保存" | "保存失败" | "离线";

export type Viewport = { x: number; y: number; zoom: number };

export type CanvasNode = Node<CanvasNodeData>;

export type CanvasSnapshot = {
  version: 1;
  nodes: CanvasNode[];
  edges: Edge[];
  viewport: Viewport;
  updatedAt: string;
};

export type CanvasHistorySnapshotEntry = {
  type?: "snapshot";
  nodes: CanvasNode[];
  edges: Edge[];
};

export type CanvasHistoryNodeUpdate = {
  after: CanvasNode;
  before: CanvasNode;
  id: string;
};

export type CanvasHistoryEdgeUpdate = {
  after: Edge;
  before: Edge;
  id: string;
};

export type CanvasHistoryCommandEntry = {
  type: "updateNodes";
  updates: CanvasHistoryNodeUpdate[];
};

export type CanvasHistoryCreateEntry = {
  edges: Edge[];
  nodes: CanvasNode[];
  type: "createCanvasItems";
};

export type CanvasHistoryDeleteEntry = {
  edges: Edge[];
  nodes: CanvasNode[];
  type: "deleteCanvasItems";
};

export type CanvasHistoryMutateEntry = {
  createdEdges: Edge[];
  createdNodes: CanvasNode[];
  deletedEdges: Edge[];
  deletedNodes: CanvasNode[];
  edgeUpdates: CanvasHistoryEdgeUpdate[];
  nodeUpdates: CanvasHistoryNodeUpdate[];
  type: "mutateCanvasItems";
};

export type CanvasHistoryEntry =
  | CanvasHistorySnapshotEntry
  | CanvasHistoryCommandEntry
  | CanvasHistoryCreateEntry
  | CanvasHistoryDeleteEntry
  | CanvasHistoryMutateEntry;

export type AgentSessionSnapshot = {
  version: 1;
  input: string;
  messages: AgentMessage[];
  model: string;
  updatedAt: string;
};

export type NodeActionMenuState = {
  flowPosition: { x: number; y: number };
  nodeId: string;
  x: number;
  y: number;
};

export type CanvasAddMenuState = {
  flowPosition: { x: number; y: number };
  x: number;
  y: number;
};
