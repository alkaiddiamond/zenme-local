"use client";

import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Connection,
  Edge,
  MiniMap,
  NodeChange,
  ReactFlow,
  ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { AgentPanel } from "@/components/zenme/agent-panel";
import type { AgentMessage } from "@/components/zenme/agent-types";
import { useAiModelOptions } from "@/components/zenme/use-ai-model-options";
import {
  CanvasAgentButton,
  CanvasBottomControls,
  CanvasNotice,
  CanvasSelectionToolbar,
  CanvasSideToolbar,
  EmptyCanvasHint,
} from "@/components/zenme/canvas/controls";
import {
  getConnectedPlaceholderPosition,
  getNextConnectedChildNodePosition,
} from "@/components/zenme/canvas/child-layout";
import {
  CanvasAddMenu,
  NodeActionMenu,
} from "@/components/zenme/canvas/menus";
import {
  createNodeActionMenuFromConnectEnd,
  normalizeCanvasConnection,
} from "@/components/zenme/canvas/connections";
import { CanvasProjectStatus } from "@/components/zenme/canvas/project-status";
import { nodeTypes } from "@/components/zenme/nodes";
import {
  getCanvasSnapshotFromApi,
  getProjectFromApi,
  editImageWithOpenRouter,
  uploadProjectFileToApi,
} from "@/lib/zenme-api";
import {
  modelOptions,
  ZENME_AGENT_KEY_PREFIX,
} from "@/lib/zenme";
import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import { createDroppedFileCanvasNodes } from "@/components/zenme/canvas/drop-files";
import { parseDroppedReadingNotePayload } from "@/components/zenme/canvas/drop-payload";
import {
  canPrepareReadingAsset,
  getActionNode,
  getGroupableNodes,
  getSaveStatusIcon,
  getSaveStatusTone,
  getSelectionToolbarPosition,
} from "@/components/zenme/canvas/derived-state";
import {
  loadAgentSessionSnapshot,
  saveAgentSessionSnapshot,
} from "@/components/zenme/canvas/agent-session";
import { createAgentContextFromActionNode } from "@/components/zenme/canvas/agent-context";
import { requestTextGenerationResponse } from "@/components/zenme/canvas/text-generation-request";
import { getRenderedCanvasEdges } from "@/components/zenme/canvas/edges";
import {
  createCanvasHistoryEntry,
  createCanvasHistoryNodeSnapshot,
  createWelcomeNodes,
  getCanvasHistorySignature,
  getClientPointFromConnectEnd,
  isEditableTarget,
  isNodeDimensionChange,
  normalizeGroupNodeRelations,
  removeLegacyWelcomeNodes,
} from "@/components/zenme/canvas/geometry";
import {
  createGroupSelectionUpdate,
  detachGroupedNodeIfOutside,
  getGroupFrameDragMove,
  moveGroupedNodesWithFrame as moveGroupedNodesWithFrameState,
  releaseGroupedNodeDragExtent,
  type GroupDragPosition,
} from "@/components/zenme/canvas/groups";
import {
  createCanvasDeleteSelection,
  isDeleteKeyboardShortcut,
  isUndoKeyboardShortcut,
} from "@/components/zenme/canvas/keyboard";
import {
  createCanvasItemsHistoryEntry,
  createDeletedCanvasItemsHistoryEntry,
  createMutateCanvasItemsHistoryEntry,
  createNodeUpdateHistoryEntry,
  getCanvasHistoryState,
  getCanvasPersistableSignature,
} from "@/components/zenme/canvas/history-state";
import {
  collectTextGenerationContext,
  getCanvasNodeContextText,
} from "@/components/zenme/canvas/text-generation-context";
import {
  createConnectedPlaceholderCanvasNode,
  createDroppedReadingNoteCanvasNode,
  createAiResponseChildCanvasNode,
  createReadingNoteCanvasNode,
  createTextChildCanvasNode,
  createTextCanvasNode,
} from "@/components/zenme/canvas/node-factories";
import {
  createImageEditNodeDataUpdate,
  createTextGenerationNodeDataUpdate,
  createTextNodeDataUpdate,
} from "@/components/zenme/canvas/node-updates";
import { createCanvasAddMenuFromPaneDoubleClick } from "@/components/zenme/canvas/pane-menu";
import {
  clampCanvasZoom,
  createCanvasZoomViewport,
  getNextCanvasZoom,
} from "@/components/zenme/canvas/viewport";
import type {
  CanvasAddMenuState,
  CanvasHistoryEntry,
  CanvasNode,
  CanvasSnapshot,
  NodeActionMenuState,
  SaveStatus,
  Viewport,
} from "@/components/zenme/canvas/types";
import {
  createCanvasThumbnail,
  refreshImageNodeUrls,
  saveCanvasSnapshot,
} from "@/components/zenme/canvas/persistence";
import {
  measureCanvasPerf,
  measureCanvasPerfAsync,
  observeCanvasLongTasks,
  scheduleCanvasIdleTask,
  startCanvasInteractionSample,
  stopCanvasInteractionSample,
  tickCanvasInteractionSample,
} from "@/components/zenme/canvas/performance";
import { createPerformanceSeedCanvas } from "@/components/zenme/canvas/performance-seed";
import { prepareReadingAssetForCanvasNode } from "@/components/zenme/canvas/reading-assets";
import { createOpenReadingWorkspaceUpdate } from "@/components/zenme/canvas/reading-workspace-update";
import { createReaderCollapseUpdate } from "@/components/zenme/canvas/reader-collapse";
import { getRenderedCanvasNodes } from "@/components/zenme/canvas/rendered-nodes";
import {
  buildImageEditPrompt,
  DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
  DEFAULT_IMAGE_EDIT_QUALITY,
  getImageEditResultNodeSize,
} from "@/components/zenme/image-edit-options";
import { NODE_CONTEXT_HANDLE_ID } from "@/components/zenme/node-types";

type CanvasClientProps = {
  projectId: string;
};

const THUMBNAIL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MISSING_THUMBNAIL_REFRESH_DELAY_MS = 1200;
const DEFAULT_EDGE_OPTIONS = {
  type: "default",
  style: { stroke: "#9ca3af", strokeWidth: 2 },
};
const MINI_MAP_CLASS =
  "!bottom-[66px] !left-3 !right-auto !top-auto !m-0 !h-[150px] !w-[200px] !overflow-hidden !rounded-2xl !border !border-zinc-200 !bg-white/95 !shadow-xl !backdrop-blur";

