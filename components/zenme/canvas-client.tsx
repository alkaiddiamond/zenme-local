"use client";

import {
  type ChangeEvent,
  type MouseEvent,
  type WheelEvent as ReactWheelEvent,
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
  isCanvasConnectionValid,
  normalizeCanvasConnection,
  normalizePersistedCanvasEdges,
} from "@/components/zenme/canvas/connections";
import { CanvasProjectStatus } from "@/components/zenme/canvas/project-status";
import { nodeTypes } from "@/components/zenme/nodes";
import {
  getCanvasSnapshotFromApi,
  getProjectFromApi,
  generateOrEditImage,
  uploadProjectFileToApi,
} from "@/lib/zenme-api";
import {
  modelOptions,
  ZENME_AGENT_KEY_PREFIX,
} from "@/lib/zenme";
import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import { createDroppedFileCanvasNodes } from "@/components/zenme/canvas/drop-files";
import {
  createCanvasNodeClipboardPayload,
  createPastedCanvasNodes,
  parseCanvasNodeClipboardPayload,
  type CanvasNodeClipboardPayload,
  ZENME_NODE_CLIPBOARD_MIME,
  ZENME_NODE_CLIPBOARD_PREFIX,
} from "@/components/zenme/canvas/clipboard";
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
  recoverInterruptedImageTasks,
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
  createConnectedEdge,
  createConnectedPlaceholderCanvasNode,
  createImageGenerationCanvasNode,
  createManagedTextCanvasNode,
  createTaskCanvasNode,
  createPendingImageResultChildCanvasNode,
  createDroppedReadingNoteCanvasNode,
  createAiResponseChildCanvasNode,
  createReadingNoteCanvasNode,
  createTextChildCanvasNode,
  createTextCanvasNode,
} from "@/components/zenme/canvas/node-factories";
import {
  createImageGenerationNodeDataUpdate,
  createTextGenerationNodeDataUpdate,
  createTextNodeDataUpdate,
  createTaskChildrenVisibilityUpdate,
  createTaskNodeDataUpdate,
  createProjectTagUpdate,
} from "@/components/zenme/canvas/node-updates";
import { createCanvasAddMenuFromPaneDoubleClick } from "@/components/zenme/canvas/pane-menu";
import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  clampCanvasZoom,
  createCanvasZoomViewport,
  createCanvasZoomViewportAtPoint,
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
  createMusicChildUpdate,
  createMusicPlayerUpdate,
  MUSIC_WAVEFORM_VERSION,
  musicJobRequestFor,
  musicPlayerPreviewRequest,
  type MusicServiceCapabilities,
  resolveMusicSourceNode,
} from "@/components/zenme/canvas/music-workflow";
import {
  DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
  DEFAULT_IMAGE_EDIT_QUALITY,
  getImageDisplaySize,
} from "@/components/zenme/image-edit-options";
import {
  getImageEditPreferences,
  hydrateImageEditPreferences,
} from "@/components/zenme/image-edit-preferences";
import { getImageDimensions } from "@/components/zenme/canvas/files";
import {
  NODE_CONTEXT_HANDLE_ID,
  type CanvasNodeData,
  type MusicChildNodeKind,
  type MusicJobSnapshot,
  type ProjectTagAction,
} from "@/components/zenme/node-types";

type CanvasClientProps = {
  projectId: string;
};

const THUMBNAIL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MISSING_THUMBNAIL_REFRESH_DELAY_MS = 1200;
const DEFAULT_EDGE_OPTIONS = {
  interactionWidth: 24,
  type: "default",
  style: { stroke: "#9ca3af", strokeWidth: 2 },
};
const MINI_MAP_CLASS =
  "zenme-shadow-canvas !bottom-[66px] !left-3 !right-auto !top-auto !m-0 !h-[150px] !w-[200px] !overflow-hidden !rounded-xl !border !border-zinc-200 !bg-white/95 !backdrop-blur";

async function fetchMusicServiceCapabilities(): Promise<MusicServiceCapabilities | null> {
  try {
    const response = await fetch("/api/music/capabilities", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json() as MusicServiceCapabilities;
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

export function CanvasClient({ projectId }: CanvasClientProps) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasNode>(createWelcomeNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlow, setReactFlow] =
    useState<ReactFlowInstance<CanvasNode, Edge>>();
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isMiniMapSuspended, setIsMiniMapSuspended] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
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
  const defaultTextModelRef = useRef(defaultTextModel);
  defaultTextModelRef.current = defaultTextModel;
  const canvasViewportStateRef = useRef<Viewport>(canvasViewport);
  const reactFlowRef = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadPosition = useRef<{ x: number; y: number } | null>(null);
  const pendingUploadSourceNodeId = useRef<string | null>(null);
  const lastCanvasPointer = useRef<{ x: number; y: number } | null>(null);
  const nodeClipboard = useRef<{
    marker: string;
    payload: CanvasNodeClipboardPayload;
  } | null>(null);
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
  const musicPlayersRef = useRef(new Map<string, HTMLAudioElement>());
  const musicWaveformTasksRef = useRef(new Map<string, Promise<void>>());

  const agentKey = `${ZENME_AGENT_KEY_PREFIX}${projectId}`;

  useEffect(() => {
    void hydrateImageEditPreferences();
  }, []);

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

  useEffect(() => () => {
    for (const audio of musicPlayersRef.current.values()) {
      audio.pause();
      audio.src = "";
    }
    musicPlayersRef.current.clear();
  }, []);

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
              node.data.kind !== "managedText" &&
              node.data.kind !== "task" &&
              node.data.kind !== "agent" &&
              node.data.kind !== "textGeneration" &&
              node.data.kind !== "musicAnalysis" &&
              node.data.kind !== "sunoPrompt")
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
    () => getRenderedCanvasEdges(
      edgeNodeKindById,
      edges,
      new Set(nodes.filter((node) => node.selected).map((node) => node.id)),
    ),
    [edgeNodeKindById, edges, nodes],
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
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
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
          const restoredNodes = recoverInterruptedImageTasks(
            normalizeGroupNodeRelations(restored.nodes),
          );
          const restoredEdges = normalizePersistedCanvasEdges(
            restored.edges,
            restoredNodes,
          );
          setNodes(restoredNodes);
          setEdges(restoredEdges);
          resetCanvasHistory(
            restoredNodes,
            restoredEdges,
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

  const getClipboardPastePosition = useCallback(() => {
    const flow = reactFlowRef.current;
    const bounds = canvasViewportRef.current?.getBoundingClientRect();
    if (!flow || !bounds) return { x: 0, y: 0 };
    const point = lastCanvasPointer.current ?? {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
    return flow.screenToFlowPosition(point);
  }, []);

  useEffect(() => {
    function writeSelectedNodesToClipboard(event: ClipboardEvent) {
      if (isEditableTarget(event.target) || !event.clipboardData) return false;
      const payload = createCanvasNodeClipboardPayload(nodesRef.current);
      if (!payload) return false;
      const marker = `${ZENME_NODE_CLIPBOARD_PREFIX}${crypto.randomUUID()}`;
      nodeClipboard.current = { marker, payload };
      event.preventDefault();
      event.clipboardData.setData(
        ZENME_NODE_CLIPBOARD_MIME,
        JSON.stringify(payload),
      );
      event.clipboardData.setData("text/plain", marker);
      return true;
    }

    function handleCopy(event: ClipboardEvent) {
      writeSelectedNodesToClipboard(event);
    }

    function handleCut(event: ClipboardEvent) {
      if (!writeSelectedNodesToClipboard(event)) return;
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const deletion = createCanvasDeleteSelection({
        edges: currentEdges,
        nodes: currentNodes,
      });
      if (!deletion) return;
      skipNextHistoryEntryCount.current += 1;
      setNodes(deletion.nextNodes);
      setEdges(deletion.nextEdges);
      pushDeleteHistory({
        afterEdges: deletion.nextEdges,
        afterNodes: deletion.nextNodes,
        edges: deletion.deletedEdges,
        nodes: deletion.deletedNodes,
      });
    }

    async function handlePaste(event: ClipboardEvent) {
      if (isEditableTarget(event.target) || !event.clipboardData) return;
      const clipboardData = event.clipboardData;
      const customPayload = parseCanvasNodeClipboardPayload(
        clipboardData.getData(ZENME_NODE_CLIPBOARD_MIME),
      );
      const plainText = clipboardData.getData("text/plain");
      const fallbackPayload =
        nodeClipboard.current?.marker === plainText
          ? nodeClipboard.current.payload
          : null;
      const nodePayload = customPayload ?? fallbackPayload;
      const position = getClipboardPastePosition();

      if (nodePayload) {
        event.preventDefault();
        const pastedNodes = createPastedCanvasNodes({
          anchor: position,
          createId: () => crypto.randomUUID(),
          payload: nodePayload,
        });
        appendCanvasItems({
          currentEdges: edgesRef.current,
          currentNodes: nodesRef.current,
          nodes: pastedNodes,
        });
        return;
      }

      const imageFiles = Array.from(clipboardData.items)
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
        .map((file, index) => file.name
          ? file
          : new File(
              [file],
              `clipboard-${Date.now()}-${index + 1}.${getClipboardImageExtension(file.type)}`,
              { type: file.type },
            ));
      if (imageFiles.length > 0) {
        event.preventDefault();
        const pastedImages = await createDroppedFileCanvasNodes({
          files: imageFiles,
          onReadingError: setCanvasNotice,
          position,
          projectId,
        });
        appendCanvasItems({
          currentEdges: edgesRef.current,
          currentNodes: nodesRef.current,
          nodes: pastedImages,
        });
        return;
      }

      if (plainText.trim()) {
        event.preventDefault();
        const textNode = createTextCanvasNode({
          id: crypto.randomUUID(),
          model: defaultTextModelRef.current,
          plainText,
          position,
        });
        appendCanvasItems({
          currentEdges: edgesRef.current,
          currentNodes: nodesRef.current,
          nodes: [textNode],
        });
      }
    }

    window.addEventListener("copy", handleCopy);
    window.addEventListener("cut", handleCut);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("cut", handleCut);
      window.removeEventListener("paste", handlePaste);
    };
  }, [appendCanvasItems, getClipboardPastePosition, projectId, pushDeleteHistory, setEdges, setNodes]);

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
        name?: string;
        plainText?: string;
        richTextHtml?: string;
        tags?: string[];
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

  const updateTaskNode = useCallback(
    (
      nodeId: string,
      updates: Parameters<
        NonNullable<CanvasNodeData["onUpdateTaskNode"]>
      >[1],
    ) => {
      const update = createTaskNodeDataUpdate({
        nodeId,
        nodes: nodesRef.current,
        updates,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      pushNodeUpdateHistory(update.beforeNodeSnapshots, update.nextNodes);
    },
    [pushNodeUpdateHistory, setNodes],
  );

  const toggleTaskChildren = useCallback(
    (nodeId: string, expanded: boolean, collapsedHeight: number) => {
      const update = createTaskChildrenVisibilityUpdate({
        collapsedHeight,
        expanded,
        nodeId,
        nodes: nodesRef.current,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      pushNodeUpdateHistory(update.beforeNodeSnapshots, update.nextNodes);
    },
    [pushNodeUpdateHistory, setNodes],
  );

  const updateProjectTag = useCallback(
    (action: ProjectTagAction) => {
      const update = createProjectTagUpdate({
        action,
        nodes: nodesRef.current,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      pushNodeUpdateHistory(update.beforeNodeSnapshots, update.nextNodes);
    },
    [pushNodeUpdateHistory, setNodes],
  );

  const updateMusicNode = useCallback((nodeId: string, updates: { title?: string }) => {
    const beforeNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!beforeNode) return;
    const nextNodes = nodesRef.current.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...updates } }
      : node);
    skipNextHistoryEntryCount.current += 1;
    setNodes(nextNodes);
    pushNodeUpdateHistory(new Map([[nodeId, beforeNode]]), nextNodes);
  }, [pushNodeUpdateHistory, setNodes]);

  const updateImageGenerationNode = useCallback(
    (
      nodeId: string,
      updates: {
        fileId?: string;
        imageOutputAspectRatio?: string;
        imageError?: string;
        imageModel?: string;
        imageQuality?: string;
        imagePrompt?: string;
        imageStatus?: "idle" | "editing" | "done" | "failed";
        imageReferenceNodeIds?: string[];
        imageTaskDurationMs?: number;
        imageTaskStartedAt?: string;
        originalUrl?: string;
        previewUrl?: string;
        title?: string;
      },
    ) => {
      const currentNodes = nodesRef.current;
      const update = createImageGenerationNodeDataUpdate({
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

  const resolveImageNodeDimensions = useCallback(
    (nodeId: string, dimensions: { height: number; width: number }) => {
      if (dimensions.width <= 0 || dimensions.height <= 0) return;
      const imageAspectRatio = dimensions.width / dimensions.height;
      const displaySize = getImageDisplaySize(imageAspectRatio);

      setNodes((currentNodes) => currentNodes.map((node) => {
        if (node.id !== nodeId || node.data.kind !== "image") return node;
        const style = node.style as { height?: number; width?: number } | undefined;
        if (
          Math.abs((node.data.imageAspectRatio ?? 0) - imageAspectRatio) < 0.0001 &&
          style?.height === displaySize.height &&
          style?.width === displaySize.width
        ) {
          return node;
        }
        return {
          ...node,
          height: displaySize.height,
          measured: displaySize,
          style: displaySize,
          width: displaySize.width,
          data: {
            ...node.data,
            imageAspectRatio,
            imageHeight: dimensions.height,
            imageWidth: dimensions.width,
          },
        };
      }));
    },
    [setNodes],
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
          sourceNode,
        });

      appendCanvasItems({
        currentEdges,
        currentNodes,
        edges: [nextEdge],
        nodes: [nextNode],
      });

      const taskStartedAt = Date.now();
      try {
        const result = await requestTextGenerationResponse({
          context,
          model,
          prompt,
        });
        if (!result) {
          throw new Error("模型未返回内容");
        }

        const nextNodes = nodesRef.current.map((node) =>
          node.id === nextNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  aiError: undefined,
                  aiResponse: result,
                  aiStatus: "done" as const,
                  aiTaskDurationMs: Date.now() - taskStartedAt,
                  plainText: result,
                },
              }
            : node,
        );
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
      } catch (error) {
        const message = error instanceof Error ? error.message : "文本生成失败";
        const nextNodes = nodesRef.current.map((node) =>
          node.id === nextNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  aiError: message,
                  aiStatus: "failed" as const,
                  aiTaskDurationMs: Date.now() - taskStartedAt,
                },
              }
            : node,
        );
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
      }
    },
    [appendCanvasItems, defaultTextModel, edges, reactFlow, setNodes],
  );

  const submitImageGenerationNode = useCallback(
    async (
      nodeId: string,
      input?: { aspectRatio?: string; model?: string; prompt?: string; quality?: string },
    ) => {
      const currentNodes = reactFlow?.getNodes() ?? nodesRef.current;
      const currentEdges = reactFlow?.getEdges() ?? edgesRef.current;
      const sourceNode = currentNodes.find((node) => {
        if (node.id !== nodeId) {
          return false;
        }

        if (node.data.kind === "imageGeneration") {
          return true;
        }

        return (
          node.data.kind === "image" &&
          Boolean(node.data.imageGenerated || node.data.imagePrompt)
        );
      });
      const prompt =
        input?.prompt?.trim() ?? sourceNode?.data.imagePrompt?.trim() ?? "";
      const aspectRatio =
        input?.aspectRatio ??
        sourceNode?.data.imageOutputAspectRatio ??
        DEFAULT_IMAGE_EDIT_ASPECT_RATIO;
      const quality =
        input?.quality ??
        sourceNode?.data.imageQuality ??
        DEFAULT_IMAGE_EDIT_QUALITY;
      const standaloneImageUrl = sourceNode?.data.kind === "imageGeneration"
        ? undefined
        : sourceNode?.data.originalUrl ?? sourceNode?.data.previewUrl;
      const selectedReferenceNodeIds = sourceNode?.data.imageReferenceNodeIds;
      const connectedReferenceImageUrls = currentEdges
            .filter((edge) => edge.target === nodeId)
            .map((edge) => currentNodes.find((node) => node.id === edge.source))
            .filter((node): node is CanvasNode => node?.data.kind === "image")
            .filter((node) =>
              selectedReferenceNodeIds === undefined ||
              selectedReferenceNodeIds.includes(node.id),
            )
            .map((node) => node.data.originalUrl ?? node.data.previewUrl)
            .filter((url): url is string => Boolean(url))
            .slice(0, 8);
      const isStandaloneUploadedImage =
        sourceNode?.data.kind === "image" && !sourceNode.data.imageGenerated;
      const referenceImageUrls = isStandaloneUploadedImage && standaloneImageUrl
        ? [standaloneImageUrl]
        : connectedReferenceImageUrls.length > 0
          ? connectedReferenceImageUrls
          : [];
      const operation = referenceImageUrls.length > 0
        ? "edit" as const
        : "generate" as const;

      if (!sourceNode || !prompt) {
        return;
      }

      const model =
        input?.model ??
        sourceNode.data.imageModel ??
        configuredImageModelOptions[0]?.id ??
        "";
      const position = getNextConnectedChildNodePosition({
        childFallbackSize: { height: 320, width: 420 },
        edges: currentEdges,
        nodes: currentNodes,
        sourceFallbackSize: { height: 320, width: 420 },
        sourceNode,
        yOffsetWithoutChild: 0,
      });
      const taskStartedAt = Date.now();
      const { edge: resultEdge, node: resultNode } =
        createPendingImageResultChildCanvasNode({
          aspectRatio,
          id: crypto.randomUUID(),
          model,
          position,
          prompt,
          quality,
          sourceNode,
          startedAt: new Date(taskStartedAt).toISOString(),
        });
      resultNode.data.imageOperation = operation;
      appendCanvasItems({
        currentEdges,
        currentNodes,
        edges: [resultEdge],
        nodes: [resultNode],
      });

      try {
        const imageDataUrls = await Promise.all(
          referenceImageUrls.map((url) => fetchImageAsDataUrl(url)),
        );
        const edited = await generateOrEditImage({
          aspectRatio,
          imageDataUrls,
          model,
          operation,
          prompt,
          quality,
        });
        const outputDataUrl = `data:${edited.mediaType};base64,${edited.b64Json}`;
        const outputDimensions = await getImageDimensions(outputDataUrl);
        const outputFile = dataUrlToFile(
          outputDataUrl,
          `zenme-image-${Date.now()}.${getImageExtension(edited.mediaType)}`,
        );
        const upload = await uploadProjectFileToApi({
          projectId,
          file: outputFile,
        });
        const nextCurrentNodes = nodesRef.current;
        const outputAspectRatio = outputDimensions.width / outputDimensions.height;
        const resultNodeSize = getImageDisplaySize(outputAspectRatio);
        const pendingResultNode = nextCurrentNodes.find((node) => node.id === resultNode.id);
        const beforeNodeSnapshots = pendingResultNode
          ? new Map([[resultNode.id, createCanvasHistoryNodeSnapshot(pendingResultNode)]])
          : new Map<string, ReturnType<typeof createCanvasHistoryNodeSnapshot>>();
        const nextNodes = nextCurrentNodes.map((node) =>
          node.id === resultNode.id
            ? {
                ...node,
                measured: resultNodeSize,
                style: resultNodeSize,
                type: "image",
                data: {
                  ...node.data,
                  fileId: upload.fileId,
                  imageOutputAspectRatio: aspectRatio,
                  imageError: undefined,
                  imagePrompt: prompt,
                  imageQuality: quality,
                  imageStatus: "done" as const,
                  imageTaskDurationMs: Date.now() - taskStartedAt,
                  imageTaskStartedAt: new Date(taskStartedAt).toISOString(),
                  imageGenerated: true,
                  imageGenerationResult: true,
                  imageAspectRatio: outputAspectRatio,
                  imageHeight: outputDimensions.height,
                  imageWidth: outputDimensions.width,
                  kind: "image" as const,
                  originalUrl: upload.originalUrl,
                  previewUrl: upload.previewUrl ?? upload.originalUrl,
                  title: node.data.title || "图片生成",
                  uploadStatus: "uploaded" as const,
                },
              }
            : node,
        );

        skipNextHistoryEntryCount.current += 1;
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
        pushNodeUpdateHistory(beforeNodeSnapshots, nextNodes);
        const committedEdges = edgesRef.current;
        const committedViewport =
          reactFlow?.getViewport() ?? canvasViewportStateRef.current;
        const committedSnapshot = await saveCanvasSnapshot({
          edges: committedEdges,
          nodes: nextNodes,
          projectId,
          thumbnail: null,
          viewport: committedViewport,
        });
        const committedSignature = getCanvasPersistableSignature(
          nextNodes,
          committedEdges,
          committedViewport,
        );
        savedCanvasSignature.current = committedSignature;
        pendingCanvasSignature.current = committedSignature;
        setLastSavedAt(committedSnapshot.updatedAt);
        setSaveStatus("已保存");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "图片编辑失败，请稍后重试";
        const nextNodes = nodesRef.current.map((node) =>
          node.id === resultNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageError: message,
                  imageStatus: "failed" as const,
                  imageTaskDurationMs: Date.now() - taskStartedAt,
                },
              }
            : node,
        );
        nodesRef.current = nextNodes;
        setNodes(nextNodes);
      }
    },
    [appendCanvasItems, configuredImageModelOptions, projectId, pushNodeUpdateHistory, reactFlow, setNodes],
  );

  function createTextNodeAt(position: { x: number; y: number }) {
    const nextNode = createTextCanvasNode({
      id: crypto.randomUUID(),
      model: defaultTextModel,
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
    pendingUploadSourceNodeId.current = null;
    if (fileUploadInputRef.current) {
      fileUploadInputRef.current.value = "";
      fileUploadInputRef.current.click();
    }
    setCanvasAddMenu(null);
  }

  function openConnectedUploadPicker() {
    if (!actionNode || !nodeActionMenu) {
      return;
    }

    pendingUploadPosition.current = nodeActionMenu.flowPosition;
    pendingUploadSourceNodeId.current = actionNode.id;
    if (fileUploadInputRef.current) {
      fileUploadInputRef.current.value = "";
      fileUploadInputRef.current.click();
    }
    setNodeActionMenu(null);
  }

  function createManagedTextNodeAt(position: { x: number; y: number }) {
    const nextNode = createManagedTextCanvasNode({
      id: crypto.randomUUID(),
      model: defaultTextModel,
      position,
    });

    appendCanvasItems({
      currentEdges: edges,
      currentNodes: nodes,
      nodes: [nextNode],
    });
    setCanvasAddMenu(null);
  }

  function createTaskNodeAt(position: { x: number; y: number }) {
    const nextNode = createTaskCanvasNode({
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

  function createImageGenerationNodeAt(position: { x: number; y: number }) {
    const preferences = getImageEditPreferences();
    const nextNode = createImageGenerationCanvasNode({
      aspectRatio: preferences.aspectRatio,
      id: crypto.randomUUID(),
      model: preferences.modelId ?? configuredImageModelOptions[0]?.id,
      position,
      quality: preferences.quality,
    });

    appendCanvasItems({
      currentEdges: edges,
      currentNodes: nodes,
      nodes: [nextNode],
    });
    setCanvasAddMenu(null);
  }

  function handleCanvasWheelCapture(event: ReactWheelEvent<HTMLElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    const flow = reactFlowRef.current;
    const bounds = canvasViewportRef.current?.getBoundingClientRect();
    if (!flow || !bounds || event.deltaY === 0) return;

    event.preventDefault();
    event.stopPropagation();
    const currentViewport = flow.getViewport();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = clampCanvasZoom(currentViewport.zoom * zoomFactor);
    const nextViewport = createCanvasZoomViewportAtPoint(
      currentViewport,
      nextZoom,
      {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      },
    );
    setZoomLevel(nextViewport.zoom);
    setCanvasViewport(nextViewport);
    void flow.setViewport(nextViewport, { duration: 0 });
  }

  async function handleUploadInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";

    if (files.length === 0) {
      pendingUploadPosition.current = null;
      pendingUploadSourceNodeId.current = null;
      return;
    }

    const position = pendingUploadPosition.current ?? { x: 0, y: 0 };
    const sourceNodeId = pendingUploadSourceNodeId.current;
    pendingUploadPosition.current = null;
    pendingUploadSourceNodeId.current = null;

    const createdNodes = await createDroppedFileCanvasNodes({
      files,
      onReadingError: setCanvasNotice,
      position,
      projectId,
    });

    const currentEdges = reactFlow?.getEdges() ?? edges;
    const currentNodes = reactFlow?.getNodes() ?? nodes;
    const sourceNodeExists = sourceNodeId
      ? currentNodes.some((node) => node.id === sourceNodeId)
      : false;

    appendCanvasItems({
      currentEdges,
      currentNodes,
      edges:
        sourceNodeId && sourceNodeExists
          ? createdNodes.map((node) => createConnectedEdge(sourceNodeId, node.id))
          : [],
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
      setIsNodeDragging(true);
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
      setIsNodeDragging(false);
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
    kind:
      | "text"
      | "agent"
      | "managedText"
      | "task"
      | "textGeneration"
      | "imageGeneration",
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

    const imagePreferences = getImageEditPreferences();
    const { edge: nextEdge, node: nextNode } =
      createConnectedPlaceholderCanvasNode({
        aspectRatio:
          kind === "imageGeneration" ? imagePreferences.aspectRatio : undefined,
        id: crypto.randomUUID(),
        kind,
        model:
          kind === "imageGeneration"
            ? imagePreferences.modelId ?? configuredImageModelOptions[0]?.id
            : defaultTextModel,
        position,
        quality: kind === "imageGeneration" ? imagePreferences.quality : undefined,
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

  const updateMusicJob = useCallback(
    (nodeId: string, job: MusicJobSnapshot) => {
      setNodes((current) => current.map((node) => node.id === nodeId ? {
        ...node,
        data: {
          ...node.data,
          musicError: job.error?.message,
          musicJobCompletedAt: job.completedAt ?? node.data.musicJobCompletedAt,
          musicJobCreatedAt: job.createdAt ?? node.data.musicJobCreatedAt,
          musicJobDurationMs: job.durationMs ?? node.data.musicJobDurationMs,
          musicJobElapsedMs: job.elapsedMs ?? node.data.musicJobElapsedMs,
          musicJobId: job.id,
          musicJobStartedAt: job.startedAt ?? node.data.musicJobStartedAt,
          musicJobStatus: job.status,
          musicProgress: job.progress,
          musicRetryable: job.retryable,
          musicStage: job.stage,
          musicStageLabel: job.stageLabel,
        },
      } : node));
    },
    [setNodes],
  );

  const focusMusicWorkflowNode = useCallback((nodeId: string) => {
    setNodes((current) => current.map((node) => ({
      ...node,
      selected: node.id === nodeId,
    })));
    window.requestAnimationFrame(() => {
      void reactFlowRef.current?.fitView({
        duration: 220,
        nodes: [{ id: nodeId }],
        padding: 0.3,
      });
    });
  }, [setNodes]);

  const createMusicPlayer = useCallback((musicNodeId: string, position?: { x: number; y: number }) => {
    const musicNode = nodesRef.current.find((node) => node.id === musicNodeId);
    if (!musicNode || musicNode.data.kind !== "music") return;
    const update = createMusicPlayerUpdate({
      edges: edgesRef.current,
      musicNode,
      nodes: nodesRef.current,
      projectId,
    });
    const createdNodes = position
      ? update.createdNodes.map((node) => ({ ...node, position }))
      : update.createdNodes;
    if (createdNodes.length || update.createdEdges.length) {
      appendCanvasItems({
        currentEdges: edgesRef.current,
        currentNodes: nodesRef.current,
        edges: update.createdEdges,
        nodes: createdNodes,
      });
    }
    focusMusicWorkflowNode(update.focusNodeId);
  }, [appendCanvasItems, focusMusicWorkflowNode, projectId]);

  const toggleMusicPlayback = useCallback((playerNodeId: string, playing: boolean) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    const sourceNode = resolveMusicSourceNode({
      edges: edgesRef.current,
      nodes: nodesRef.current,
      playerNodeId,
    });
    const source = playerNode?.data.originalUrl ?? (
      sourceNode?.data.kind === "music" ? sourceNode.data.originalUrl : undefined
    );
    if (!playerNode || !source) return;

    for (const [id, audio] of musicPlayersRef.current) {
      if (id !== playerNodeId) audio.pause();
    }
    setNodes((current) => current.map((node) => node.data.kind === "musicPlayer"
      ? { ...node, data: { ...node.data, musicIsPlaying: node.id === playerNodeId && playing } }
      : node));

    let audio = musicPlayersRef.current.get(playerNodeId);
    if (!audio || audio.src !== new URL(source, window.location.href).href) {
      audio?.pause();
      audio = new Audio(source);
      audio.preload = "metadata";
      audio.loop = Boolean(playerNode.data.musicLoop);
      audio.muted = Boolean(playerNode.data.musicMuted);
      audio.playbackRate = playerNode.data.musicPlaybackRate ?? 1;
      audio.volume = playerNode.data.musicVolume ?? 1;
      musicPlayersRef.current.set(playerNodeId, audio);
      audio.addEventListener("loadedmetadata", () => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? { ...node, data: { ...node.data, musicDuration: audio!.duration } }
          : node));
      });
      audio.addEventListener("timeupdate", () => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? { ...node, data: { ...node.data, musicCurrentTime: audio!.currentTime } }
          : node));
      });
      audio.addEventListener("ended", () => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? { ...node, data: { ...node.data, musicIsPlaying: false } }
          : node));
      });
    }
    if (playing) {
      void audio.play().catch((error) => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? { ...node, data: { ...node.data, musicError: error instanceof Error ? error.message : "无法播放音乐", musicIsPlaying: false } }
          : node));
      });
    } else {
      audio.pause();
    }
  }, [setNodes]);

  const updateMusicPlayback = useCallback((playerNodeId: string, updates: {
    loop?: boolean;
    muted?: boolean;
    playbackRate?: number;
    volume?: number;
  }) => {
    const audio = musicPlayersRef.current.get(playerNodeId);
    if (audio) {
      if (updates.loop !== undefined) audio.loop = updates.loop;
      if (updates.muted !== undefined) audio.muted = updates.muted;
      if (updates.playbackRate !== undefined) audio.playbackRate = updates.playbackRate;
      if (updates.volume !== undefined) audio.volume = updates.volume;
    }
    setNodes((current) => current.map((node) => node.id === playerNodeId
      ? {
          ...node,
          data: {
            ...node.data,
            ...(updates.loop === undefined ? {} : { musicLoop: updates.loop }),
            ...(updates.muted === undefined ? {} : { musicMuted: updates.muted }),
            ...(updates.playbackRate === undefined ? {} : { musicPlaybackRate: updates.playbackRate }),
            ...(updates.volume === undefined ? {} : { musicVolume: updates.volume }),
          },
        }
      : node));
  }, [setNodes]);

  const seekMusicPlayer = useCallback((playerNodeId: string, seconds: number) => {
    const audio = musicPlayersRef.current.get(playerNodeId);
    if (audio) audio.currentTime = seconds;
    setNodes((current) => current.map((node) => node.id === playerNodeId
      ? { ...node, data: { ...node.data, musicCurrentTime: seconds } }
      : node));
  }, [setNodes]);

  const ensureMusicWaveform = useCallback((playerNodeId: string) => {
    const existing = musicWaveformTasksRef.current.get(playerNodeId);
    if (existing) return existing;

    const task = (async () => {
      const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
      if (
        playerNode?.data.musicWaveform?.length &&
        playerNode.data.musicWaveformVersion === MUSIC_WAVEFORM_VERSION
      ) return;
      const sourceNode = resolveMusicSourceNode({
        edges: edgesRef.current,
        nodes: nodesRef.current,
        playerNodeId,
      });
      const fileId = playerNode?.data.fileId ?? sourceNode?.data.fileId;
      if (!playerNode || !fileId) {
        throw new Error("播放器没有可生成波形的上游音乐文件");
      }

      const serviceCapabilities = await fetchMusicServiceCapabilities();
      const requestContract = musicPlayerPreviewRequest(serviceCapabilities);

      const response = await fetch("/api/music/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileId,
          ...requestContract,
          options: { keepStems: false },
        }),
      });
      const created = await response.json().catch(() => null) as (
        Partial<MusicJobSnapshot> & { error?: string }
      ) | null;
      if (!response.ok || !created || typeof created.id !== "string") {
        throw new Error(typeof created?.error === "string"
          ? created.error
          : "无法创建波形任务");
      }

      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        const statusResponse = await fetch(`/api/music/jobs/${encodeURIComponent(created.id)}`);
        const status = await statusResponse.json().catch(() => null) as MusicJobSnapshot | null;
        if (!statusResponse.ok || !status) continue;
        if (status.status === "failed" || status.status === "cancelled") {
          throw new Error(status.error?.message || "波形生成失败");
        }
        if (status.status !== "succeeded") continue;

        const resultResponse = await fetch(`/api/music/jobs/${encodeURIComponent(created.id)}/result`);
        const result = await resultResponse.json().catch(() => null) as {
          input?: { duration?: number };
          waveform?: unknown[];
        } | null;
        const waveform = result?.waveform?.filter(
          (value): value is number => typeof value === "number" && Number.isFinite(value),
        );
        const analyzedDuration = result?.input?.duration;
        if (!resultResponse.ok || !waveform?.length) {
          throw new Error("音乐服务没有返回有效波形");
        }
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                musicDuration: typeof analyzedDuration === "number"
                  ? analyzedDuration
                  : node.data.musicDuration,
                musicWaveform: waveform,
                musicWaveformVersion: MUSIC_WAVEFORM_VERSION,
              },
            }
          : node));
        return;
      }
      throw new Error("波形生成超时");
    })().finally(() => {
      musicWaveformTasksRef.current.delete(playerNodeId);
    });
    musicWaveformTasksRef.current.set(playerNodeId, task);
    return task;
  }, [projectId, setNodes]);

  const submitMusicChildAnalysis = useCallback(async (
    childNodeId: string,
    playerNodeId: string,
    kind: MusicChildNodeKind,
  ) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    const sourceNode = resolveMusicSourceNode({
      edges: edgesRef.current,
      nodes: nodesRef.current,
      playerNodeId,
    });
    const fileId = playerNode?.data.fileId ?? sourceNode?.data.fileId;
    if (!playerNode || !fileId) {
      setNodes((current) => current.map((node) => node.id === childNodeId
        ? { ...node, data: { ...node.data, musicError: "播放器没有可分析的上游音乐文件", musicJobStatus: "failed" as const } }
        : node));
      return;
    }
    try {
      if (kind === "sunoPrompt") {
        const cachedAnalysis = nodesRef.current.find((node) =>
          node.data.kind === "musicAnalysis" &&
          node.data.musicParentPlayerNodeId === playerNodeId &&
          node.data.musicJobStatus === "succeeded" &&
          node.data.musicJobId,
        );
        if (cachedAnalysis?.data.musicJobId) {
          const cachedResponse = await fetch(
            `/api/music/jobs/${encodeURIComponent(cachedAnalysis.data.musicJobId)}/suno-prompt`,
            { method: "POST" },
          );
          if (cachedResponse.ok) {
            const prompt = await cachedResponse.json() as Record<string, unknown>;
            setNodes((current) => current.map((node) => node.id === childNodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    musicAnalysisResult: { sunoPrompt: prompt },
                    musicError: undefined,
                    musicJobId: cachedAnalysis.data.musicJobId,
                    musicJobStatus: "succeeded" as const,
                    musicProgress: 1,
                    musicStage: "completed",
                    musicStageLabel: "已复用分析缓存",
                    sunoPromptEn: typeof prompt.promptEn === "string"
                      ? prompt.promptEn
                      : typeof prompt.en === "string" ? prompt.en : undefined,
                    sunoPromptZh: typeof prompt.promptZh === "string"
                      ? prompt.promptZh
                      : typeof prompt.zh === "string" ? prompt.zh : undefined,
                  },
                }
              : node));
            return;
          }
        }
      }
      const serviceCapabilities = await fetchMusicServiceCapabilities();
      const requestContract = musicJobRequestFor(kind, serviceCapabilities);
      const response = await fetch("/api/music/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          fileId,
          ...requestContract,
          options: {
            language: "auto",
            keepStems: kind !== "lyrics",
            requiredCapabilities: kind === "lyrics" ? ["lyrics"] : [],
          },
        }),
      });
      if (response.ok) {
        updateMusicJob(childNodeId, await response.json() as MusicJobSnapshot);
        return;
      }
      const body = await response.json().catch(() => null) as {
        detail?: { message?: string };
        error?: string;
        message?: string;
      } | null;
      const errorMessage = body?.detail?.message || body?.message || body?.error || "无法创建分析任务";
      setNodes((current) => current.map((node) => node.id === childNodeId
        ? { ...node, data: { ...node.data, musicError: errorMessage, musicJobStatus: "failed" as const } }
        : node));
    } catch (error) {
      setNodes((current) => current.map((node) => node.id === childNodeId
        ? { ...node, data: { ...node.data, musicError: error instanceof Error ? error.message : "音乐分析服务不可用", musicJobStatus: "failed" as const } }
        : node));
    }
  }, [projectId, setNodes, updateMusicJob]);

  const performMusicJobAction = useCallback(async (
    playerNodeId: string,
    jobId: string,
    action: "cancel" | "retry",
  ) => {
    const response = await fetch(`/api/music/jobs/${encodeURIComponent(jobId)}/${action}`, {
      method: "POST",
    });
    if (response.ok) {
      updateMusicJob(playerNodeId, await response.json() as MusicJobSnapshot);
      return;
    }
    setNodes((current) => current.map((node) => node.id === playerNodeId
      ? { ...node, data: { ...node.data, musicError: action === "cancel" ? "无法取消分析任务" : "无法重试分析任务" } }
      : node));
  }, [setNodes, updateMusicJob]);

  const completeMusicAnalysis = useCallback(
    (playerNodeId: string, jobId: string, result: Record<string, unknown>) => {
      const warnings = Array.isArray(result.warnings)
        ? result.warnings.flatMap((warning) => {
            if (!warning || typeof warning !== "object") return [];
            const message = (warning as { message?: unknown }).message;
            return typeof message === "string" ? [message] : [];
          })
        : [];
      setNodes((current) => current.map((node) => node.id === playerNodeId ? {
        ...node,
        data: {
          ...node.data,
          musicAnalysisResult: result,
          musicError: undefined,
          musicWarnings: warnings,
          musicJobId: jobId,
          musicJobStatus: "succeeded" as const,
          musicProgress: 1,
          musicRetryable: false,
          musicStage: "completed",
          musicStageLabel: "分析完成",
          musicWaveform: Array.isArray(result.waveform)
            ? result.waveform.filter((value): value is number => typeof value === "number")
            : node.data.musicWaveform,
          musicWaveformVersion: Array.isArray(result.waveform)
            ? MUSIC_WAVEFORM_VERSION
            : node.data.musicWaveformVersion,
        },
      } : node));
    },
    [setNodes],
  );

  const createMusicChild = useCallback((
    playerNodeId: string,
    kind: MusicChildNodeKind,
    position?: { x: number; y: number },
  ) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    if (!playerNode || playerNode.data.kind !== "musicPlayer") return;
    const update = createMusicChildUpdate({
      edges: edgesRef.current,
      kind,
      nodes: nodesRef.current,
      playerNode,
      position,
      projectId,
    });
    if (update.createdNodes.length || update.createdEdges.length) {
      appendCanvasItems({
        currentEdges: edgesRef.current,
        currentNodes: nodesRef.current,
        edges: update.createdEdges,
        nodes: update.createdNodes,
      });
    }
    focusMusicWorkflowNode(update.focusNodeId);
    window.setTimeout(() => {
      void submitMusicChildAnalysis(update.focusNodeId, playerNodeId, kind);
    }, 0);
  }, [appendCanvasItems, focusMusicWorkflowNode, projectId, submitMusicChildAnalysis]);

  const cancelMusicAnalysis = useCallback((playerNodeId: string, jobId: string) => {
    void performMusicJobAction(playerNodeId, jobId, "cancel");
  }, [performMusicJobAction]);

  const retryMusicAnalysis = useCallback((playerNodeId: string, jobId: string) => {
    void performMusicJobAction(playerNodeId, jobId, "retry");
  }, [performMusicJobAction]);

  const locateMusicPlayer = useCallback((_musicNodeId: string, playerNodeId: string) => {
    focusMusicWorkflowNode(playerNodeId);
  }, [focusMusicWorkflowNode]);

  const renderedNodes = useMemo(
    () =>
      getRenderedCanvasNodes({
        createNoteNode,
        edges,
        nodes,
        onCancelMusicAnalysis: cancelMusicAnalysis,
        onCreateMusicChildNode: createMusicChild,
        onCreateMusicPlayerNode: createMusicPlayer,
        onEnsureMusicWaveform: ensureMusicWaveform,
        onLocateMusicPlayerNode: locateMusicPlayer,
        onMusicAnalysisComplete: completeMusicAnalysis,
        onMusicJobUpdate: updateMusicJob,
        onRetryMusicAnalysis: retryMusicAnalysis,
        onSeekMusicPlayer: seekMusicPlayer,
        onToggleMusicPlayback: toggleMusicPlayback,
        onUpdateMusicNode: updateMusicNode,
        onUpdateMusicPlayback: updateMusicPlayback,
        onResolveImageDimensions: resolveImageNodeDimensions,
        onCreateTextChildNode: createTextChildNode,
        onSubmitImageNode: submitImageGenerationNode,
        onSubmitTextGenerationNode: submitTextGenerationNode,
        onUpdateImageNode: updateImageGenerationNode,
        onUpdateTextGenerationNode: updateTextGenerationNode,
        onUpdateTextNode: updateTextNode,
        onUpdateTaskNode: updateTaskNode,
        onToggleTaskChildren: toggleTaskChildren,
        onUpdateProjectTag: updateProjectTag,
        projectId,
        toggleReaderCollapse,
      }),
    [
      createNoteNode,
      cancelMusicAnalysis,
      createMusicChild,
      createMusicPlayer,
      ensureMusicWaveform,
      createTextChildNode,
      edges,
      nodes,
      completeMusicAnalysis,
      locateMusicPlayer,
      retryMusicAnalysis,
      seekMusicPlayer,
      toggleMusicPlayback,
      updateMusicJob,
      updateMusicNode,
      updateMusicPlayback,
      projectId,
      resolveImageNodeDimensions,
      submitImageGenerationNode,
      submitTextGenerationNode,
      toggleReaderCollapse,
      updateImageGenerationNode,
      updateTextGenerationNode,
      updateTextNode,
      updateTaskNode,
      toggleTaskChildren,
      updateProjectTag,
    ],
  );

  return (
    <div className={`zenme-canvas-shell h-full overflow-hidden bg-white text-zinc-950 ${isNodeDragging ? "zenme-canvas-node-dragging" : ""}`}>
      <main
        className="relative h-full w-full"
        onDoubleClick={handleCanvasDoubleClick}
        onPointerMove={(event) => {
          lastCanvasPointer.current = { x: event.clientX, y: event.clientY };
        }}
        onWheelCapture={handleCanvasWheelCapture}
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
          edgesFocusable
          edges={renderedEdges}
          elementsSelectable
          nodeTypes={nodeTypes}
          nodes={renderedNodes}
          connectionRadius={120}
          isValidConnection={isCanvasConnectionValid}
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
          minZoom={CANVAS_ZOOM_MIN}
          maxZoom={CANVAS_ZOOM_MAX}
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

        {selectionToolbarPosition && !isNodeDragging ? (
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
            onCreateImageGenerationNode={createImageGenerationNodeAt}
            onCreateManagedTextNode={createManagedTextNodeAt}
            onCreateTaskNode={createTaskNodeAt}
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
            onUploadConnectedFiles={openConnectedUploadPicker}
            onOpenReadingWorkspace={openReadingWorkspace}
            onCreateMusicPlayer={() => {
              if (!actionNode || actionNode.data.kind !== "music") return;
              createMusicPlayer(actionNode.id, nodeActionMenu.flowPosition);
              setNodeActionMenu(null);
            }}
            onCreateMusicChild={(kind) => {
              if (!actionNode || actionNode.data.kind !== "musicPlayer") return;
              createMusicChild(actionNode.id, kind, nodeActionMenu.flowPosition);
              setNodeActionMenu(null);
            }}
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

function getClipboardImageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
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