export function CanvasClient({ projectId }: CanvasClientProps) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasNode>(createWelcomeNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlow, setReactFlow] =
    useState<ReactFlowInstance<CanvasNode, Edge>>();
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isMiniMapSuspended, setIsMiniMapSuspended] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [canvasViewport, setCanvasViewport] = useState<Viewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("已保存");
  const [autoSaveIntervalMs, setAutoSaveIntervalMs] = useState(5_000);
  const [lastSavedAt, setLastSavedAt] = useState<string>();
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState<string | null>(null);
  const [agentContext, setAgentContext] = useState<string>();
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [agentIsSubmitting, setAgentIsSubmitting] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentModel, setAgentModel] = useState(modelOptions[0]);
  const configuredModelOptions = useAiModelOptions();
  const configuredImageModelOptions = useAiModelOptions("image");
  const configuredModelIds = useMemo(
    () => configuredModelOptions.map((option) => option.id),
    [configuredModelOptions],
  );
  const defaultTextModel = configuredModelOptions[0]?.id ?? modelOptions[0];
  const [nodeActionMenu, setNodeActionMenu] =
    useState<NodeActionMenuState | null>(null);
  const [canvasAddMenu, setCanvasAddMenu] =
    useState<CanvasAddMenuState | null>(null);
  const [pendingViewport, setPendingViewport] = useState<Viewport | null>(null);
  const [canvasLoaded, setCanvasLoaded] = useState(false);
  const [canvasHydrated, setCanvasHydrated] = useState(false);
  const [hasProjectThumbnail, setHasProjectThumbnail] = useState(false);
  const [isContextConnecting, setIsContextConnecting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailSaveCancelIdle = useRef<(() => void) | null>(null);
  const thumbnailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const isCanvasSaveInFlight = useRef(false);
  const canvasSaveInFlightIncludesThumbnail = useRef(false);
  const queuedCanvasSaveRequest = useRef<{
    includeThumbnail: boolean;
  } | null>(null);
  const isHydrating = useRef(true);
  const isRefreshingUrls = useRef(false);
  const nodesRef = useRef<CanvasNode[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);
  const canvasViewportStateRef = useRef<Viewport>(canvasViewport);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadPosition = useRef<{ x: number; y: number } | null>(null);
  const didInitViewport = useRef(false);
  const appliedViewportSignature = useRef<string | null>(null);
  const perfSeedDidRun = useRef(false);
  const perfSampleDidRun = useRef(false);
  const connectingNodeId = useRef<string | null>(null);
  const connectingHandleId = useRef<string | null>(null);
  const didConnectToNode = useRef(false);
  const canvasHistory = useRef<CanvasHistoryEntry[]>([]);
  const canvasHistorySignature = useRef("");
  const savedCanvasSignature = useRef("");
  const pendingCanvasSignature = useRef("");
  const isCanvasInteractionActive = useRef(false);
  const skipNextHistoryEntryCount = useRef(0);
  const dragInteractionSample = useRef<ReturnType<
    typeof startCanvasInteractionSample
  > | null>(null);
  const dragStartNodeSnapshots = useRef<Map<string, CanvasNode> | null>(null);
  const resizeInteractionSample = useRef<ReturnType<
    typeof startCanvasInteractionSample
  > | null>(null);
  const resizeHistoryFrame = useRef<number | null>(null);
  const resizeStartNodeSnapshots = useRef<Map<string, CanvasNode> | null>(null);
  const pushNodeUpdateHistoryRef = useRef<
    (beforeNodeSnapshots: Map<string, CanvasNode>, afterNodes: CanvasNode[]) => void
  >(() => {});
  const groupDragPosition = useRef<GroupDragPosition | null>(null);

  const agentKey = `${ZENME_AGENT_KEY_PREFIX}${projectId}`;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { settings?: { autoSaveIntervalMs?: number } } | null) => {
        const interval = payload?.settings?.autoSaveIntervalMs;
        if (!cancelled && typeof interval === "number" && Number.isFinite(interval)) {
          setAutoSaveIntervalMs(Math.min(300_000, Math.max(5_000, interval)));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return observeCanvasLongTasks({ projectId });
  }, [projectId]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    canvasViewportStateRef.current = canvasViewport;
  }, [canvasViewport]);

  useEffect(() => {
    reactFlowRef.current = reactFlow ?? null;
  }, [reactFlow]);

  const canvasItemsSignature = useMemo(
    () =>
      measureCanvasPerf(
        "persistable canvas items signature",
        () => getCanvasHistorySignature(nodes, edges),
        {
          edges: edges.length,
          nodes: nodes.length,
        },
      ),
    [edges, nodes],
  );
  const canvasPersistableSignature = useMemo(
    () =>
      JSON.stringify({
        canvas: canvasItemsSignature,
        viewport: {
          x: Number(canvasViewport.x.toFixed(2)),
          y: Number(canvasViewport.y.toFixed(2)),
          zoom: Number(canvasViewport.zoom.toFixed(4)),
        },
      }),
    [canvasItemsSignature, canvasViewport],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const hasActiveDragChange = changes.some(
        (change) =>
          change.type === "position" &&
          "dragging" in change &&
          change.dragging,
      );
      const hasActiveResizeChange = changes.some(
        (change) =>
          change.type === "dimensions" &&
          "resizing" in change &&
          change.resizing,
      );
      if (hasActiveResizeChange && !resizeStartNodeSnapshots.current) {
        resizeStartNodeSnapshots.current = new Map(
          nodes.map((node) => [
            node.id,
            createCanvasHistoryNodeSnapshot(node),
          ]),
        );
      }
      if (hasActiveResizeChange && !resizeInteractionSample.current) {
        resizeInteractionSample.current = startCanvasInteractionSample(
          "interaction resize",
          {
            edges: edges.length,
            nodes: nodes.length,
          },
        );
      }
      if (hasActiveDragChange || hasActiveResizeChange) {
        isCanvasInteractionActive.current = true;
        setIsMiniMapSuspended(true);
        skipNextHistoryEntryCount.current += 1;
      }
      if (hasActiveResizeChange) {
        tickCanvasInteractionSample(resizeInteractionSample.current);
      }
      const hasResizeEndChange = changes.some(
        (change) =>
          change.type === "dimensions" &&
          "resizing" in change &&
          change.resizing === false,
      );
      if (
        changes.some(
          (change) =>
            (change.type === "position" &&
              "dragging" in change &&
              change.dragging === false) ||
            hasResizeEndChange,
        )
      ) {
        isCanvasInteractionActive.current = false;
        setIsMiniMapSuspended(false);
      }
      if (hasResizeEndChange && resizeInteractionSample.current) {
        stopCanvasInteractionSample(resizeInteractionSample.current, {
          edges: edges.length,
          nodes: nodes.length,
        });
        resizeInteractionSample.current = null;
      }

      onNodesChange(changes);

      const dimensionChanges = changes.filter(isNodeDimensionChange);

      if (dimensionChanges.length === 0) {
        return;
      }

      if (hasResizeEndChange && resizeStartNodeSnapshots.current) {
        if (resizeHistoryFrame.current) {
          window.cancelAnimationFrame(resizeHistoryFrame.current);
        }

        resizeHistoryFrame.current = window.requestAnimationFrame(() => {
          resizeHistoryFrame.current = null;
          const beforeNodeSnapshots = resizeStartNodeSnapshots.current;
          resizeStartNodeSnapshots.current = null;

          if (!beforeNodeSnapshots) {
            return;
          }

          pushNodeUpdateHistoryRef.current(
            beforeNodeSnapshots,
            reactFlow?.getNodes() ?? nodes,
          );
        });
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const change = dimensionChanges.find(
            (item) => item.id === node.id,
          );

          if (
            !change ||
            !change.dimensions ||
            (node.data.kind !== "reader" &&
              node.data.kind !== "text" &&
              node.data.kind !== "agent" &&
              node.data.kind !== "textGeneration")
          ) {
            return node;
          }

          const nextSize = {
            height: change.dimensions.height,
            width: change.dimensions.width,
          };

          return {
            ...node,
            height: nextSize.height,
            measured: { ...nextSize },
            style: {
              ...node.style,
              ...nextSize,
            },
            width: nextSize.width,
            data:
              node.data.kind === "reader"
                ? {
                    ...node.data,
                    readerExpandedSize: nextSize,
                  }
                : node.data,
          };
        }),
      );
    },
    [edges.length, nodes, onNodesChange, reactFlow, setNodes],
  );
  const edgeNodeKindSignature = useMemo(
    () => nodes.map((node) => `${node.id}:${node.data.kind}`).join("|"),
    [nodes],
  );
  const edgeNodeKindById = useMemo(() => {
    const nodeKindById = new Map<string, CanvasNode["data"]["kind"]>();

    for (const item of edgeNodeKindSignature.split("|")) {
      if (!item) {
        continue;
      }

      const separatorIndex = item.indexOf(":");
      if (separatorIndex === -1) {
        continue;
      }

      const nodeId = item.slice(0, separatorIndex);
      const nodeKind = item.slice(separatorIndex + 1) as CanvasNode["data"]["kind"];
      nodeKindById.set(nodeId, nodeKind);
    }

    return nodeKindById;
  }, [edgeNodeKindSignature]);
  const renderedEdges = useMemo(
    () => getRenderedCanvasEdges(edgeNodeKindById, edges),
    [edgeNodeKindById, edges],
  );

  const resetCanvasHistory = useCallback(
    (
      historyNodes: CanvasNode[],
      historyEdges: Edge[],
      viewport = canvasViewportStateRef.current,
    ) => {
      const historyEntry = measureCanvasPerf(
        "history entry",
        () => createCanvasHistoryEntry(historyNodes, historyEdges),
        {
          edges: historyEdges.length,
          nodes: historyNodes.length,
        },
      );
      canvasHistory.current = [historyEntry.entry];
      canvasHistorySignature.current = historyEntry.signature;
      savedCanvasSignature.current = getCanvasPersistableSignature(
        historyNodes,
        historyEdges,
        viewport,
      );
      pendingCanvasSignature.current = savedCanvasSignature.current;
    },
    [],
  );

  const pushCanvasHistory = useCallback(
    (historyNodes: CanvasNode[], historyEdges: Edge[]) => {
      const historyEntry = measureCanvasPerf(
        "history entry",
        () => createCanvasHistoryEntry(historyNodes, historyEdges),
        {
          edges: historyEdges.length,
          nodes: historyNodes.length,
        },
      );

      if (canvasHistorySignature.current === historyEntry.signature) {
        return;
      }

      canvasHistory.current = [
        ...canvasHistory.current.slice(-49),
        historyEntry.entry,
      ];
      canvasHistorySignature.current = historyEntry.signature;
    },
    [],
  );

  const pushNodeUpdateHistory = useCallback(
    (beforeNodeSnapshots: Map<string, CanvasNode>, afterNodes: CanvasNode[]) => {
      const entry = measureCanvasPerf(
        "history command moveNodes",
        () => createNodeUpdateHistoryEntry(beforeNodeSnapshots, afterNodes),
        {
          nodes: afterNodes.length,
        },
      );

      if (!entry) {
        return;
      }

      canvasHistory.current = [...canvasHistory.current.slice(-49), entry];
      canvasHistorySignature.current = measureCanvasPerf(
        "history signature",
        () => getCanvasHistorySignature(afterNodes, edges),
        {
          edges: edges.length,
          nodes: afterNodes.length,
        },
      );
    },
    [edges],
  );

  const pushCreateHistory = useCallback(
    (input: {
      afterEdges: Edge[];
      afterNodes: CanvasNode[];
      edges?: Edge[];
      nodes?: CanvasNode[];
    }) => {
      const entry = createCanvasItemsHistoryEntry({
        edges: input.edges,
        nodes: input.nodes,
      });
      if (!entry) {
        return;
      }

      canvasHistory.current = [...canvasHistory.current.slice(-49), entry];
      canvasHistorySignature.current = measureCanvasPerf(
        "history signature",
        () => getCanvasHistorySignature(input.afterNodes, input.afterEdges),
        {
          edges: input.afterEdges.length,
          nodes: input.afterNodes.length,
        },
      );
    },
    [],
  );

  const pushDeleteHistory = useCallback(
    (input: {
      afterEdges: Edge[];
      afterNodes: CanvasNode[];
      edges: Edge[];
      nodes: CanvasNode[];
    }) => {
      const entry = createDeletedCanvasItemsHistoryEntry({
        edges: input.edges,
        nodes: input.nodes,
      });
      if (!entry) {
        return;
      }

      canvasHistory.current = [...canvasHistory.current.slice(-49), entry];
      canvasHistorySignature.current = measureCanvasPerf(
        "history signature",
        () => getCanvasHistorySignature(input.afterNodes, input.afterEdges),
        {
          edges: input.afterEdges.length,
          nodes: input.afterNodes.length,
        },
      );
    },
    [],
  );
  const pushMutateHistory = useCallback(
    (input: {
      afterEdges: Edge[];
      afterNodes: CanvasNode[];
      createdEdges?: Edge[];
      createdNodes?: CanvasNode[];
      deletedEdges?: Edge[];
      deletedNodes?: CanvasNode[];
      edgeUpdates?: Array<{ after: Edge; before: Edge; id: string }>;
      nodeUpdates?: Array<{ after: CanvasNode; before: CanvasNode; id: string }>;
    }) => {
      const entry = createMutateCanvasItemsHistoryEntry(input);
      if (!entry) {
        return;
      }

      canvasHistory.current = [...canvasHistory.current.slice(-49), entry];
      canvasHistorySignature.current = measureCanvasPerf(
        "history signature",
        () => getCanvasHistorySignature(input.afterNodes, input.afterEdges),
        {
          edges: input.afterEdges.length,
          nodes: input.afterNodes.length,
        },
      );
    },
    [],
  );
  const appendCanvasItems = useCallback(
    (input: {
      currentEdges: Edge[];
      currentNodes: CanvasNode[];
      edges?: Edge[];
      nodes?: CanvasNode[];
    }) => {
      const createdNodes = input.nodes ?? [];
      const createdEdges = input.edges ?? [];

      if (createdNodes.length === 0 && createdEdges.length === 0) {
        return;
      }

      const nextNodes = [...input.currentNodes, ...createdNodes];
      const nextEdges = [...input.currentEdges, ...createdEdges];
      skipNextHistoryEntryCount.current += 1;
      setNodes(nextNodes);
      setEdges(nextEdges);
      pushCreateHistory({
        afterEdges: nextEdges,
        afterNodes: nextNodes,
        edges: createdEdges,
        nodes: createdNodes,
      });
    },
    [pushCreateHistory, setEdges, setNodes],
  );
  const bringNodeToFront = useCallback(
    (nodeId: string) => {
      setNodes((currentNodes) => {
        const targetNode = currentNodes.find((node) => node.id === nodeId);

        if (!targetNode) {
          return currentNodes;
        }

        const maxZIndex = Math.max(
          0,
          ...currentNodes.map((node) => node.zIndex ?? 0),
        );

        if ((targetNode.zIndex ?? 0) >= maxZIndex) {
          return currentNodes;
        }

        return currentNodes.map((node) =>
          node.id === nodeId ? { ...node, zIndex: maxZIndex + 1 } : node,
        );
      });
    },
    [setNodes],
  );
  useEffect(() => {
    pushNodeUpdateHistoryRef.current = pushNodeUpdateHistory;
  }, [pushNodeUpdateHistory]);

  useEffect(() => {
    async function loadCanvas() {
      isHydrating.current = true;
      didInitViewport.current = false;
      appliedViewportSignature.current = null;
      setCanvasLoaded(false);
      setCanvasHydrated(false);
      setPendingViewport(null);
      try {
        await getProjectFromApi(projectId);
        setHasProjectThumbnail(false);
        const remoteSnapshot = await getCanvasSnapshotFromApi(projectId);

        if (remoteSnapshot) {
          const snapshot = remoteSnapshot.snapshot as CanvasSnapshot;
          const restored = removeLegacyWelcomeNodes(
            snapshot.nodes.length ? snapshot.nodes : createWelcomeNodes(),
            snapshot.edges,
          );
          const restoredNodes = normalizeGroupNodeRelations(restored.nodes);
          setNodes(restoredNodes);
          setEdges(restored.edges);
          resetCanvasHistory(
            restoredNodes,
            restored.edges,
            snapshot.viewport ?? canvasViewportStateRef.current,
          );
          setLastSavedAt(snapshot.updatedAt ?? remoteSnapshot.updated_at);
          if (snapshot.viewport) {
            setCanvasViewport(snapshot.viewport);
            setPendingViewport(snapshot.viewport);
          }

          // 云端模式下重签已上传图片节点的签名 URL，避免签名 1 小时过期导致图片 403。
          void refreshImageNodeUrls(restoredNodes, setNodes, isRefreshingUrls);
        } else {
          resetCanvasHistory(createWelcomeNodes(), []);
        }
      } catch {
        setSaveStatus("保存失败");
      } finally {
        setCanvasLoaded(true);
        // 放开 isHydrating 延后一帧：确保 setNodes/setEdges 触发的 effect 先被屏蔽，
        // 避免快照回流把"已保存"误改写为"未保存"。
        requestAnimationFrame(() => {
          isHydrating.current = false;
          setCanvasHydrated(true);
        });
      }
    }

    loadCanvas();
  }, [projectId, resetCanvasHistory, setEdges, setNodes]);

  useEffect(() => {
    const snapshot = loadAgentSessionSnapshot(
      agentKey,
      defaultTextModel,
      configuredModelIds,
    );
    if (!snapshot) {
      return;
    }

    setAgentInput(snapshot.input);
    setAgentMessages(snapshot.messages);
    setAgentModel(snapshot.model);
  }, [agentKey, configuredModelIds, defaultTextModel]);

  useEffect(() => {
    saveAgentSessionSnapshot({
      key: agentKey,
      messages: agentMessages,
      model: agentModel,
      prompt: agentInput,
    });
  }, [agentInput, agentKey, agentMessages, agentModel]);

  useEffect(() => {
    if (isHydrating.current || isRefreshingUrls.current) {
      return;
    }

    const nextSignature = canvasPersistableSignature;
    pendingCanvasSignature.current = nextSignature;
    if (savedCanvasSignature.current === nextSignature) {
      return;
    }

    setSaveStatus((current) => (current === "保存中" ? current : "未保存"));
  }, [canvasPersistableSignature]);

  useEffect(() => {
    if (!canvasLoaded || isHydrating.current || isRefreshingUrls.current) {
      return;
    }

    if (skipNextHistoryEntryCount.current > 0) {
      skipNextHistoryEntryCount.current -= 1;
      return;
    }

    if (historyTimer.current) {
      clearTimeout(historyTimer.current);
    }

    historyTimer.current = setTimeout(() => {
      measureCanvasPerf("history fallback snapshot", () => null, {
        edges: edges.length,
        nodes: nodes.length,
      });
      pushCanvasHistory(nodes, edges);
      historyTimer.current = null;
    }, 500);

    return () => {
      if (historyTimer.current) {
        clearTimeout(historyTimer.current);
        historyTimer.current = null;
      }
    };
  }, [canvasLoaded, edges, nodes, pushCanvasHistory]);

  useEffect(() => {
    function handleCanvasKeyboardShortcuts(event: KeyboardEvent) {
      if (isUndoKeyboardShortcut(event)) {
        if (canvasHistory.current.length <= 1) {
          return;
        }

        event.preventDefault();
        const nextHistory = canvasHistory.current.slice(0, -1);
        const previous = getCanvasHistoryState(nextHistory);

        if (!previous) {
          return;
        }

        canvasHistory.current = nextHistory;
        canvasHistorySignature.current = getCanvasHistorySignature(
          previous.nodes,
          previous.edges,
        );
        skipNextHistoryEntryCount.current += 1;
        setNodes(previous.nodes);
        setEdges(previous.edges);
        setNodeActionMenu(null);
        setCanvasAddMenu(null);
        return;
      }

      if (!isDeleteKeyboardShortcut(event)) {
        return;
      }

      const deleteSelection = createCanvasDeleteSelection({ edges, nodes });
      if (!deleteSelection) {
        return;
      }

      event.preventDefault();

      skipNextHistoryEntryCount.current += 1;
      setNodes(deleteSelection.nextNodes);
      setEdges(deleteSelection.nextEdges);
      pushDeleteHistory({
        afterEdges: deleteSelection.nextEdges,
        afterNodes: deleteSelection.nextNodes,
        edges: deleteSelection.deletedEdges,
        nodes: deleteSelection.deletedNodes,
      });
      setNodeActionMenu(null);
      setCanvasAddMenu(null);
    }

    window.addEventListener("keydown", handleCanvasKeyboardShortcuts);

    return () => {
      window.removeEventListener("keydown", handleCanvasKeyboardShortcuts);
    };
  }, [edges, nodes, pushDeleteHistory, setEdges, setNodes]);

  // 画布视口在 ReactFlow 实例就绪、数据加载完成后恢复一次。
  // 有已保存视口时恢复视口；无保存视口但已有节点时只初始化 fitView 一次。
  // 空画布不自动 fitView，避免第一个手动创建节点后被重新居中。
  useEffect(() => {
    if (!reactFlow || !canvasLoaded) {
      return;
    }

    if (pendingViewport) {
      const viewportSignature = JSON.stringify({
        x: Number(pendingViewport.x.toFixed(2)),
        y: Number(pendingViewport.y.toFixed(2)),
        zoom: Number(pendingViewport.zoom.toFixed(4)),
      });

      if (appliedViewportSignature.current === viewportSignature) {
        return;
      }

      appliedViewportSignature.current = viewportSignature;
      didInitViewport.current = true;
      requestAnimationFrame(() => {
        const viewport = {
          x: pendingViewport.x,
          y: pendingViewport.y,
          zoom: pendingViewport.zoom,
        };
        setCanvasViewport(viewport);
        reactFlow.setViewport(viewport);
      });
      return;
    }

    if (didInitViewport.current) {
      return;
    }

    didInitViewport.current = true;
    if (nodes.length > 0) {
      requestAnimationFrame(() => {
        void reactFlow.fitView({ duration: 0, padding: 0.16 });
      });
    }
  }, [reactFlow, canvasLoaded, nodes.length, pendingViewport]);

  useEffect(() => {
    if (
      perfSeedDidRun.current ||
      !canvasLoaded ||
      !canvasHydrated ||
      isHydrating.current
    ) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const seedValue = params.get("zenmePerfSeed");
    const isExplicitDevelopmentSeed =
      process.env.NODE_ENV !== "production" &&
      params.get("zenmePerfSeedDebug") === "1";
    if (!isExplicitDevelopmentSeed) {
      return;
    }

    if (!seedValue) {
      return;
    }

    const shouldReplace = params.get("zenmePerfSeedReplace") === "1";
    if (nodes.length > 0 && !shouldReplace) {
      return;
    }

    const count = Number(seedValue);
    if (!Number.isFinite(count) || count <= 0) {
      return;
    }

    const requestedEdgesPerRow = Number(params.get("zenmePerfEdgesPerRow"));
    const edgesPerRow =
      Number.isFinite(requestedEdgesPerRow) && requestedEdgesPerRow > 0
        ? Math.min(Math.max(Math.floor(requestedEdgesPerRow), 1), 20)
        : undefined;

    const seedCanvas = measureCanvasPerf(
      "performance seed canvas",
      () => createPerformanceSeedCanvas({ count, edgesPerRow }),
      { edgesPerRow: edgesPerRow ?? 1, requestedNodes: count },
    );

    perfSeedDidRun.current = true;
    skipNextHistoryEntryCount.current += 1;
    setNodes(seedCanvas.nodes);
    setEdges(seedCanvas.edges);
    resetCanvasHistory(seedCanvas.nodes, seedCanvas.edges);
  }, [
    canvasLoaded,
    canvasHydrated,
    nodes.length,
    resetCanvasHistory,
    setEdges,
    setNodes,
  ]);

  const createThumbnail = useCallback(async () => {
    if (nodesRef.current.length === 0) {
      return null;
    }

    return createCanvasThumbnail(canvasViewportRef.current);
  }, []);

  const scheduleThumbnailSave = useCallback(() => {
    if (!reactFlow) {
      return;
    }

    thumbnailSaveCancelIdle.current?.();
    thumbnailSaveCancelIdle.current = scheduleCanvasIdleTask(() => {
      thumbnailSaveCancelIdle.current = null;

      void (async () => {
        const thumbnail = await createThumbnail();
        if (!thumbnail) {
          return;
        }

        await saveCanvasSnapshot({
          edges,
          nodes,
          projectId,
          thumbnail,
          viewport: reactFlow.getViewport(),
        });
        setHasProjectThumbnail(true);
      })().catch(() => {
        // 缩略图后台刷新失败不影响画布快照保存状态。
      });
    }, 3000);
  }, [
    createThumbnail,
    edges,
    nodes,
    projectId,
    reactFlow,
  ]);

  const saveCanvas = useCallback(async (options?: { includeThumbnail?: boolean }) => {
    if (!reactFlow) {
      return;
    }

    const includeThumbnail = Boolean(options?.includeThumbnail);

    if (isCanvasSaveInFlight.current) {
      measureCanvasPerf(
        "save queue request",
        () => null,
        {
          includeThumbnail:
            includeThumbnail || canvasSaveInFlightIncludesThumbnail.current,
        },
      );
      queuedCanvasSaveRequest.current = {
        includeThumbnail:
          Boolean(queuedCanvasSaveRequest.current?.includeThumbnail) ||
          includeThumbnail ||
          canvasSaveInFlightIncludesThumbnail.current,
      };
      return;
    }

    isCanvasSaveInFlight.current = true;
    canvasSaveInFlightIncludesThumbnail.current = includeThumbnail;
    setSaveStatus("保存中");

    try {
      const snapshot = await saveCanvasSnapshot({
        edges,
        nodes,
        projectId,
        thumbnail: null,
        viewport: reactFlow.getViewport(),
      });

      savedCanvasSignature.current = canvasPersistableSignature;
      pendingCanvasSignature.current = savedCanvasSignature.current;
      setLastSavedAt(snapshot.updatedAt);
      setSaveStatus("已保存");
      if (includeThumbnail && !queuedCanvasSaveRequest.current) {
        scheduleThumbnailSave();
      }
    } catch {
      setSaveStatus("保存失败");
    } finally {
      isCanvasSaveInFlight.current = false;
      canvasSaveInFlightIncludesThumbnail.current = false;
      const queuedRequest = queuedCanvasSaveRequest.current;
      queuedCanvasSaveRequest.current = null;

      if (queuedRequest) {
        measureCanvasPerf(
          "save queue flush",
          () => null,
          {
            includeThumbnail: queuedRequest.includeThumbnail,
          },
        );
        void saveCanvasRef.current({
          includeThumbnail: queuedRequest.includeThumbnail,
        });
      }
    }
  }, [
    canvasPersistableSignature,
    edges,
    nodes,
    projectId,
    reactFlow,
    scheduleThumbnailSave,
  ]);

  // 用 ref 持有最新 saveCanvas，自动保存定时器只创建一次，
  // 避免持续编辑时 saveCanvas 随 state 重建导致缩略图定时器被反复重置。
  const saveCanvasRef = useRef(saveCanvas);
  useEffect(() => {
    saveCanvasRef.current = saveCanvas;
  }, [saveCanvas]);

  useEffect(() => {
    return () => {
      thumbnailSaveCancelIdle.current?.();
      thumbnailSaveCancelIdle.current = null;
      if (thumbnailTimer.current) {
        clearTimeout(thumbnailTimer.current);
        thumbnailTimer.current = null;
      }

      const flow = reactFlowRef.current;
      // 卸载时需要读取最新画布 DOM，确保快速返回首页前能生成当前缩略图。
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const viewportElement = canvasViewportRef.current;
      if (!flow || !viewportElement || isHydrating.current) {
        return;
      }

      void (async () => {
        if (nodesRef.current.length === 0) {
          return;
        }

        const thumbnail = await createCanvasThumbnail(viewportElement);
        if (!thumbnail) {
          return;
        }

        await saveCanvasSnapshot({
          edges: edgesRef.current,
          nodes: nodesRef.current,
          projectId,
          thumbnail,
          viewport: flow.getViewport(),
        });
      })().catch(() => {
        // 离开项目时的缩略图兜底失败不阻塞页面跳转。
      });
    };
  }, [projectId]);

  useEffect(() => {
    if (
      perfSampleDidRun.current ||
      !canvasLoaded ||
      !canvasHydrated ||
      isHydrating.current ||
      !reactFlow ||
      nodes.length === 0
    ) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const isExplicitDevelopmentSample =
      process.env.NODE_ENV !== "production" &&
      params.get("zenmePerfSeedDebug") === "1";
    if (!isExplicitDevelopmentSample) {
      return;
    }
    if (params.get("zenmePerfSample") !== "1") {
      return;
    }

    perfSampleDidRun.current = true;

    void (async () => {
      await measureCanvasPerfAsync(
        "performance sample fitView",
        async () => {
          await reactFlow.fitView({ duration: 0, padding: 0.12 });
        },
        {
          edges: edges.length,
          nodes: nodes.length,
        },
      );

      await measureCanvasPerfAsync(
        "performance sample save",
        async () => {
          await saveCanvasRef.current();
        },
        {
          edges: edges.length,
          nodes: nodes.length,
        },
      );

      if (params.get("zenmePerfSampleThumbnail") !== "1") {
        return;
      }

      await measureCanvasPerfAsync(
        "performance sample thumbnail",
        async () => {
          await createThumbnail();
        },
        {
          edges: edges.length,
          nodes: nodes.length,
        },
      );
    })().catch(() => {
      perfSampleDidRun.current = false;
    });
  }, [
    canvasHydrated,
    canvasLoaded,
    createThumbnail,
    edges.length,
    nodes.length,
    reactFlow,
  ]);

  useEffect(() => {
    saveTimer.current = setInterval(() => {
      void saveCanvasRef.current({ includeThumbnail: true });
    }, THUMBNAIL_REFRESH_INTERVAL_MS);

    return () => {
      if (saveTimer.current) {
        clearInterval(saveTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      !canvasLoaded ||
      isHydrating.current ||
      isRefreshingUrls.current ||
      saveStatus !== "未保存"
    ) {
      return;
    }

    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current);
    }

    autosaveTimer.current = setTimeout(() => {
      void saveCanvasRef.current();
    }, autoSaveIntervalMs);

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [autoSaveIntervalMs, canvasLoaded, edges, nodes, saveStatus]);

  useEffect(() => {
    if (
      !canvasLoaded ||
      isHydrating.current ||
      isRefreshingUrls.current ||
      !reactFlow
    ) {
      return;
    }

    const nextSignature = canvasPersistableSignature;
    if (savedCanvasSignature.current === nextSignature && hasProjectThumbnail) {
      return;
    }
    pendingCanvasSignature.current = nextSignature;

    if (thumbnailTimer.current) {
      clearTimeout(thumbnailTimer.current);
    }

    thumbnailTimer.current = setTimeout(() => {
      thumbnailTimer.current = null;

      if (isCanvasInteractionActive.current) {
        return;
      }

      void saveCanvasRef.current({ includeThumbnail: true });
    }, hasProjectThumbnail
      ? THUMBNAIL_REFRESH_INTERVAL_MS
      : MISSING_THUMBNAIL_REFRESH_DELAY_MS);

    return () => {
      if (thumbnailTimer.current) {
        clearTimeout(thumbnailTimer.current);
        thumbnailTimer.current = null;
      }
    };
  }, [
    canvasLoaded,
    canvasPersistableSignature,
    edges,
    hasProjectThumbnail,
    nodes,
    reactFlow,
  ]);

  const onConnect = useCallback(
    (connection: Connection) => {
      didConnectToNode.current = true;
      const normalizedConnection = normalizeCanvasConnection(connection, nodes);

      if (!normalizedConnection) {
        return;
      }

      const nextEdges = addEdge(normalizedConnection, edges);
      const previousEdgeIds = new Set(edges.map((edge) => edge.id));
      const createdEdges = nextEdges.filter(
        (edge) => !previousEdgeIds.has(edge.id),
      );

      if (createdEdges.length === 0) {
        return;
      }

      skipNextHistoryEntryCount.current += 1;
      setEdges(nextEdges);
      pushCreateHistory({
        afterEdges: nextEdges,
        afterNodes: nodes,
        edges: createdEdges,
      });
    },
    [edges, nodes, pushCreateHistory, setEdges],
  );

  function setCanvasZoom(value: number) {
    const zoom = clampCanvasZoom(value);
    setZoomLevel(zoom);
    if (!reactFlow) {
      return;
    }

    const nextViewport = createCanvasZoomViewport(reactFlow.getViewport(), zoom);
    setCanvasViewport(nextViewport);
    void reactFlow.setViewport(nextViewport, { duration: 120 });
  }

  function groupSelectedNodes() {
    const groupId = crypto.randomUUID();
    const update = createGroupSelectionUpdate({
      allNodes: nodes,
      groupId,
      selectedNodes: groupableNodes,
    });
    if (!update) {
      return;
    }

    skipNextHistoryEntryCount.current += 1;
    setNodes(update.nextNodes);
    pushMutateHistory({
      afterEdges: edges,
      afterNodes: update.nextNodes,
      createdNodes: update.createdGroupNode ? [update.createdGroupNode] : [],
      nodeUpdates: update.nodeUpdates,
    });
    setNodeActionMenu(null);
  }

  const updateTextNode = useCallback(
    (
      nodeId: string,
      updates: {
        codeContent?: string;
        codeLanguage?: string;
        plainText?: string;
        richTextHtml?: string;
        textMode?: "code" | "markdown" | "plain";
        title?: string;
      },
    ) => {
      const currentNodes = nodesRef.current;
      const update = createTextNodeDataUpdate({
        nodeId,
        nodes: currentNodes,
        updates,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      pushNodeUpdateHistory(update.beforeNodeSnapshots, update.nextNodes);
    },
    [pushNodeUpdateHistory, setNodes],
  );

  const updateTextGenerationNode = useCallback(
    (
      nodeId: string,
      updates: {
        textGenerationModel?: string;
        textGenerationPrompt?: string;
      },
    ) => {
      const currentNodes = nodesRef.current;
      const update = createTextGenerationNodeDataUpdate({
        nodeId,
        nodes: currentNodes,
        updates,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      pushNodeUpdateHistory(update.beforeNodeSnapshots, update.nextNodes);
    },
    [pushNodeUpdateHistory, setNodes],
  );

  const updateImageEditNode = useCallback(
    (
      nodeId: string,
      updates: {
        fileId?: string;
        imageEditAspectRatio?: string;
        imageEditError?: string;
        imageEditQuality?: string;
        imageEditPrompt?: string;
        imageEditStatus?: "idle" | "editing" | "done" | "failed";
        originalUrl?: string;
        previewUrl?: string;
        title?: string;
      },
    ) => {
      const currentNodes = nodesRef.current;
      const update = createImageEditNodeDataUpdate({
        nodeId,
        nodes: currentNodes,
        updates,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      pushNodeUpdateHistory(update.beforeNodeSnapshots, update.nextNodes);
    },
    [pushNodeUpdateHistory, setNodes],
  );

  const submitTextGenerationNode = useCallback(
    async (nodeId: string, input?: { model?: string; prompt?: string }) => {
      const currentNodes = reactFlow?.getNodes() ?? nodesRef.current;
      const currentEdges = reactFlow?.getEdges() ?? edges;
      const sourceNode = currentNodes.find((node) => node.id === nodeId);
      const prompt =
        input?.prompt?.trim() ??
        sourceNode?.data.textGenerationPrompt?.trim() ??
        "";
      const model =
        input?.model ?? sourceNode?.data.textGenerationModel ?? defaultTextModel;

      if (!sourceNode || !prompt) {
        return;
      }

      const ownContext = getCanvasNodeContextText(sourceNode);
      const upstreamContext = collectTextGenerationContext({
        edges: currentEdges,
        nodeId,
        nodes: currentNodes,
      });
      const context = [ownContext, upstreamContext].filter(Boolean).join("\n\n---\n\n");
      const result = await requestTextGenerationResponse({
        context,
        model,
        prompt,
      });
      if (!result) {
        return;
      }

      const position = getNextConnectedChildNodePosition({
        childFallbackSize: { height: 260, width: 620 },
        edges: currentEdges,
        nodes: currentNodes,
        sourceFallbackSize: { height: 180, width: 560 },
        sourceNode,
        yOffsetWithoutChild: 0,
      });
      const { edge: nextEdge, node: nextNode } =
        createAiResponseChildCanvasNode({
          id: crypto.randomUUID(),
          model,
          position,
          prompt,
          response: result,
          sourceNode,
        });

      appendCanvasItems({
        currentEdges,
        currentNodes,
        edges: [nextEdge],
        nodes: [nextNode],
      });
    },
    [appendCanvasItems, defaultTextModel, edges, reactFlow],
  );

  const submitImageEditNode = useCallback(
    async (
      nodeId: string,
      input?: { aspectRatio?: string; model?: string; prompt?: string; quality?: string },
    ) => {
      const currentNodes = reactFlow?.getNodes() ?? nodesRef.current;
      const sourceNode = currentNodes.find((node) => {
        if (node.id !== nodeId) {
          return false;
        }

        if (node.data.kind === "imageEdit") {
          return true;
        }

        return (
          node.data.kind === "image" &&
          Boolean(node.data.imageGenerated || node.data.imageEditPrompt)
        );
      });
      const prompt =
        input?.prompt?.trim() ?? sourceNode?.data.imageEditPrompt?.trim() ?? "";
      const aspectRatio =
        input?.aspectRatio ??
        sourceNode?.data.imageEditAspectRatio ??
        DEFAULT_IMAGE_EDIT_ASPECT_RATIO;
      const quality =
        input?.quality ??
        sourceNode?.data.imageEditQuality ??
        DEFAULT_IMAGE_EDIT_QUALITY;
      const sourceImageUrl =
        sourceNode?.data.kind === "imageEdit"
          ? sourceNode.data.sourceImageUrl
          : sourceNode?.data.originalUrl ?? sourceNode?.data.previewUrl;

      if (!sourceNode || !prompt || !sourceImageUrl) {
        return;
      }

      updateImageEditNode(nodeId, {
        imageEditAspectRatio: aspectRatio,
        imageEditError: undefined,
        imageEditQuality: quality,
        imageEditPrompt: prompt,
        imageEditStatus: "editing",
      });

      try {
        const imageDataUrl = await fetchImageAsDataUrl(sourceImageUrl);
        const edited = await editImageWithOpenRouter({
          imageDataUrl,
          model: input?.model ?? sourceNode.data.imageEditModel ?? configuredImageModelOptions[0]?.id ?? "",
          prompt: buildImageEditPrompt({
            aspectRatio,
            prompt,
            quality,
          }),
        });
        const outputDataUrl = `data:${edited.mediaType};base64,${edited.b64Json}`;
        const outputFile = dataUrlToFile(
          outputDataUrl,
          `nano-banana-2-${Date.now()}.${getImageExtension(edited.mediaType)}`,
        );
        const upload = await uploadProjectFileToApi({
          projectId,
          file: outputFile,
        });
        const nextCurrentNodes = reactFlow?.getNodes() ?? nodesRef.current;
        const resultNodeSize = getImageEditResultNodeSize(aspectRatio);
        const beforeNodeSnapshots = new Map([
          [nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
        ]);
        const nextNodes = nextCurrentNodes.map((node) =>
          node.id === nodeId &&
          (node.data.kind === "imageEdit" ||
            (node.data.kind === "image" &&
              Boolean(node.data.imageGenerated || node.data.imageEditPrompt)))
            ? {
                ...node,
                measured: resultNodeSize,
                style: resultNodeSize,
                type: "image",
                data: {
                  ...node.data,
                  fileId: upload.fileId,
                  imageEditAspectRatio: aspectRatio,
                  imageEditError: undefined,
                  imageEditPrompt: prompt,
                  imageEditQuality: quality,
                  imageEditStatus: "done" as const,
                  imageGenerated: true,
                  kind: "image" as const,
                  originalUrl: upload.originalUrl,
                  previewUrl: upload.previewUrl ?? upload.originalUrl,
                  title: "图片生成",
                  uploadStatus: "uploaded" as const,
                },
              }
            : node,
        );

        skipNextHistoryEntryCount.current += 1;
        setNodes(nextNodes);
        pushNodeUpdateHistory(beforeNodeSnapshots, nextNodes);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "图片编辑失败，请稍后重试";
        updateImageEditNode(nodeId, {
          imageEditError: message,
          imageEditStatus: "failed",
        });
        throw error;
      }
    },
    [configuredImageModelOptions, projectId, pushNodeUpdateHistory, reactFlow, setNodes, updateImageEditNode],
  );

  function createTextNodeAt(position: { x: number; y: number }) {
    const nextNode = createTextCanvasNode({
      id: crypto.randomUUID(),
      position,
    });

    appendCanvasItems({
      currentEdges: edges,
      currentNodes: nodes,
      nodes: [nextNode],
    });
    setCanvasAddMenu(null);
  }

  function openUploadPickerAt(position: { x: number; y: number }) {
    pendingUploadPosition.current = position;
    if (fileUploadInputRef.current) {
      fileUploadInputRef.current.value = "";
      fileUploadInputRef.current.click();
    }
    setCanvasAddMenu(null);
  }

  async function handleUploadInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";

    if (files.length === 0) {
      pendingUploadPosition.current = null;
      return;
    }

    const position = pendingUploadPosition.current ?? { x: 0, y: 0 };
    pendingUploadPosition.current = null;

    const createdNodes = await createDroppedFileCanvasNodes({
      files,
      onReadingError: setCanvasNotice,
      position,
      projectId,
    });

    appendCanvasItems({
      currentEdges: reactFlow?.getEdges() ?? edges,
      currentNodes: reactFlow?.getNodes() ?? nodes,
      nodes: createdNodes,
    });
  }

  const createTextChildNode = useCallback(
    (
      nodeId: string,
      selectedText: string,
      title?: string,
      options?: {
        aiModel?: string;
        kind?: "agent" | "text";
        prompt?: string;
      },
    ) => {
      const currentNodes = reactFlow?.getNodes() ?? [];
      const currentEdges = reactFlow?.getEdges() ?? [];
      const sourceNode = currentNodes.find((node) => node.id === nodeId);
      const text = selectedText.trim();

      if (!sourceNode || !text) {
        return;
      }

      const position = getNextConnectedChildNodePosition({
        childFallbackSize: { height: 260, width: 520 },
        edges: currentEdges,
        nodes: currentNodes,
        sourceFallbackSize: { height: 260, width: 520 },
        sourceNode,
        yOffsetWithoutChild: 48,
      });

      const { edge: nextEdge, node: nextNode } =
        options?.kind === "agent" && options.prompt
          ? createAiResponseChildCanvasNode({
              id: crypto.randomUUID(),
              model: options.aiModel,
              position,
              prompt: options.prompt,
              response: text,
              sourceNode,
            })
          : createTextChildCanvasNode({
              id: crypto.randomUUID(),
              position,
              selectedText: text,
              sourceNode,
              title,
            });

      appendCanvasItems({
        currentEdges,
        currentNodes,
        edges: [nextEdge],
        nodes: [nextNode],
      });
    },
    [appendCanvasItems, reactFlow],
  );

  function handleCanvasDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!reactFlow || isEditableTarget(event.target)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    const menu = createCanvasAddMenuFromPaneDoubleClick({
      flowPosition: reactFlow.screenToFlowPosition(point),
      isEditableTarget: false,
      isInteractiveCanvasTarget: Boolean(
        target.closest(
          ".react-flow__node, .react-flow__edge, .react-flow__controls, .react-flow__minimap, button, input, textarea, select",
        ),
      ),
      isPaneTarget: Boolean(target.closest(".react-flow__pane")),
      point,
    });

    if (!menu) {
      return;
    }

    event.preventDefault();
    setNodeActionMenu(null);
    setCanvasAddMenu(menu);
  }

  const detachNodeFromGroupIfOutside = useCallback(
    (draggedNode: CanvasNode) => {
      const groupId = draggedNode.data.groupId ?? draggedNode.parentId;

      if (!groupId) {
        return;
      }

      setNodes((currentNodes) =>
        detachGroupedNodeIfOutside(currentNodes, draggedNode.id),
      );
    },
    [setNodes],
  );

  const handleCanvasNodeDragStart = useCallback(
    (draggedNode: CanvasNode) => {
      setIsMiniMapSuspended(true);
      const currentNodes = reactFlow?.getNodes() ?? nodes;
      dragInteractionSample.current = startCanvasInteractionSample(
        "interaction drag",
        {
          edges: edges.length,
          kind: draggedNode.data.kind,
          nodes: currentNodes.length,
        },
      );
      dragStartNodeSnapshots.current = new Map(
        currentNodes.map((node) => [
          node.id,
          createCanvasHistoryNodeSnapshot(node),
        ]),
      );

      if (draggedNode.data.kind === "group") {
        groupDragPosition.current = {
          id: draggedNode.id,
          position: draggedNode.position,
        };
        return;
      }

      groupDragPosition.current = null;

      setNodes((currentNodes) =>
        releaseGroupedNodeDragExtent(currentNodes, draggedNode),
      );
    },
    [edges.length, nodes, reactFlow, setNodes],
  );

  const moveGroupedNodesWithFrame = useCallback(
    (draggedNode: CanvasNode) => {
      tickCanvasInteractionSample(dragInteractionSample.current);

      const move = getGroupFrameDragMove({
        draggedNode,
        previous: groupDragPosition.current,
      });
      groupDragPosition.current = move.next;

      const delta = move.delta;
      if (!delta) {
        return;
      }
      setNodes((currentNodes) =>
        moveGroupedNodesWithFrameState(
          currentNodes,
          draggedNode.id,
          delta,
        ),
      );
    },
    [setNodes],
  );

  const handleCanvasNodeDragStop = useCallback(
    (draggedNode: CanvasNode) => {
      isCanvasInteractionActive.current = false;
      setIsMiniMapSuspended(false);
      tickCanvasInteractionSample(dragInteractionSample.current);

      if (draggedNode.data.kind === "group") {
        groupDragPosition.current = null;
        const currentNodes = reactFlow?.getNodes() ?? nodes;
        stopCanvasInteractionSample(dragInteractionSample.current, {
          edges: edges.length,
          nodes: currentNodes.length,
        });
        dragInteractionSample.current = null;
        if (dragStartNodeSnapshots.current) {
          pushNodeUpdateHistory(dragStartNodeSnapshots.current, currentNodes);
          dragStartNodeSnapshots.current = null;
        }
        return;
      }

      detachNodeFromGroupIfOutside(draggedNode);
      const currentNodes = reactFlow?.getNodes() ?? nodes;
      stopCanvasInteractionSample(dragInteractionSample.current, {
        edges: edges.length,
        nodes: currentNodes.length,
      });
      dragInteractionSample.current = null;
      if (dragStartNodeSnapshots.current) {
        pushNodeUpdateHistory(dragStartNodeSnapshots.current, currentNodes);
        dragStartNodeSnapshots.current = null;
      }
    },
    [
      detachNodeFromGroupIfOutside,
      edges.length,
      nodes,
      pushNodeUpdateHistory,
      reactFlow,
    ],
  );

  const createNoteNode = useCallback(
    (note: ReadingNote, asset: ReadingAsset, readerNodeId?: string) => {
      if (!reactFlow) {
        return;
      }

      const id = crypto.randomUUID();
      const currentNodes = reactFlow.getNodes();
      const currentEdges = reactFlow.getEdges();
      const { edge, node: nextNode } = createReadingNoteCanvasNode({
        asset,
        edges: currentEdges,
        fallbackPosition: reactFlow.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }),
        id,
        note,
        nodes: currentNodes,
        readerNodeId,
      });

      appendCanvasItems({
        currentEdges,
        currentNodes,
        edges: edge ? [edge] : [],
        nodes: [nextNode],
      });

      window.requestAnimationFrame(() => {
        const noteNode = reactFlow.getNode(id);
        if (noteNode) {
          void reactFlow.setCenter(
            noteNode.position.x + 160,
            noteNode.position.y + 120,
            {
              duration: 220,
              zoom: reactFlow.getViewport().zoom,
            },
          );
        }
      });
    },
    [appendCanvasItems, reactFlow],
  );

  const toggleReaderCollapse = useCallback(
    (readerNodeId: string) => {
      const update = createReaderCollapseUpdate({
        edges,
        nodes,
        readerNodeId,
      });
      if (!update) {
        return;
      }

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      setEdges(update.nextEdges);
      pushMutateHistory({
        afterEdges: update.nextEdges,
        afterNodes: update.nextNodes,
        edgeUpdates: update.edgeUpdates,
        nodeUpdates: update.nodeUpdates,
      });
    },
    [edges, nodes, pushMutateHistory, setEdges, setNodes],
  );

  async function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (!reactFlow) {
      return;
    }

    const droppedNote = parseDroppedReadingNotePayload(event.dataTransfer);
    if (droppedNote) {
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const { edge: nextEdge, node: nextNode } =
        createDroppedReadingNoteCanvasNode({
          asset: droppedNote.asset,
          id: crypto.randomUUID(),
          note: droppedNote.note,
          nodes,
          position,
        });
      appendCanvasItems({
        currentEdges: edges,
        currentNodes: nodes,
        edges: nextEdge ? [nextEdge] : [],
        nodes: [nextNode],
      });
      return;
    }

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) {
      return;
    }
    const position = reactFlow.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    });

    const createdNodes = await createDroppedFileCanvasNodes({
      files,
      onReadingError: setCanvasNotice,
      position,
      projectId,
    });

    appendCanvasItems({
      currentEdges: edges,
      currentNodes: nodes,
      nodes: createdNodes,
    });
  }

  const statusTone = useMemo(() => {
    return getSaveStatusTone(saveStatus);
  }, [saveStatus]);

  const StatusIcon = useMemo(() => {
    return getSaveStatusIcon(saveStatus);
  }, [saveStatus]);

  const groupableNodes = useMemo(
    () => getGroupableNodes(nodes),
    [nodes],
  );

  const selectionToolbarPosition = useMemo(() => {
    return getSelectionToolbarPosition({
      canvasViewport,
      groupableNodes,
      nodes,
    });
  }, [canvasViewport, groupableNodes, nodes]);

  const actionNode = useMemo(
    () => getActionNode({ nodeId: nodeActionMenu?.nodeId, nodes }),
    [nodeActionMenu?.nodeId, nodes],
  );

  async function openReadingWorkspace() {
    if (!actionNode) {
      return;
    }

    let preparedAsset: ReadingAsset | undefined;

    if (canPrepareReadingAsset(actionNode)) {
      try {
        const asset = await prepareReadingAssetForCanvasNode({
          projectId,
          node: actionNode,
        });
        preparedAsset = asset ?? undefined;
      } catch (error) {
        setCanvasNotice(
          `阅读资料准备失败：${
            error instanceof Error ? error.message : "请重新拖入该图书文件"
          }`,
        );
        setNodeActionMenu(null);
        return;
      }
    }

    const update = createOpenReadingWorkspaceUpdate({
      actionNode,
      edges,
      nodes,
      preparedAsset,
      readerNodeId: crypto.randomUUID(),
    });

    if (!update) {
      setCanvasNotice("该图书节点没有可读取的原始文件引用，请重新拖入文件。");
      setNodeActionMenu(null);
      return;
    }

    skipNextHistoryEntryCount.current += 1;
    setNodes(update.nextNodes);
    setEdges(update.nextEdges);
    pushMutateHistory({
      afterEdges: update.nextEdges,
      afterNodes: update.nextNodes,
      createdEdges: update.createdEdges,
      createdNodes: update.createdNodes,
      nodeUpdates: update.nodeUpdates,
    });
    window.requestAnimationFrame(() => {
      void reactFlow?.fitView({ duration: 220, padding: 0.16 });
    });
    setNodeActionMenu(null);
  }

  function createConnectedPlaceholder(
    kind: "text" | "agent" | "textGeneration" | "imageEdit",
  ) {
    if (!actionNode) {
      return;
    }

    const currentNodes = reactFlow?.getNodes() ?? nodes;
    const currentEdges = reactFlow?.getEdges() ?? edges;
    const position = getConnectedPlaceholderPosition({
      flowPosition: nodeActionMenu?.flowPosition,
      kind,
    });

    const { edge: nextEdge, node: nextNode } =
      createConnectedPlaceholderCanvasNode({
        id: crypto.randomUUID(),
        kind,
        model: kind === "imageEdit" ? configuredImageModelOptions[0]?.id : defaultTextModel,
        position,
        sourceNode: actionNode,
      });

    appendCanvasItems({
      currentEdges,
      currentNodes,
      edges: [nextEdge],
      nodes: [nextNode],
    });
    setNodeActionMenu(null);
  }

  const renderedNodes = useMemo(
    () =>
      getRenderedCanvasNodes({
        createNoteNode,
        edges,
        nodes,
        onCreateTextChildNode: createTextChildNode,
        onSubmitImageEditNode: submitImageEditNode,
        onSubmitTextGenerationNode: submitTextGenerationNode,
        onUpdateImageEditNode: updateImageEditNode,
        onUpdateTextGenerationNode: updateTextGenerationNode,
        onUpdateTextNode: updateTextNode,
        projectId,
        toggleReaderCollapse,
      }),
    [
      createNoteNode,
      createTextChildNode,
      edges,
      nodes,
      projectId,
      submitImageEditNode,
      submitTextGenerationNode,
      toggleReaderCollapse,
      updateImageEditNode,
      updateTextGenerationNode,
      updateTextNode,
    ],
  );

  return (
    <div className="zenme-canvas-shell h-full overflow-hidden bg-white text-zinc-950">
      <main
        className="relative h-full w-full"
        onDoubleClick={handleCanvasDoubleClick}
        ref={canvasViewportRef}
      >
        <input
          aria-hidden
          className="sr-only"
          multiple
          onChange={handleUploadInputChange}
          ref={fileUploadInputRef}
          tabIndex={-1}
          type="file"
        />

        <CanvasProjectStatus
          lastSavedAt={lastSavedAt}
          saveStatus={saveStatus}
          statusIcon={StatusIcon}
          statusTone={statusTone}
        />

        <ReactFlow
          className={`zenme-canvas bg-white ${
            isContextConnecting ? "zenme-context-connecting" : ""
          }`}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          nodes={renderedNodes}
          connectionRadius={120}
          onConnect={onConnect}
          onConnectEnd={(event) => {
            const sourceNodeId = connectingNodeId.current;
            const sourceHandleId = connectingHandleId.current;

            if (reactFlow) {
              const point = getClientPointFromConnectEnd(event);
              const menu = createNodeActionMenuFromConnectEnd({
                didConnectToNode: didConnectToNode.current,
                flowPosition: reactFlow.screenToFlowPosition(point),
                point,
                sourceHandleId,
                sourceNodeId,
              });

              if (menu) {
                setNodeActionMenu(menu);
              }
            }

            connectingNodeId.current = null;
            connectingHandleId.current = null;
            didConnectToNode.current = false;
            setIsContextConnecting(false);
          }}
          onConnectStart={(_event, params) => {
            connectingNodeId.current = params.nodeId ?? null;
            connectingHandleId.current = params.handleId ?? null;
            didConnectToNode.current = false;
            setIsContextConnecting(params.handleId === NODE_CONTEXT_HANDLE_ID);
            setNodeActionMenu(null);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onEdgesChange={onEdgesChange}
          onInit={setReactFlow}
          onMove={(_event, viewport) => {
            setZoomLevel(viewport.zoom);
            setCanvasViewport(viewport);
          }}
          minZoom={0.2}
          maxZoom={2}
          onNodeClick={(_event, node) => bringNodeToFront(node.id)}
          onNodeDrag={(_event, node) => moveGroupedNodesWithFrame(node)}
          onNodeDragStart={(_event, node) => handleCanvasNodeDragStart(node)}
          onNodeDragStop={(_event, node) => handleCanvasNodeDragStop(node)}
          onNodesChange={handleNodesChange}
          onPaneClick={() => {
            setNodeActionMenu(null);
            setCanvasAddMenu(null);
          }}
          panOnDrag={[1]}
          panOnScroll={false}
          selectionOnDrag
          selectionKeyCode={null}
          onlyRenderVisibleElements
          snapGrid={[20, 20]}
          snapToGrid={snapToGrid}
          zoomActivationKeyCode="Control"
          zoomOnDoubleClick={false}
          zoomOnScroll={false}
        >
          <Background
            color="#e4e4e7"
            gap={16}
            size={1}
            variant={BackgroundVariant.Dots}
          />
          {nodes.length === 0 ? <EmptyCanvasHint /> : null}
          {showMiniMap && isMiniMapSuspended ? (
            <div
              aria-hidden
              className={`react-flow__panel react-flow__minimap ${MINI_MAP_CLASS}`}
            />
          ) : null}
          {showMiniMap && !isMiniMapSuspended ? (
            <MiniMap
              bgColor="#ffffff"
              className={MINI_MAP_CLASS}
              maskColor="rgba(24,24,27,0.05)"
              maskStrokeColor="#d4d4d8"
              maskStrokeWidth={1}
              nodeBorderRadius={4}
              nodeColor="#d4d4d8"
              nodeStrokeColor="#a1a1aa"
              nodeStrokeWidth={1}
              pannable
              zoomable
            />
          ) : null}
        </ReactFlow>

        {selectionToolbarPosition ? (
          <CanvasSelectionToolbar
            left={selectionToolbarPosition.left}
            onGroupSelectedNodes={groupSelectedNodes}
            top={selectionToolbarPosition.top}
          />
        ) : null}

        <CanvasSideToolbar
          onOpenAgent={() => setIsAgentOpen(true)}
          onSave={() => void saveCanvas({ includeThumbnail: true })}
          onZoomIn={() => setCanvasZoom(getNextCanvasZoom(zoomLevel, 0.1))}
        />

        <CanvasBottomControls
          onFitView={() => reactFlow?.fitView({ duration: 300 })}
          onToggleMiniMap={() => setShowMiniMap((current) => !current)}
          onToggleSnapToGrid={() => setSnapToGrid((current) => !current)}
          onZoomChange={setCanvasZoom}
          showMiniMap={showMiniMap}
          zoomLevel={zoomLevel}
        />

        <CanvasAgentButton onOpenAgent={() => setIsAgentOpen(true)} />

        {isAgentOpen ? (
          <AgentPanel
            context={agentContext}
            error={agentError}
            input={agentInput}
            isSubmitting={agentIsSubmitting}
            messages={agentMessages}
            model={agentModel}
            onClose={() => {
              setIsAgentOpen(false);
              setAgentContext(undefined);
            }}
            setError={setAgentError}
            setInput={setAgentInput}
            setIsSubmitting={setAgentIsSubmitting}
            setMessages={setAgentMessages}
            setModel={setAgentModel}
          />
        ) : null}

        {canvasNotice ? (
          <CanvasNotice
            message={canvasNotice}
            onClose={() => setCanvasNotice(null)}
          />
        ) : null}

        {canvasAddMenu ? (
          <CanvasAddMenu
            menu={canvasAddMenu}
            onClose={() => setCanvasAddMenu(null)}
            onCreateTextNode={createTextNodeAt}
            onUploadFiles={openUploadPickerAt}
          />
        ) : null}

        {nodeActionMenu ? (
          <NodeActionMenu
            actionNode={actionNode}
            menu={nodeActionMenu}
            onClose={() => setNodeActionMenu(null)}
            onCreateConnectedPlaceholder={createConnectedPlaceholder}
            onOpenReadingWorkspace={openReadingWorkspace}
            onProcessWithAgent={() => {
              createConnectedPlaceholder("agent");
              setAgentContext(createAgentContextFromActionNode(actionNode));
              setIsAgentOpen(true);
              setNodeActionMenu(null);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

async function fetchImageAsDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("来源图片读取失败");
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("图片读取失败"));
    };
    reader.readAsDataURL(blob);
  });
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = /^data:(.*?);base64$/.exec(header);
  const mimeType = mimeMatch?.[1] ?? "image/png";
  const binary = atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], fileName, { type: mimeType });
}

function getImageExtension(mediaType: string) {
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) {
    return "jpg";
  }
  if (mediaType.includes("webp")) {
    return "webp";
  }
  if (mediaType.includes("svg")) {
    return "svg";
  }
  return "png";
}
