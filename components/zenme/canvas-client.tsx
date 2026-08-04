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
import { Loader2, RefreshCw } from "lucide-react";
import { AgentPanel } from "@/components/zenme/agent-panel";
import type { AgentMessage } from "@/components/zenme/agent-types";
import { useAiModelOptions } from "@/components/zenme/use-ai-model-options";
import {
  CanvasAgentButton,
  CanvasBottomControls,
  CanvasNotice,
  CanvasSelectionToolbar,
  CanvasSideToolbar,
  CanvasTextSearchPanel,
  EmptyCanvasHint,
} from "@/components/zenme/canvas/controls";
import { searchCanvasNodes } from "@/components/zenme/canvas/text-search";
import {
  MusicLyricsOverlay,
  type MusicLyricsOverlayPosition,
} from "@/components/zenme/canvas/music-lyrics-overlay";
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
  createVideoTask,
  createExecutionInApi,
  downloadVideoTask,
  generateOrEditImage,
  getVideoTaskStatus,
  listExecutionsFromApi,
  saveProjectThumbnailToApi,
  uploadProjectFileToApi,
  updateExecutionAttemptInApi,
} from "@/lib/zenme-api";
import {
  ZENME_AGENT_KEY_PREFIX,
} from "@/lib/zenme";
import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import { parseProviderModelReference } from "@/lib/ai/model-reference";
import { createDroppedFileCanvasNodes } from "@/components/zenme/canvas/drop-files";
import {
  createCanvasNodeClipboardPayload,
  createPastedCanvasNodes,
  getClipboardImageFiles,
  hasSelectedClipboardText,
  parseCanvasNodeClipboardPayload,
  type CanvasNodeClipboardPayload,
  ZENME_NODE_CLIPBOARD_MIME,
  ZENME_NODE_CLIPBOARD_PREFIX,
} from "@/components/zenme/canvas/clipboard";
import { parseDroppedReadingNotePayload } from "@/components/zenme/canvas/drop-payload";
import { shouldPreventNativeCanvasAuxClick } from "@/components/zenme/canvas/pointer";
import {
  ALT_DRAG_PREVIEW_ID_PREFIX,
  createAltDragCopyUpdate,
  createAltDragPreviewNodes,
  isAltDragPreviewNode,
  removeAltDragPreviewClasses,
} from "@/components/zenme/canvas/alt-drag-copy";
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
import { consumeHomePromptRequest } from "@/components/zenme/canvas/home-prompt";
import {
  requestTextGenerationResponse,
  resolveTextGenerationPrompt,
} from "@/components/zenme/canvas/text-generation-request";
import { getRenderedCanvasEdges } from "@/components/zenme/canvas/edges";
import {
  createCanvasHistoryEntry,
  createCanvasHistoryNodeSnapshot,
  createWelcomeNodes,
  getCanvasHistorySignature,
  getClientPointFromConnectEnd,
  isEditableTarget,
  isEditableClipboardEvent,
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
  canSetTaskParent,
  createTaskConnectionNodeUpdate,
  createTaskParentSelectionUpdate,
} from "@/components/zenme/canvas/task-relationships";
import { createQuickArrangeUpdate } from "@/components/zenme/canvas/quick-arrange";
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
  preserveCanvasHistoryTransientData,
} from "@/components/zenme/canvas/history-state";
import {
  collectTextGenerationContext,
  collectTextGenerationImageUrls,
  getCanvasNodeContextText,
} from "@/components/zenme/canvas/text-generation-context";
import { buildContextualImageGenerationPrompt } from "@/components/zenme/canvas/image-generation-context";
import {
  expandImagePromptMentions,
  mergeReferenceNodeIds,
  normalizeImagePromptContent,
} from "@/components/zenme/canvas/image-prompt-mentions";
import { inspectCanvasNodeExecution } from "@/components/zenme/canvas/execution-preflight";
import {
  createTimedExecutionController,
  isExecutionTimeout,
} from "@/components/zenme/canvas/execution-abort";
import { reconcileCanvasExecutions } from "@/components/zenme/canvas/execution-recovery";
import {
  recoverInterruptedVideoTasks,
  waitForVideoTaskCompletion,
} from "@/components/zenme/canvas/video-task-runtime";
import {
  createConnectedEdge,
  createConnectedPlaceholderCanvasNode,
  createDerivedImageChildCanvasNode,
  createImageGenerationCanvasNode,
  createManagedTextCanvasNode,
  createTaskCanvasNode,
  createPendingImageResultChildCanvasNode,
  createPendingVideoResultChildCanvasNode,
  createDroppedReadingNoteCanvasNode,
  createAiResponseChildCanvasNode,
  createReadingNoteCanvasNode,
  createTextChildCanvasNode,
  createTextCanvasNode,
  createVideoGenerationCanvasNode,
} from "@/components/zenme/canvas/node-factories";
import {
  getImageRequestReferenceUrls,
  getOrderedImageReferenceUrls,
} from "@/components/zenme/canvas/image-reference-order";
import {
  createAiResponseExpansionUpdate,
  createImageGenerationNodeDataUpdate,
  createImagePromptExpansionUpdate,
  createMusicChildExpansionUpdate,
  createTextGenerationNodeDataUpdate,
  createTextNodeExpansionUpdate,
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
  createPreservedZoomNodeFocusOptions,
  createCanvasZoomViewport,
  createCanvasZoomViewportAtPoint,
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
  createLyricsNodeUpdate,
  createMusicPlayerUpdate,
  extractMusicLyrics,
  findLyricsNodesNeedingRefresh,
  getNextMusicSourceId,
  getMusicApiErrorMessage,
  MUSIC_WAVEFORM_VERSION,
  normalizeMusicLoopMode,
  resolveMusicSourceNode,
  resolveMusicSourceNodes,
} from "@/components/zenme/canvas/music-workflow";
import { generateLocalAudioWaveform } from "@/components/zenme/canvas/local-audio-waveform";
import { releaseRemovedMusicPlayers } from "@/components/zenme/canvas/music-player-runtime";
import {
  DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
  DEFAULT_IMAGE_EDIT_QUALITY,
  getImageDisplaySize,
  type ImageCameraControl,
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
  type MusicLoopMode,
  type MusicLyricLine,
  type ProjectTagAction,
} from "@/components/zenme/node-types";

type CanvasClientProps = {
  projectId: string;
};

type MusicLyricsOverlayState = {
  playerNodeId: string;
  position: MusicLyricsOverlayPosition;
};

type MusicLyricsOverlayContent = {
  error?: string;
  lines: MusicLyricLine[];
  sourceNodeId?: string;
  status: "idle" | "loading" | "succeeded" | "failed";
};

const THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const THUMBNAIL_CHANGE_REFRESH_DELAY_MS = 1200;
const DEFAULT_EDGE_OPTIONS = {
  interactionWidth: 24,
  type: "default",
  style: { stroke: "#9ca3af", strokeWidth: 2 },
};
const MINI_MAP_CLASS =
  "zenme-shadow-canvas !bottom-[66px] !left-3 !right-auto !top-auto !m-0 !h-[150px] !w-[200px] !overflow-hidden !rounded-xl !border !border-zinc-200 !bg-white/95 !backdrop-blur";

export function CanvasClient({ projectId }: CanvasClientProps) {
  const [nodes, setNodes, onNodesChange] =
    useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlow, setReactFlow] =
    useState<ReactFlowInstance<CanvasNode, Edge>>();
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [isMiniMapSuspended, setIsMiniMapSuspended] = useState(false);
  const [isNodeDragging, setIsNodeDragging] = useState(false);
  const [altDragPreviewNodes, setAltDragPreviewNodes] = useState<CanvasNode[]>([]);
  const [altDragMovingNodeIds, setAltDragMovingNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
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
  const [isCanvasSearchOpen, setIsCanvasSearchOpen] = useState(false);
  const [canvasSearchQuery, setCanvasSearchQuery] = useState("");
  const [canvasNotice, setCanvasNotice] = useState<string | null>(null);
  const [musicLyricsOverlay, setMusicLyricsOverlay] =
    useState<MusicLyricsOverlayState>();
  const [musicLyricsOverlayContent, setMusicLyricsOverlayContent] =
    useState<MusicLyricsOverlayContent>({ lines: [], status: "idle" });
  const [agentContext, setAgentContext] = useState<string>();
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentInput, setAgentInput] = useState("");
  const [agentIsSubmitting, setAgentIsSubmitting] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const homePromptRequestProjectRef = useRef<string | null>(null);
  const [agentModel, setAgentModel] = useState("");
  const configuredModelOptions = useAiModelOptions();
  const configuredImageModelOptions = useAiModelOptions("image");
  const configuredVideoModelOptions = useAiModelOptions("video");
  const configuredModelIds = useMemo(
    () => configuredModelOptions.map((option) => option.id),
    [configuredModelOptions],
  );
  const defaultTextModel = configuredModelOptions[0]?.id ?? "";
  const canvasSearchResults = useMemo(
    () => searchCanvasNodes(nodes, canvasSearchQuery),
    [canvasSearchQuery, nodes],
  );
  const closeCanvasSearch = useCallback(() => {
    setIsCanvasSearchOpen(false);
    setCanvasSearchQuery("");
  }, []);
  const toggleCanvasSearch = useCallback(() => {
    if (isCanvasSearchOpen) {
      closeCanvasSearch();
      return;
    }
    setIsCanvasSearchOpen(true);
  }, [closeCanvasSearch, isCanvasSearchOpen]);
  const [nodeActionMenu, setNodeActionMenu] =
    useState<NodeActionMenuState | null>(null);
  const [canvasAddMenu, setCanvasAddMenu] =
    useState<CanvasAddMenuState | null>(null);
  const [pendingViewport, setPendingViewport] = useState<Viewport | null>(null);
  const [canvasLoaded, setCanvasLoaded] = useState(false);
  const [canvasHydrated, setCanvasHydrated] = useState(false);
  const [canvasLoadError, setCanvasLoadError] = useState<string | null>(null);
  const [canvasLoadAttempt, setCanvasLoadAttempt] = useState(0);
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
  const activeExecutionSourceNodeIdsRef = useRef(new Set<string>());
  const activeExecutionControllersRef = useRef(new Map<string, AbortController>());
  const activeVideoTaskControllersRef = useRef(new Map<string, AbortController>());
  const defaultTextModelRef = useRef(defaultTextModel);
  defaultTextModelRef.current = defaultTextModel;

  useEffect(() => () => {
    activeExecutionControllersRef.current.forEach((controller) => controller.abort());
    activeExecutionControllersRef.current.clear();
    activeExecutionSourceNodeIdsRef.current.clear();
  }, [projectId]);
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
  const altDragSourceNodeId = useRef<string | null>(null);
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
  const musicEndedHandlerRef = useRef<(playerNodeId: string) => void>(() => {});
  const musicWaveformTasksRef = useRef(new Map<string, Promise<void>>());
  const refreshingLyricsKeysRef = useRef(new Set<string>());

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

  useEffect(
    () => () => {
      releaseRemovedMusicPlayers(musicPlayersRef.current, new Set());
    },
    [],
  );

  useEffect(() => {
    nodesRef.current = nodes;
    if (musicPlayersRef.current.size > 0) {
      releaseRemovedMusicPlayers(
        musicPlayersRef.current,
        new Set(
          nodes
            .filter((node) => node.data.kind === "musicPlayer")
            .map((node) => node.id),
        ),
      );
    }
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
              node.data.kind !== "lyrics")
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
      const createdAt = Date.now();
      const createdNodes = (input.nodes ?? []).map((node, index) =>
        node.data.createdAt
          ? node
          : {
              ...node,
              data: {
                ...node.data,
                createdAt: new Date(createdAt + index).toISOString(),
              },
            },
      );
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
    let cancelled = false;
    let hydrationFrame: number | null = null;

    async function loadCanvas() {
      isHydrating.current = true;
      didInitViewport.current = false;
      appliedViewportSignature.current = null;
      setCanvasLoaded(false);
      setCanvasHydrated(false);
      setCanvasLoadError(null);
      setPendingViewport(null);
      setNodes([]);
      setEdges([]);
      try {
        const project = await getProjectFromApi(projectId);
        if (cancelled) return;
        setHasProjectThumbnail(Boolean(project.thumbnail));
        const remoteSnapshot = await getCanvasSnapshotFromApi(projectId);
        if (cancelled) return;

        if (remoteSnapshot) {
          const snapshot = remoteSnapshot.snapshot as CanvasSnapshot;
          const restored = removeLegacyWelcomeNodes(
            snapshot.nodes.length ? snapshot.nodes : createWelcomeNodes(),
            snapshot.edges,
          );
          const restoredNodes = recoverInterruptedVideoTasks(
            recoverInterruptedImageTasks(
              normalizeGroupNodeRelations(
                restored.nodes.map(removeAltDragPreviewClasses),
              ),
            ),
          ).nodes;
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
          const initialNodes = createWelcomeNodes();
          setNodes(initialNodes);
          setEdges([]);
          resetCanvasHistory(initialNodes, []);
        }

        setSaveStatus("已保存");
        setCanvasLoaded(true);
        // 放开 isHydrating 延后一帧：确保 setNodes/setEdges 触发的 effect 先被屏蔽，
        // 避免快照回流把"已保存"误改写为"未保存"。
        hydrationFrame = requestAnimationFrame(() => {
          if (cancelled) return;
          isHydrating.current = false;
          setCanvasHydrated(true);
        });
      } catch (error) {
        if (cancelled) return;
        isHydrating.current = false;
        setCanvasLoaded(false);
        setCanvasHydrated(false);
        setSaveStatus("保存失败");
        setCanvasLoadError(
          error instanceof Error ? error.message : "画布加载失败",
        );
      }
    }

    void loadCanvas();

    return () => {
      cancelled = true;
      if (hydrationFrame !== null) {
        cancelAnimationFrame(hydrationFrame);
      }
    };
  }, [
    canvasLoadAttempt,
    projectId,
    resetCanvasHistory,
    setEdges,
    setNodes,
  ]);

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
      if (
        isEditableTarget(event.target) ||
        hasSelectedClipboardText(window.getSelection()) ||
        !event.clipboardData
      ) {
        return false;
      }
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
      if (
        !event.clipboardData ||
        isEditableClipboardEvent(event, document.activeElement)
      ) {
        return;
      }
      const clipboardData = event.clipboardData;
      const imageFiles = getClipboardImageFiles(clipboardData);
      if (imageFiles.length > 0) {
        event.preventDefault();
        const pastedImages = await createDroppedFileCanvasNodes({
          files: imageFiles,
          onReadingError: setCanvasNotice,
          position: getClipboardPastePosition(),
          projectId,
        });
        appendCanvasItems({
          currentEdges: edgesRef.current,
          currentNodes: nodesRef.current,
          nodes: pastedImages,
        });
        return;
      }

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
        const restoredNodes = preserveCanvasHistoryTransientData(
          previous.nodes,
          nodesRef.current,
        );
        skipNextHistoryEntryCount.current += 1;
        nodesRef.current = restoredNodes;
        edgesRef.current = previous.edges;
        setNodes(restoredNodes);
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

        await saveProjectThumbnailToApi({
          projectId,
          thumbnail,
        });
        setHasProjectThumbnail(true);
      })().catch(() => {
        // 缩略图后台刷新失败不影响画布快照保存状态。
      });
    }, 3000);
  }, [
    createThumbnail,
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

      const savedSignature = canvasPersistableSignature;
      savedCanvasSignature.current = savedSignature;
      setLastSavedAt(snapshot.updatedAt);
      setSaveStatus(
        pendingCanvasSignature.current === savedSignature
          ? "已保存"
          : "未保存",
      );
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

      if (pendingCanvasSignature.current !== savedCanvasSignature.current) {
        void saveCanvasSnapshot({
          edges: edgesRef.current,
          nodes: nodesRef.current,
          projectId,
          thumbnail: null,
          viewport: flow.getViewport(),
        }).catch(() => {
          // 离开项目时尽快保存最新快照，失败不阻塞页面跳转。
        });
      }

      void (async () => {
        if (nodesRef.current.length === 0) {
          return;
        }

        const thumbnail = await createCanvasThumbnail(viewportElement);
        if (!thumbnail) {
          return;
        }

        await saveProjectThumbnailToApi({
          projectId,
          thumbnail,
        });
      })().catch(() => {
        // 离开项目时的缩略图兜底失败不阻塞页面跳转。
      });
    };
  }, [projectId]);

  useEffect(() => {
    const flushPendingCanvas = () => {
      if (
        isHydrating.current ||
        pendingCanvasSignature.current === savedCanvasSignature.current
      ) {
        return;
      }
      void saveCanvasRef.current();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingCanvas();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushPendingCanvas);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushPendingCanvas);
    };
  }, []);

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
    }, THUMBNAIL_PERIODIC_REFRESH_INTERVAL_MS);

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
  }, [autoSaveIntervalMs, canvasLoaded, saveStatus]);

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
    }, THUMBNAIL_CHANGE_REFRESH_DELAY_MS);

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

      const sourceNode = nodes.find(
        (node) => node.id === normalizedConnection.source,
      );
      const targetNode = nodes.find(
        (node) => node.id === normalizedConnection.target,
      );
      const isTaskConnection =
        sourceNode?.data.kind === "task" &&
        targetNode?.data.kind === "task";
      if (
        isTaskConnection &&
        !canSetTaskParent({
          childId: targetNode.id,
          edges,
          nodes,
          parentId: sourceNode.id,
        })
      ) {
        setCanvasNotice("不能将当前任务或其子任务设为父任务");
        return;
      }

      const deletedEdges = isTaskConnection
        ? edges.filter((edge) => {
            const edgeSource = nodes.find((node) => node.id === edge.source);
            return (
              edge.target === targetNode.id &&
              edgeSource?.data.kind === "task" &&
              edge.source !== sourceNode.id
            );
          })
        : [];
      const retainedEdges = deletedEdges.length
        ? edges.filter((edge) => !deletedEdges.includes(edge))
        : edges;
      const nextEdges = addEdge(normalizedConnection, retainedEdges);
      const previousEdgeIds = new Set(retainedEdges.map((edge) => edge.id));
      const createdEdges = nextEdges.filter(
        (edge) => !previousEdgeIds.has(edge.id),
      );
      const taskNodeUpdate = isTaskConnection
        ? createTaskConnectionNodeUpdate({
            childId: targetNode.id,
            nodes,
            parentId: sourceNode.id,
          })
        : { nextNodes: nodes, nodeUpdates: [] };

      if (
        createdEdges.length === 0 &&
        deletedEdges.length === 0 &&
        taskNodeUpdate.nodeUpdates.length === 0
      ) {
        return;
      }

      skipNextHistoryEntryCount.current += 1;
      setNodes(taskNodeUpdate.nextNodes);
      setEdges(nextEdges);
      pushMutateHistory({
        afterEdges: nextEdges,
        afterNodes: taskNodeUpdate.nextNodes,
        createdEdges,
        deletedEdges,
        nodeUpdates: taskNodeUpdate.nodeUpdates,
      });
    },
    [edges, nodes, pushMutateHistory, setEdges, setNodes],
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

  const setTaskParent = useCallback(
    (nodeId: string, parentId?: string) => {
      const update = createTaskParentSelectionUpdate({
        edges: edgesRef.current,
        nodeId,
        nodes: nodesRef.current,
        parentId,
      });
      if (!update) return;

      skipNextHistoryEntryCount.current += 1;
      setNodes(update.nextNodes);
      setEdges(update.nextEdges);
      pushMutateHistory({
        afterEdges: update.nextEdges,
        afterNodes: update.nextNodes,
        deletedEdges: update.deletedEdges,
        nodeUpdates: update.nodeUpdates,
      });
    },
    [pushMutateHistory, setEdges, setNodes],
  );

  const toggleTaskChildren = useCallback(
    (
      nodeId: string,
      expanded: boolean,
      expandedContentHeight: number,
    ) => {
      const update = createTaskChildrenVisibilityUpdate({
        expanded,
        expandedContentHeight,
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

  const toggleAiResponseExpanded = useCallback(
    (nodeId: string, expanded: boolean) => {
      const update = createAiResponseExpansionUpdate({
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

  const toggleTextExpanded = useCallback(
    (nodeId: string, expanded: boolean) => {
      const update = createTextNodeExpansionUpdate({
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

  const toggleMusicChildExpanded = useCallback(
    (nodeId: string, expanded: boolean) => {
      const update = createMusicChildExpansionUpdate({
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
        imageCameraControl?: ImageCameraControl;
        imageOutputAspectRatio?: string;
        imageError?: string;
        imageModel?: string;
        imageQuality?: string;
        imagePrompt?: string;
        imagePromptMentions?: Array<{ nodeId: string; offset: number }>;
        imageStatus?: "idle" | "editing" | "done" | "failed";
        imageReferenceNodeIds?: string[];
        imageTextReferenceNodeIds?: string[];
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

  const toggleImagePromptExpanded = useCallback(
    (nodeId: string, expanded: boolean) => {
      const update = createImagePromptExpansionUpdate({
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

  const createDerivedImageNode = useCallback(
    async (
      sourceNodeId: string,
      input: {
        file: File;
        height: number;
        operation: "brush" | "crop";
        width: number;
      },
    ) => {
      const initialSourceNode = (reactFlow?.getNodes() ?? nodesRef.current)
        .find((node) => node.id === sourceNodeId);
      if (!initialSourceNode || initialSourceNode.data.kind !== "image") {
        throw new Error("找不到来源图片节点");
      }

      try {
        const upload = await uploadProjectFileToApi({ file: input.file, projectId });
        const currentNodes = reactFlow?.getNodes() ?? nodesRef.current;
        const currentEdges = reactFlow?.getEdges() ?? edgesRef.current;
        const sourceNode = currentNodes.find((node) => node.id === sourceNodeId);
        if (!sourceNode || sourceNode.data.kind !== "image") {
          throw new Error("来源图片节点已被移除");
        }
        const position = getNextConnectedChildNodePosition({
          childFallbackSize: getImageDisplaySize(input.width / input.height),
          edges: currentEdges,
          nodes: currentNodes,
          sourceFallbackSize: getImageDisplaySize(
            sourceNode.data.imageAspectRatio ?? input.width / input.height,
          ),
          sourceNode,
          yOffsetWithoutChild: 0,
        });
        const result = createDerivedImageChildCanvasNode({
          fileId: upload.fileId,
          fileName: input.file.name,
          height: input.height,
          id: crypto.randomUUID(),
          mimeType: input.file.type || "image/png",
          originalUrl: upload.originalUrl,
          position,
          previewUrl: upload.previewUrl,
          sourceNode,
          title: input.operation === "brush" ? "图片标记" : "图片裁剪",
          width: input.width,
        });
        appendCanvasItems({
          currentEdges,
          currentNodes,
          edges: [result.edge],
          nodes: [result.node],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "图片处理结果保存失败";
        setCanvasNotice(message);
        throw new Error(message);
      }
    },
    [appendCanvasItems, projectId, reactFlow],
  );

  const persistExecutionTaskNodes = useCallback(async (nextNodes: CanvasNode[]) => {
    await saveCanvasSnapshot({
      edges: edgesRef.current,
      nodes: nextNodes,
      projectId,
      thumbnail: null,
      viewport: reactFlowRef.current?.getViewport() ?? canvasViewportStateRef.current,
    });
  }, [projectId]);

  const submitTextGenerationNode = useCallback(
    async (nodeId: string, input?: { model?: string; prompt?: string }) => {
      const currentNodes = reactFlow?.getNodes() ?? nodesRef.current;
      const currentEdges = reactFlow?.getEdges() ?? edges;
      const sourceNode = currentNodes.find((node) => node.id === nodeId);
      if (!sourceNode) {
        return;
      }
      if (activeExecutionSourceNodeIdsRef.current.has(nodeId)) return;
      const preflight = inspectCanvasNodeExecution({
        availableModelIds: configuredModelIds,
        node: sourceNode,
        requestedModel: input?.model ?? sourceNode.data.textGenerationModel ?? defaultTextModel,
        requestedPrompt: input?.prompt,
      });
      if (!preflight.ok) {
        setCanvasNotice(preflight.issues[0]?.message ?? "文本生成检查失败");
        return;
      }
      const prompt = resolveTextGenerationPrompt(preflight.prompt);
      const model = preflight.model;
      activeExecutionSourceNodeIdsRef.current.add(nodeId);

      const ownContext = getCanvasNodeContextText(sourceNode);
      const upstreamContext = collectTextGenerationContext({
        edges: currentEdges,
        nodeId,
        nodes: currentNodes,
      });
      const imageUrls = collectTextGenerationImageUrls({
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
      const executionIdentity = {
        executionId: crypto.randomUUID(),
        nodeRunId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      };
      const resultNodeId = crypto.randomUUID();
      const taskStartedAt = Date.now();
      try {
        await createExecutionInApi({
          ...executionIdentity,
          projectId,
          kind: "text",
          input: { context, prompt },
          triggerNodeId: sourceNode.id,
          nodeId: resultNodeId,
          modelId: model,
          providerId: getProviderId(model),
          startedAt: new Date(taskStartedAt).toISOString(),
        });
      } catch (error) {
        activeExecutionSourceNodeIdsRef.current.delete(nodeId);
        setCanvasNotice(error instanceof Error ? error.message : "无法创建文本执行任务");
        return;
      }
      const { edge: nextEdge, node: nextNode } =
        createAiResponseChildCanvasNode({
          execution: executionIdentity,
          id: resultNodeId,
          model,
          position,
          prompt,
          startedAt: new Date(taskStartedAt).toISOString(),
          sourceNode,
        });

      appendCanvasItems({
        currentEdges,
        currentNodes,
        edges: [nextEdge],
        nodes: [nextNode],
      });

      const executionController = createTimedExecutionController(2 * 60 * 1000);
      activeExecutionControllersRef.current.set(resultNodeId, executionController.controller);
      try {
        await persistExecutionTaskNodes(nodesRef.current);
        const imageDataUrls = await Promise.all(
          imageUrls.map((url) => fetchImageAsDataUrl(url)),
        );
        const result = await requestTextGenerationResponse({
          context,
          imageDataUrls,
          model,
          prompt,
          signal: executionController.controller.signal,
        });
        if (!result) {
          throw new Error("模型未返回内容");
        }
        await updateExecutionAttemptInApi({
          ...executionIdentity,
          projectId,
          outputText: result,
          status: "succeeded",
        });

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
        const timedOut = isExecutionTimeout(executionController.controller.signal);
        const message = timedOut
          ? "文本生成超过 2 分钟，已停止，请重试"
          : error instanceof Error ? error.message : "文本生成失败";
        await updateExecutionAttemptInApi({
          ...executionIdentity,
          projectId,
          status: timedOut ? "timedOut" : "failed",
          error: {
            code: timedOut ? "text_generation_timed_out" : "text_generation_failed",
            message,
            retryable: true,
            stage: "submit",
          },
        }).catch(() => undefined);
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
      } finally {
        executionController.dispose();
        activeExecutionControllersRef.current.delete(resultNodeId);
        activeExecutionSourceNodeIdsRef.current.delete(nodeId);
      }
    },
    [appendCanvasItems, configuredModelIds, defaultTextModel, edges, persistExecutionTaskNodes, projectId, reactFlow, setNodes],
  );

  const updateVideoNode = useCallback((
    nodeId: string,
    updates: Parameters<NonNullable<CanvasNodeData["onUpdateVideoNode"]>>[1],
  ) => {
    const beforeNode = nodesRef.current.find((node) => node.id === nodeId);
    if (!beforeNode) return;
    const nextNodes = nodesRef.current.map((node) =>
      node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node,
    );
    skipNextHistoryEntryCount.current += 1;
    setNodes(nextNodes);
    pushNodeUpdateHistory(new Map([[nodeId, beforeNode]]), nextNodes);
  }, [pushNodeUpdateHistory, setNodes]);

  useEffect(() => {
    if (
      !canvasHydrated ||
      homePromptRequestProjectRef.current === projectId
    ) {
      return;
    }

    const request = consumeHomePromptRequest(projectId);
    if (!request) {
      return;
    }

    homePromptRequestProjectRef.current = projectId;
    void submitTextGenerationNode(request.nodeId, {
      model: request.model,
      prompt: request.prompt,
    });
  }, [canvasHydrated, projectId, submitTextGenerationNode]);

  const submitImageGenerationNode = useCallback(
    async (
      nodeId: string,
      input?: {
        aspectRatio?: string;
        cameraControl?: ImageCameraControl;
        model?: string;
        prompt?: string;
        promptMentions?: Array<{ nodeId: string; offset: number }>;
        quality?: string;
      },
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
          Boolean(node.data.originalUrl || node.data.previewUrl)
        );
      });
      const prompt = input?.prompt ?? sourceNode?.data.imagePrompt ?? "";
      const promptMentions =
        input?.promptMentions ?? sourceNode?.data.imagePromptMentions ?? [];
      const aspectRatio =
        input?.aspectRatio ??
        sourceNode?.data.imageOutputAspectRatio ??
        DEFAULT_IMAGE_EDIT_ASPECT_RATIO;
      const quality =
        input?.quality ??
        sourceNode?.data.imageQuality ??
        DEFAULT_IMAGE_EDIT_QUALITY;
      const cameraControl =
        input && Object.prototype.hasOwnProperty.call(input, "cameraControl")
          ? input.cameraControl
          : sourceNode?.data.imageCameraControl;
      const standaloneImageUrl = sourceNode?.data.kind === "imageGeneration"
        ? undefined
        : sourceNode?.data.originalUrl ?? sourceNode?.data.previewUrl;
      const imageReferenceCandidates = sourceNode?.data.imageReferenceCandidates ?? [];
      const textReferenceCandidates = sourceNode?.data.imageTextReferenceCandidates ?? [];
      const selectedReferenceNodeIds = mergeReferenceNodeIds(
        sourceNode?.data.imageReferenceNodeIds,
        promptMentions,
        imageReferenceCandidates,
      );
      const connectedReferenceImageUrls = getOrderedImageReferenceUrls({
        edges: currentEdges,
        nodes: currentNodes,
        selectedNodeIds: selectedReferenceNodeIds,
        targetNodeId: nodeId,
      });
      const referenceImageUrls = getImageRequestReferenceUrls({
        connectedReferenceImageUrls,
        currentImageUrl: standaloneImageUrl,
      });
      const operation = referenceImageUrls.length > 0
        ? "edit" as const
        : "generate" as const;

      if (!sourceNode) {
        return;
      }
      if (activeExecutionSourceNodeIdsRef.current.has(nodeId)) return;

      const model =
        input?.model ??
        sourceNode.data.imageModel ??
        configuredImageModelOptions[0]?.id ??
        "";
      const preflight = inspectCanvasNodeExecution({
        availableModelIds: configuredImageModelOptions.map((option) => option.id),
        node: sourceNode,
        requestedModel: model,
        requestedPrompt: prompt,
      });
      if (!preflight.ok) {
        setCanvasNotice(preflight.issues[0]?.message ?? "图片生成检查失败");
        return;
      }
      activeExecutionSourceNodeIdsRef.current.add(nodeId);

      const selectedTextReferenceNodeIds = mergeReferenceNodeIds(
        sourceNode.data.imageTextReferenceNodeIds,
        promptMentions,
        textReferenceCandidates,
      );
      const normalizedPromptContent = normalizeImagePromptContent(
        prompt,
        promptMentions,
      );
      const requestText = expandImagePromptMentions({
        imageReferenceNodeIds: selectedReferenceNodeIds,
        mentions: normalizedPromptContent.mentions,
        prompt: normalizedPromptContent.prompt,
        references: [
          ...imageReferenceCandidates.map((reference) => ({
            kind: "image" as const,
            nodeId: reference.nodeId,
            title: reference.title,
          })),
          ...textReferenceCandidates.map((reference) => ({
            kind: "text" as const,
            nodeId: reference.nodeId,
            title: reference.title,
          })),
        ],
      });
      const textContext = collectTextGenerationContext({
        edges: currentEdges,
        nodeId,
        nodes: currentNodes,
        sourceNodeIds: selectedTextReferenceNodeIds,
      });
      const requestPrompt = buildContextualImageGenerationPrompt({
        context: textContext,
        prompt: requestText,
      });

      const position = getNextConnectedChildNodePosition({
        childFallbackSize: { height: 320, width: 420 },
        edges: currentEdges,
        nodes: currentNodes,
        sourceFallbackSize: { height: 320, width: 420 },
        sourceNode,
        yOffsetWithoutChild: 0,
      });
      const taskStartedAt = Date.now();
      const executionIdentity = {
        executionId: crypto.randomUUID(),
        nodeRunId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
      };
      const resultNodeId = crypto.randomUUID();
      try {
        await createExecutionInApi({
          ...executionIdentity,
          projectId,
          kind: "image",
          input: {
            context: textContext,
            parameters: { aspectRatio, operation, quality },
            prompt: requestText,
          },
          triggerNodeId: sourceNode.id,
          nodeId: resultNodeId,
          modelId: model,
          providerId: getProviderId(model),
          startedAt: new Date(taskStartedAt).toISOString(),
        });
      } catch (error) {
        activeExecutionSourceNodeIdsRef.current.delete(nodeId);
        setCanvasNotice(error instanceof Error ? error.message : "无法创建图片执行任务");
        return;
      }
      const { edge: resultEdge, node: resultNode } =
        createPendingImageResultChildCanvasNode({
          aspectRatio,
          cameraControl,
          execution: executionIdentity,
          id: resultNodeId,
          model,
          position,
          prompt: normalizedPromptContent.prompt.trim(),
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

      const executionController = createTimedExecutionController(5 * 60 * 1000);
      activeExecutionControllersRef.current.set(resultNodeId, executionController.controller);
      try {
        await persistExecutionTaskNodes(nodesRef.current);
        const imageDataUrls = await Promise.all(
          referenceImageUrls.map((url) => fetchImageAsDataUrl(url)),
        );
        const edited = await generateOrEditImage({
          aspectRatio,
          cameraControl,
          imageDataUrls,
          model,
          operation,
          prompt: requestPrompt,
          quality,
          signal: executionController.controller.signal,
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
        const completedExecution = await updateExecutionAttemptInApi({
          ...executionIdentity,
          projectId,
          assetFileIds: [upload.fileId],
          status: "succeeded",
        });
        const assetRefs = completedExecution.nodeRuns[0]?.attempts.at(-1)?.assetRefs ?? [];
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
                  assetRefs,
                  imageCameraControl: cameraControl,
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
        setLastSavedAt(committedSnapshot.updatedAt);
        setSaveStatus(
          pendingCanvasSignature.current === committedSignature
            ? "已保存"
            : "未保存",
        );
      } catch (error) {
        const timedOut = isExecutionTimeout(executionController.controller.signal);
        const message = timedOut
          ? "图片生成超过 5 分钟，已停止，请重试"
          : error instanceof Error ? error.message : "图片编辑失败，请稍后重试";
        await updateExecutionAttemptInApi({
          ...executionIdentity,
          projectId,
          status: timedOut ? "timedOut" : "failed",
          error: {
            code: timedOut ? "image_generation_timed_out" : "image_generation_failed",
            message,
            retryable: true,
            stage: "submit",
          },
        }).catch(() => undefined);
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
      } finally {
        executionController.dispose();
        activeExecutionControllersRef.current.delete(resultNodeId);
        activeExecutionSourceNodeIdsRef.current.delete(nodeId);
      }
    },
    [appendCanvasItems, configuredImageModelOptions, persistExecutionTaskNodes, projectId, pushNodeUpdateHistory, reactFlow, setNodes],
  );

  const runVideoTask = useCallback(async (input: {
    attemptId: string;
    executionId: string;
    model: string;
    nodeId: string;
    nodeRunId: string;
    startedAt: string;
    taskId: string;
  }) => {
    if (activeVideoTaskControllersRef.current.has(input.nodeId)) return;
    const controller = new AbortController();
    activeVideoTaskControllersRef.current.set(input.nodeId, controller);
    const startedAtMs = Date.parse(input.startedAt);
    try {
      await waitForVideoTaskCompletion({
        getStatus: () => getVideoTaskStatus({
          model: input.model,
          signal: controller.signal,
          taskId: input.taskId,
        }),
        signal: controller.signal,
        startedAt: input.startedAt,
      });
      const generated = await downloadVideoTask({
        model: input.model,
        projectId,
        signal: controller.signal,
        taskId: input.taskId,
      });
      const completedExecution = await updateExecutionAttemptInApi({
        projectId,
        executionId: input.executionId,
        nodeRunId: input.nodeRunId,
        attemptId: input.attemptId,
        externalTaskId: input.taskId,
        assetFileIds: [generated.fileId],
        status: "succeeded",
      });
      const assetRefs = completedExecution.nodeRuns
        .find((nodeRun) => nodeRun.id === input.nodeRunId)
        ?.attempts.find((attempt) => attempt.id === input.attemptId)
        ?.assetRefs ?? [];
      const nextNodes = nodesRef.current.map((node) =>
        node.id === input.nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                fileId: generated.fileId,
                assetRefs,
                originalUrl: generated.originalUrl,
                videoError: undefined,
                videoStatus: "done" as const,
                videoTaskDurationMs: Date.now() - (Number.isFinite(startedAtMs) ? startedAtMs : Date.now()),
              },
            }
          : node,
      );
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistExecutionTaskNodes(nextNodes).catch(() => undefined);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "视频生成失败，请稍后重试";
      const timedOut = message.includes("超过 15 分钟");
      await updateExecutionAttemptInApi({
        projectId,
        executionId: input.executionId,
        nodeRunId: input.nodeRunId,
        attemptId: input.attemptId,
        externalTaskId: input.taskId,
        status: timedOut ? "timedOut" : "failed",
        error: {
          code: timedOut ? "video_task_timed_out" : "video_task_failed",
          message,
          retryable: true,
          stage: "poll",
        },
      }).catch(() => undefined);
      const nextNodes = nodesRef.current.map((node) =>
        node.id === input.nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                videoError: message,
                videoStatus: "failed" as const,
                videoTaskDurationMs: Date.now() - (Number.isFinite(startedAtMs) ? startedAtMs : Date.now()),
              },
            }
          : node,
      );
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistExecutionTaskNodes(nextNodes).catch(() => undefined);
    } finally {
      if (activeVideoTaskControllersRef.current.get(input.nodeId) === controller) {
        activeVideoTaskControllersRef.current.delete(input.nodeId);
      }
    }
  }, [persistExecutionTaskNodes, projectId, setNodes]);

  useEffect(() => {
    if (!canvasHydrated) return;
    const taskControllers = activeVideoTaskControllersRef.current;
    let disposed = false;
    void (async () => {
      const executions = await listExecutionsFromApi(projectId).catch(() => []);
      if (disposed) return;
      const reconciled = reconcileCanvasExecutions({
        executions,
        nodes: nodesRef.current,
        projectId,
      });
      await Promise.all(reconciled.interruptedAttempts.map((record) =>
        updateExecutionAttemptInApi({
          projectId,
          executionId: record.execution.id,
          nodeRunId: record.nodeRun.id,
          attemptId: record.attempt.id,
          externalTaskId: record.attempt.externalTaskId,
          status: "failed",
          error: {
            code: "execution_interrupted",
            message: record.nodeRun.kind === "video"
              ? "视频任务缺少服务商任务 ID，请重试"
              : `${record.nodeRun.kind === "text" ? "文本" : "图片"}请求因应用重启而中断，请重试`,
            retryable: true,
            stage: "recovery",
          },
        }).catch(() => undefined),
      ));
      if (reconciled.changed) {
        nodesRef.current = reconciled.nodes;
        setNodes(reconciled.nodes);
        await persistExecutionTaskNodes(reconciled.nodes).catch(() => undefined);
      }
      const recoveredByNodeId = new Map(
        reconciled.recoverableVideos.map((record) => [record.nodeRun.nodeId, record]),
      );
      const executionRecordByNodeId = new Map(executions.flatMap((execution) =>
        execution.nodeRuns.flatMap((nodeRun) => {
          const attempt = nodeRun.attempts.find(
            (candidate) => candidate.id === nodeRun.currentAttemptId,
          );
          return attempt ? [[nodeRun.nodeId, { execution, nodeRun, attempt }] as const] : [];
        }),
      ));
      const { resumable } = recoverInterruptedVideoTasks(reconciled.nodes);
      for (const node of resumable) {
        const recovered = recoveredByNodeId.get(node.id);
        const existingRecord = executionRecordByNodeId.get(node.id);
        const taskId = recovered?.attempt.externalTaskId ?? node.data.externalTaskId ?? node.data.providerTaskId;
        if (!taskId || !node.data.videoModel) continue;
        let identity = recovered
          ? {
              executionId: recovered.execution.id,
              nodeRunId: recovered.nodeRun.id,
              attemptId: recovered.attempt.id,
            }
          : existingRecord
            ? {
                executionId: existingRecord.execution.id,
                nodeRunId: existingRecord.nodeRun.id,
                attemptId: existingRecord.attempt.id,
              }
          : node.data.executionId && node.data.nodeRunId && node.data.attemptId
            ? {
                executionId: node.data.executionId,
                nodeRunId: node.data.nodeRunId,
                attemptId: node.data.attemptId,
              }
            : null;
        if (!recovered) {
          identity ??= {
            executionId: node.data.executionId ?? crypto.randomUUID(),
            nodeRunId: crypto.randomUUID(),
            attemptId: crypto.randomUUID(),
          };
          if (!executions.some((execution) => execution.id === identity?.executionId)) {
            await createExecutionInApi({
              ...identity,
              projectId,
              kind: "video",
              triggerNodeId: node.id,
              nodeId: node.id,
              modelId: node.data.videoModel,
              providerId: getProviderId(node.data.videoModel),
              startedAt: node.data.videoTaskStartedAt,
            });
          }
          await updateExecutionAttemptInApi({
            ...identity,
            projectId,
            externalTaskId: taskId,
            status: "polling",
          });
        }
        if (!identity) continue;
        if (disposed) return;
        void runVideoTask({
          ...identity,
          model: node.data.videoModel,
          nodeId: node.id,
          startedAt: node.data.videoTaskStartedAt ?? new Date().toISOString(),
          taskId,
        });
      }
    })();
    return () => {
      disposed = true;
      taskControllers.forEach((controller) => controller.abort());
      taskControllers.clear();
    };
  }, [canvasHydrated, persistExecutionTaskNodes, projectId, runVideoTask, setNodes]);

  const submitVideoGenerationNode = useCallback(async (
    nodeId: string,
    input?: Parameters<NonNullable<CanvasNodeData["onSubmitVideoNode"]>>[1],
  ) => {
    const currentNodes = reactFlow?.getNodes() ?? nodesRef.current;
    const currentEdges = reactFlow?.getEdges() ?? edgesRef.current;
    const sourceNode = currentNodes.find(
      (node) => node.id === nodeId && node.data.kind === "videoGeneration",
    );
    const prompt = input?.prompt?.trim() ?? sourceNode?.data.videoPrompt?.trim() ?? "";
    const model = input?.model ?? sourceNode?.data.videoModel ?? configuredVideoModelOptions[0]?.id ?? "";
    if (!sourceNode) return;
    const preflight = inspectCanvasNodeExecution({
      availableModelIds: configuredVideoModelOptions.map((option) => option.id),
      node: sourceNode,
      requestedModel: model,
      requestedPrompt: prompt,
    });
    if (!preflight.ok) {
      setCanvasNotice(preflight.issues[0]?.message ?? "视频生成检查失败");
      return;
    }
    if (activeExecutionSourceNodeIdsRef.current.has(nodeId)) return;
    activeExecutionSourceNodeIdsRef.current.add(nodeId);

    const duration = input?.duration ?? sourceNode.data.videoDuration ?? 5;
    const generateAudio = input?.generateAudio ?? sourceNode.data.videoGenerateAudio !== false;
    const ratio = input?.ratio ?? sourceNode.data.videoRatio ?? "adaptive";
    const resolution = input?.resolution ?? sourceNode.data.videoResolution ?? "720p";
    const referenceMode = input?.referenceMode ?? sourceNode.data.videoReferenceMode ?? "firstLast";
    const referenceUrls = getOrderedImageReferenceUrls({
      edges: currentEdges,
      nodes: currentNodes,
      selectedNodeIds: sourceNode.data.imageReferenceNodeIds,
      targetNodeId: nodeId,
    }).slice(0, referenceMode === "firstLast" ? 2 : 5);
    const position = getNextConnectedChildNodePosition({
      childFallbackSize: { height: 320, width: 560 },
      edges: currentEdges,
      nodes: currentNodes,
      sourceFallbackSize: { height: 360, width: 560 },
      sourceNode,
      yOffsetWithoutChild: 0,
    });
    const executionIdentity = {
      executionId: crypto.randomUUID(),
      nodeRunId: crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
    };
    const resultNodeId = crypto.randomUUID();
    const taskStartedAt = Date.now();
    try {
      await createExecutionInApi({
        ...executionIdentity,
        projectId,
        kind: "video",
        input: {
          parameters: {
            duration,
            generateAudio,
            ratio,
            referenceMode,
            resolution,
          },
          prompt,
        },
        triggerNodeId: sourceNode.id,
        nodeId: resultNodeId,
        modelId: model,
        providerId: getProviderId(model),
        startedAt: new Date(taskStartedAt).toISOString(),
      });
    } catch (error) {
      activeExecutionSourceNodeIdsRef.current.delete(nodeId);
      setCanvasNotice(error instanceof Error ? error.message : "无法创建视频执行任务");
      return;
    }
    const { edge: resultEdge, node: resultNode } = createPendingVideoResultChildCanvasNode({
      duration,
      execution: executionIdentity,
      generateAudio,
      id: resultNodeId,
      model,
      position,
      prompt,
      ratio,
      resolution,
      sourceNode,
      startedAt: new Date(taskStartedAt).toISOString(),
    });
    appendCanvasItems({
      currentEdges,
      currentNodes,
      edges: [resultEdge],
      nodes: [resultNode],
    });

    const submitController = createTimedExecutionController(2 * 60 * 1000);
    activeExecutionControllersRef.current.set(resultNodeId, submitController.controller);
    try {
      await persistExecutionTaskNodes(nodesRef.current);
      const imageDataUrls = await Promise.all(referenceUrls.map(fetchImageAsDataUrl));
      const created = await createVideoTask({
        duration,
        generateAudio,
        imageDataUrls,
        imageRoles: referenceMode === "firstLast"
          ? imageDataUrls.map((_, index) => index === 0 ? "first_frame" as const : "last_frame" as const)
          : imageDataUrls.map(() => "reference_image" as const),
        model,
        prompt,
        ratio,
        resolution,
        signal: submitController.controller.signal,
      });
      await updateExecutionAttemptInApi({
        ...executionIdentity,
        projectId,
        externalTaskId: created.taskId,
        status: "polling",
      });
      const nextNodes = nodesRef.current.map((node) =>
        node.id === resultNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                externalTaskId: created.taskId,
                providerTaskId: created.taskId,
              },
            }
          : node,
      );
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistExecutionTaskNodes(nextNodes).catch(() => undefined);
      await runVideoTask({
        ...executionIdentity,
        model,
        nodeId: resultNode.id,
        startedAt: new Date(taskStartedAt).toISOString(),
        taskId: created.taskId,
      });
    } catch (error) {
      const timedOut = isExecutionTimeout(submitController.controller.signal);
      const message = timedOut
        ? "视频任务提交超过 2 分钟，已停止，请重试"
        : error instanceof Error ? error.message : "视频生成失败，请稍后重试";
      await updateExecutionAttemptInApi({
        ...executionIdentity,
        projectId,
        status: timedOut ? "timedOut" : "failed",
        error: {
          code: timedOut ? "video_submit_timed_out" : "video_submit_failed",
          message,
          retryable: true,
          stage: "submit",
        },
      }).catch(() => undefined);
      const nextNodes = nodesRef.current.map((node) =>
        node.id === resultNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                videoError: message,
                videoStatus: "failed" as const,
                videoTaskDurationMs: Date.now() - taskStartedAt,
              },
            }
          : node,
      );
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      await persistExecutionTaskNodes(nextNodes).catch(() => undefined);
    } finally {
      submitController.dispose();
      activeExecutionControllersRef.current.delete(resultNodeId);
      activeExecutionSourceNodeIdsRef.current.delete(nodeId);
    }
  }, [
    appendCanvasItems,
    configuredVideoModelOptions,
    persistExecutionTaskNodes,
    projectId,
    reactFlow,
    runVideoTask,
    setNodes,
  ]);

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

  const quickArrangeCanvas = useCallback(() => {
    const update = createQuickArrangeUpdate({
      edges: edgesRef.current,
      nodes: nodesRef.current,
    });
    if (!update) return;

    skipNextHistoryEntryCount.current += 1;
    setNodes(update.nextNodes);
    setEdges(update.nextEdges);
    pushMutateHistory({
      afterEdges: update.nextEdges,
      afterNodes: update.nextNodes,
      edgeUpdates: update.edgeUpdates,
      nodeUpdates: update.nodeUpdates,
    });
    setNodeActionMenu(null);
    setCanvasAddMenu(null);
    window.requestAnimationFrame(() => {
      void reactFlowRef.current?.fitView({
        duration: 300,
        padding: 0.16,
      });
    });
  }, [pushMutateHistory, setEdges, setNodes]);

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

  function createVideoGenerationNodeAt(position: { x: number; y: number }) {
    const { node } = createVideoGenerationCanvasNode({
      id: crypto.randomUUID(),
      model: configuredVideoModelOptions[0]?.id,
      position,
    });
    appendCanvasItems({ currentEdges: edges, currentNodes: nodes, nodes: [node] });
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
    (draggedNode: CanvasNode, duplicateOnDrop: boolean) => {
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
      const beforeNodeSnapshots = new Map(
        currentNodes.map((node) => [
          node.id,
          createCanvasHistoryNodeSnapshot(node),
        ]),
      );
      dragStartNodeSnapshots.current = beforeNodeSnapshots;
      altDragSourceNodeId.current = duplicateOnDrop ? draggedNode.id : null;
      if (duplicateOnDrop) {
        const previewNodes = createAltDragPreviewNodes({
          beforeNodeSnapshots,
          draggedNodeId: draggedNode.id,
        });
        setAltDragPreviewNodes(previewNodes);
        setAltDragMovingNodeIds(new Set(
          previewNodes.map((node) =>
            node.id.slice(ALT_DRAG_PREVIEW_ID_PREFIX.length),
          ),
        ));
      } else {
        setAltDragPreviewNodes([]);
        setAltDragMovingNodeIds(new Set());
      }

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
    (draggedNode?: CanvasNode) => {
      isCanvasInteractionActive.current = false;
      setIsMiniMapSuspended(false);
      setIsNodeDragging(false);
      setAltDragPreviewNodes([]);
      setAltDragMovingNodeIds(new Set());
      tickCanvasInteractionSample(dragInteractionSample.current);
      if (!draggedNode) {
        altDragSourceNodeId.current = null;
        dragStartNodeSnapshots.current = null;
        groupDragPosition.current = null;
        stopCanvasInteractionSample(dragInteractionSample.current, {
          edges: edges.length,
          nodes: nodes.length,
        });
        dragInteractionSample.current = null;
        return;
      }
      const currentNodes = (reactFlow?.getNodes() ?? nodes).filter(
        (node) => !isAltDragPreviewNode(node),
      );
      const duplicateSourceNodeId = altDragSourceNodeId.current;
      altDragSourceNodeId.current = null;

      if (
        duplicateSourceNodeId === draggedNode.id &&
        dragStartNodeSnapshots.current
      ) {
        const copyUpdate = createAltDragCopyUpdate({
          beforeNodeSnapshots: dragStartNodeSnapshots.current,
          createId: () => crypto.randomUUID(),
          currentNodes,
          draggedNodeId: draggedNode.id,
        });

        if (copyUpdate) {
          groupDragPosition.current = null;
          nodesRef.current = copyUpdate.nextNodes;
          skipNextHistoryEntryCount.current += 1;
          setNodes(copyUpdate.nextNodes);
          pushCreateHistory({
            afterEdges: edgesRef.current,
            afterNodes: copyUpdate.nextNodes,
            nodes: copyUpdate.createdNodes,
          });
          stopCanvasInteractionSample(dragInteractionSample.current, {
            edges: edges.length,
            nodes: copyUpdate.nextNodes.length,
          });
          dragInteractionSample.current = null;
          dragStartNodeSnapshots.current = null;
          return;
        }
      }

      if (draggedNode.data.kind === "group") {
        groupDragPosition.current = null;
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
      pushCreateHistory,
      pushNodeUpdateHistory,
      reactFlow,
      setNodes,
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
      | "imageGeneration"
      | "videoGeneration",
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
            : kind === "videoGeneration"
              ? configuredVideoModelOptions[0]?.id
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

  const focusCanvasNode = useCallback((
    nodeId: string,
    options?: { preserveZoom?: boolean },
  ) => {
    setNodes((current) => current.map((node) => ({
      ...node,
      selected: node.id === nodeId,
    })));
    window.requestAnimationFrame(() => {
      const flow = reactFlowRef.current;
      if (!flow) return;
      void flow.fitView(
        options?.preserveZoom
          ? createPreservedZoomNodeFocusOptions(
              nodeId,
              flow.getViewport().zoom,
            )
          : {
              duration: 220,
              nodes: [{ id: nodeId }],
              padding: 0.3,
            },
      );
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
    focusCanvasNode(update.focusNodeId, { preserveZoom: true });
  }, [appendCanvasItems, focusCanvasNode, projectId]);

  const ensureMusicPlayback = useCallback((playerNodeId: string) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    const sourceNode = resolveMusicSourceNode({
      edges: edgesRef.current,
      nodes: nodesRef.current,
      playerNodeId,
      sourceNodeId: playerNode?.data.musicSourceNodeId,
    });
    const source = sourceNode?.data.kind === "music"
      ? sourceNode.data.originalUrl
      : playerNode?.data.originalUrl;
    if (!playerNode || !source) return undefined;

    let audio = musicPlayersRef.current.get(playerNodeId);
    if (!audio || audio.src !== new URL(source, window.location.href).href) {
      audio?.pause();
      const nextAudio = new Audio(source);
      nextAudio.preload = "metadata";
      nextAudio.loop = normalizeMusicLoopMode(
        playerNode.data.musicLoopMode,
        playerNode.data.musicLoop,
      ) === "one";
      nextAudio.muted = Boolean(playerNode.data.musicMuted);
      nextAudio.playbackRate = playerNode.data.musicPlaybackRate ?? 1;
      nextAudio.volume = playerNode.data.musicVolume ?? 1;
      musicPlayersRef.current.set(playerNodeId, nextAudio);
      setNodes((current) => current.map((node) => node.id === playerNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              musicCurrentTime: 0,
              musicIsPlaying: false,
            },
          }
        : node));
      nextAudio.addEventListener("loadedmetadata", () => {
        const duration = Number.isFinite(nextAudio.duration)
          ? Math.max(0, nextAudio.duration)
          : 0;
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                musicCurrentTime: Math.min(
                  duration,
                  Math.max(0, nextAudio.currentTime),
                ),
                musicDuration: duration,
              },
            }
          : node));
      });
      nextAudio.addEventListener("timeupdate", () => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? { ...node, data: { ...node.data, musicCurrentTime: nextAudio.currentTime } }
          : node));
      });
      nextAudio.addEventListener("ended", () => {
        musicEndedHandlerRef.current(playerNodeId);
      });
      audio = nextAudio;
    }
    return audio;
  }, [setNodes]);

  const toggleMusicPlayback = useCallback((playerNodeId: string, playing: boolean) => {
    const audio = ensureMusicPlayback(playerNodeId);
    if (!audio) return;

    for (const [id, otherAudio] of musicPlayersRef.current) {
      if (id !== playerNodeId) otherAudio.pause();
    }
    setNodes((current) => current.map((node) => node.data.kind === "musicPlayer"
      ? { ...node, data: { ...node.data, musicIsPlaying: node.id === playerNodeId && playing } }
      : node));

    if (playing) {
      void audio.play().catch((error) => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? { ...node, data: { ...node.data, musicError: error instanceof Error ? error.message : "无法播放音乐", musicIsPlaying: false } }
          : node));
      });
    } else {
      audio.pause();
    }
  }, [ensureMusicPlayback, setNodes]);

  const updateMusicPlayback = useCallback((playerNodeId: string, updates: {
    loop?: boolean;
    loopMode?: MusicLoopMode;
    muted?: boolean;
    playbackRate?: number;
    sourceListExpanded?: boolean;
    volume?: number;
  }) => {
    const audio = musicPlayersRef.current.get(playerNodeId);
    const nextLoopMode = updates.loopMode ?? (
      updates.loop === undefined ? undefined : updates.loop ? "one" : "off"
    );
    if (audio) {
      if (nextLoopMode !== undefined) audio.loop = nextLoopMode === "one";
      if (updates.muted !== undefined) audio.muted = updates.muted;
      if (updates.playbackRate !== undefined) audio.playbackRate = updates.playbackRate;
      if (updates.volume !== undefined) audio.volume = updates.volume;
    }
    setNodes((current) => current.map((node) => node.id === playerNodeId
      ? {
          ...node,
          data: {
            ...node.data,
            ...(nextLoopMode === undefined ? {} : {
              musicLoop: nextLoopMode === "one",
              musicLoopMode: nextLoopMode,
            }),
            ...(updates.muted === undefined ? {} : { musicMuted: updates.muted }),
            ...(updates.playbackRate === undefined ? {} : { musicPlaybackRate: updates.playbackRate }),
            ...(updates.sourceListExpanded === undefined ? {} : { musicSourceListExpanded: updates.sourceListExpanded }),
            ...(updates.volume === undefined ? {} : { musicVolume: updates.volume }),
          },
        }
      : node));
  }, [setNodes]);

  const selectMusicSource = useCallback((playerNodeId: string, sourceNodeId: string) => {
    const isConnectedMusicSource = edgesRef.current.some((edge) => {
      if (edge.source !== sourceNodeId || edge.target !== playerNodeId) return false;
      return nodesRef.current.find((node) => node.id === sourceNodeId)?.data.kind === "music";
    });
    if (!isConnectedMusicSource) return;

    musicPlayersRef.current.get(playerNodeId)?.pause();
    musicPlayersRef.current.delete(playerNodeId);
    const nextNodes = nodesRef.current.map((node) => node.id === playerNodeId
      ? {
          ...node,
          data: {
            ...node.data,
            musicCurrentTime: 0,
            musicDuration: undefined,
            musicError: undefined,
            musicIsPlaying: false,
            musicSourceNodeId: sourceNodeId,
            musicWaveform: undefined,
            musicWaveformSourceNodeId: undefined,
            musicWaveformVersion: undefined,
          },
        }
      : node);
    nodesRef.current = nextNodes;
    setNodes(nextNodes);
  }, [setNodes]);

  const handleMusicPlaybackEnded = useCallback((playerNodeId: string) => {
    const playerNode = nodesRef.current.find(
      (node) => node.id === playerNodeId && node.data.kind === "musicPlayer",
    );
    if (!playerNode) return;

    const loopMode = normalizeMusicLoopMode(
      playerNode.data.musicLoopMode,
      playerNode.data.musicLoop,
    );
    const audio = musicPlayersRef.current.get(playerNodeId);

    if (loopMode === "one" && audio) {
      audio.currentTime = 0;
      void audio.play().catch((error) => {
        setNodes((current) => current.map((node) => node.id === playerNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                musicError: error instanceof Error ? error.message : "无法播放音乐",
                musicIsPlaying: false,
              },
            }
          : node));
      });
      return;
    }

    if (loopMode === "all") {
      const sourceIds = resolveMusicSourceNodes({
        edges: edgesRef.current,
        nodes: nodesRef.current,
        playerNodeId,
      }).map((source) => source.id);
      const nextSourceId = getNextMusicSourceId(
        sourceIds,
        playerNode.data.musicSourceNodeId,
      );
      if (nextSourceId) {
        selectMusicSource(playerNodeId, nextSourceId);
        toggleMusicPlayback(playerNodeId, true);
        return;
      }
    }

    setNodes((current) => current.map((node) => node.id === playerNodeId
      ? {
          ...node,
          data: {
            ...node.data,
            musicCurrentTime: audio?.currentTime ?? node.data.musicCurrentTime,
            musicIsPlaying: false,
          },
        }
      : node));
  }, [selectMusicSource, setNodes, toggleMusicPlayback]);

  useEffect(() => {
    musicEndedHandlerRef.current = handleMusicPlaybackEnded;
  }, [handleMusicPlaybackEnded]);

  const seekMusicPlayer = useCallback((playerNodeId: string, seconds: number) => {
    const audio = musicPlayersRef.current.get(playerNodeId);
    if (audio) audio.currentTime = seconds;
    setNodes((current) => current.map((node) => node.id === playerNodeId
      ? { ...node, data: { ...node.data, musicCurrentTime: seconds } }
      : node));
  }, [setNodes]);

  const ensureMusicWaveform = useCallback((playerNodeId: string) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    const sourceNode = resolveMusicSourceNode({
      edges: edgesRef.current,
      nodes: nodesRef.current,
      playerNodeId,
      sourceNodeId: playerNode?.data.musicSourceNodeId,
    });
    const taskKey = `${playerNodeId}:${sourceNode?.id ?? "missing"}`;
    const existing = musicWaveformTasksRef.current.get(taskKey);
    if (existing) return existing;

    const task = (async () => {
      if (
        playerNode?.data.musicWaveform?.length &&
        playerNode.data.musicWaveformSourceNodeId === sourceNode?.id &&
        playerNode.data.musicWaveformVersion === MUSIC_WAVEFORM_VERSION
      ) return;
      const sourceUrl =
        sourceNode?.data.kind === "music"
          ? sourceNode.data.originalUrl
          : playerNode?.data.originalUrl;
      if (!playerNode || !sourceNode || !sourceUrl) {
        throw new Error("播放器没有可生成波形的本地音乐文件");
      }

      const result = await generateLocalAudioWaveform(sourceUrl);
      setNodes((current) => current.map((node) => node.id === playerNodeId
        && resolveMusicSourceNode({
          edges: edgesRef.current,
          nodes: current,
          playerNodeId,
          sourceNodeId: node.data.musicSourceNodeId,
        })?.id === sourceNode.id
        ? {
            ...node,
            data: {
              ...node.data,
              musicDuration: result.duration || node.data.musicDuration,
              musicWaveform: result.waveform,
              musicWaveformSourceNodeId: sourceNode.id,
              musicWaveformVersion: MUSIC_WAVEFORM_VERSION,
            },
          }
        : node));
    })().finally(() => {
      musicWaveformTasksRef.current.delete(taskKey);
    });
    musicWaveformTasksRef.current.set(taskKey, task);
    return task;
  }, [setNodes]);

  const fetchLyrics = useCallback(async (
    childNodeId: string,
    playerNodeId: string,
  ) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    const sourceNode = resolveMusicSourceNode({
      edges: edgesRef.current,
      nodes: nodesRef.current,
      playerNodeId,
      sourceNodeId: playerNode?.data.musicSourceNodeId,
    });
    const fileId = sourceNode?.data.fileId;
    if (!playerNode || !sourceNode || !fileId) {
      setNodes((current) => current.map((node) => node.id === childNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              musicError: "播放器没有可获取歌词的上游音乐文件",
              lyricsFetchStatus: "failed" as const,
              musicLyrics: [],
              musicLyricsSourceNodeId: sourceNode?.id,
            },
          }
        : node));
      return;
    }
    try {
      const startedAt = Date.now();
      setNodes((current) => current.map((node) => node.id === childNodeId
        ? {
            ...node,
            data: {
              ...node.data,
              lyricsFetchStatus: "fetching" as const,
              lyricsWarnings: undefined,
              musicError: undefined,
              musicLyrics: [],
              musicLyricsSourceNodeId: sourceNode.id,
            },
          }
        : node));
      const response = await fetch("/api/music/lyrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, fileId }),
      });
      const result = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(getMusicApiErrorMessage(result));
      const warnings = Array.isArray(result?.warnings)
        ? result.warnings.filter((warning): warning is string => typeof warning === "string")
        : [];
      setNodes((current) => {
        const currentPlayer = current.find((node) => node.id === playerNodeId);
        const currentSource = resolveMusicSourceNode({
          edges: edgesRef.current,
          nodes: current,
          playerNodeId,
          sourceNodeId: currentPlayer?.data.musicSourceNodeId,
        });
        if (currentSource?.id !== sourceNode.id) return current;
        return current.map((node) => node.id === childNodeId ? {
            ...node,
            data: {
              ...node.data,
              musicError: undefined,
              lyricsFetchDurationMs: Date.now() - startedAt,
              lyricsFetchStatus: "succeeded" as const,
              musicLyrics: extractMusicLyrics(result ?? undefined),
              musicLyricsSourceNodeId: sourceNode.id,
              lyricsWarnings: warnings,
            },
          }
        : node);
      });
    } catch (error) {
      setNodes((current) => {
        const currentPlayer = current.find((node) => node.id === playerNodeId);
        const currentSource = resolveMusicSourceNode({
          edges: edgesRef.current,
          nodes: current,
          playerNodeId,
          sourceNodeId: currentPlayer?.data.musicSourceNodeId,
        });
        if (currentSource?.id !== sourceNode.id) return current;
        return current.map((node) => node.id === childNodeId
          ? { ...node, data: { ...node.data, musicError: error instanceof Error ? error.message : "歌词获取失败", lyricsFetchStatus: "failed" as const } }
          : node);
      });
    }
  }, [projectId, setNodes]);

  useEffect(() => {
    const refreshes = findLyricsNodesNeedingRefresh({ edges, nodes });
    for (const refresh of refreshes) {
      const refreshKey = `${refresh.childNodeId}:${refresh.sourceNodeId}`;
      if (refreshingLyricsKeysRef.current.has(refreshKey)) continue;
      refreshingLyricsKeysRef.current.add(refreshKey);
      void fetchLyrics(refresh.childNodeId, refresh.playerNodeId).finally(() => {
        refreshingLyricsKeysRef.current.delete(refreshKey);
      });
    }
  }, [edges, fetchLyrics, nodes]);

  const musicLyricsOverlayPlayer = musicLyricsOverlay
    ? nodes.find((node) => node.id === musicLyricsOverlay.playerNodeId)
    : undefined;
  const musicLyricsOverlaySource = musicLyricsOverlayPlayer?.data.kind === "musicPlayer"
    ? resolveMusicSourceNode({
        edges,
        nodes,
        playerNodeId: musicLyricsOverlayPlayer.id,
        sourceNodeId: musicLyricsOverlayPlayer.data.musicSourceNodeId,
      })
    : undefined;
  const linkedMusicLyricsNode = musicLyricsOverlayPlayer
    ? edges.flatMap((edge) => {
        if (edge.source !== musicLyricsOverlayPlayer.id) return [];
        const target = nodes.find((node) => node.id === edge.target);
        return target?.data.kind === "lyrics" ? [target] : [];
      })[0]
    : undefined;
  const musicLyricsOverlayPlayerId = musicLyricsOverlay?.playerNodeId;
  const musicLyricsOverlayPlayerExists =
    musicLyricsOverlayPlayer?.data.kind === "musicPlayer";
  const musicLyricsOverlaySourceId = musicLyricsOverlaySource?.id;
  const musicLyricsOverlaySourceFileId = musicLyricsOverlaySource?.data.fileId;
  const linkedMusicLyricsSourceId = linkedMusicLyricsNode?.data.musicLyricsSourceNodeId;
  const linkedMusicLyricsLines = linkedMusicLyricsNode?.data.musicLyrics;
  const linkedMusicLyricsStatus = linkedMusicLyricsNode?.data.lyricsFetchStatus;
  const linkedMusicLyricsError = linkedMusicLyricsNode?.data.musicError;

  useEffect(() => {
    if (!musicLyricsOverlayPlayerId) return;
    if (!musicLyricsOverlayPlayerExists) {
      setMusicLyricsOverlay(undefined);
      return;
    }
    if (!musicLyricsOverlaySourceId || !musicLyricsOverlaySourceFileId) {
      setMusicLyricsOverlayContent({
        error: "当前播放器没有可获取歌词的音乐文件",
        lines: [],
        status: "failed",
      });
      return;
    }

    const sourceNodeId = musicLyricsOverlaySourceId;
    if (linkedMusicLyricsNode) {
      if (linkedMusicLyricsSourceId !== sourceNodeId) {
        setMusicLyricsOverlayContent({ lines: [], sourceNodeId, status: "loading" });
        return;
      }
      setMusicLyricsOverlayContent({
        error: linkedMusicLyricsError,
        lines: linkedMusicLyricsLines ?? [],
        sourceNodeId,
        status:
          linkedMusicLyricsStatus === "fetching"
            ? "loading"
            : linkedMusicLyricsStatus ?? "idle",
      });
      return;
    }

    const controller = new AbortController();
    setMusicLyricsOverlayContent({ lines: [], sourceNodeId, status: "loading" });
    void (async () => {
      try {
        const response = await fetch("/api/music/lyrics", {
          body: JSON.stringify({
            fileId: musicLyricsOverlaySourceFileId,
            projectId,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const result = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok) throw new Error(getMusicApiErrorMessage(result));
        setMusicLyricsOverlayContent({
          lines: extractMusicLyrics(result ?? undefined),
          sourceNodeId,
          status: "succeeded",
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setMusicLyricsOverlayContent({
          error: error instanceof Error ? error.message : "歌词获取失败",
          lines: [],
          sourceNodeId,
          status: "failed",
        });
      }
    })();
    return () => controller.abort();
  }, [
    linkedMusicLyricsError,
    linkedMusicLyricsLines,
    linkedMusicLyricsNode,
    linkedMusicLyricsSourceId,
    linkedMusicLyricsStatus,
    musicLyricsOverlayPlayerExists,
    musicLyricsOverlayPlayerId,
    musicLyricsOverlaySourceFileId,
    musicLyricsOverlaySourceId,
    projectId,
  ]);

  const createMusicChild = useCallback((
    playerNodeId: string,
    _kind: MusicChildNodeKind,
    position?: { x: number; y: number },
  ) => {
    const playerNode = nodesRef.current.find((node) => node.id === playerNodeId);
    if (!playerNode || playerNode.data.kind !== "musicPlayer") return;
    const update = createLyricsNodeUpdate({
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
    focusCanvasNode(update.focusNodeId, { preserveZoom: true });
  }, [appendCanvasItems, focusCanvasNode, projectId]);

  const locateMusicPlayer = useCallback((_musicNodeId: string, playerNodeId: string) => {
    focusCanvasNode(playerNodeId);
  }, [focusCanvasNode]);

  const toggleMusicLyricsOverlay = useCallback((playerNodeId: string) => {
    setMusicLyricsOverlay((current) => {
      if (current?.playerNodeId === playerNodeId) return undefined;
      const canvasWidth = canvasViewportRef.current?.clientWidth ?? 960;
      const canvasHeight = canvasViewportRef.current?.clientHeight ?? 640;
      const overlayWidth = Math.min(680, Math.max(0, canvasWidth - 32));
      return {
        playerNodeId,
        position: {
          x: Math.max(16, (canvasWidth - overlayWidth) / 2),
          y: Math.max(16, canvasHeight * 0.12),
        },
      };
    });
    setMusicLyricsOverlayContent({ lines: [], status: "idle" });
  }, []);

  const locateTaskNode = useCallback((nodeId: string) => {
    focusCanvasNode(nodeId);
  }, [focusCanvasNode]);

  const renderedNodes = useMemo(
    () =>
      getRenderedCanvasNodes({
        createNoteNode,
        edges,
        musicLyricsOverlayPlayerNodeId: musicLyricsOverlay?.playerNodeId,
        nodes,
        onCreateMusicChildNode: createMusicChild,
        onCreateMusicPlayerNode: createMusicPlayer,
        onEnsureMusicPlayback: ensureMusicPlayback,
        onEnsureMusicWaveform: ensureMusicWaveform,
        onLocateMusicPlayerNode: locateMusicPlayer,
        onSeekMusicPlayer: seekMusicPlayer,
        onSelectMusicSource: selectMusicSource,
        onToggleMusicLyricsOverlay: toggleMusicLyricsOverlay,
        onToggleMusicPlayback: toggleMusicPlayback,
        onUpdateMusicNode: updateMusicNode,
        onUpdateMusicPlayback: updateMusicPlayback,
        onResolveImageDimensions: resolveImageNodeDimensions,
        onCreateDerivedImageNode: createDerivedImageNode,
        onCreateTextChildNode: createTextChildNode,
        onSubmitImageNode: submitImageGenerationNode,
        onSubmitVideoNode: submitVideoGenerationNode,
        onSubmitTextGenerationNode: submitTextGenerationNode,
        onUpdateImageNode: updateImageGenerationNode,
        onUpdateVideoNode: updateVideoNode,
        onUpdateTextGenerationNode: updateTextGenerationNode,
        onUpdateTextNode: updateTextNode,
        onUpdateTaskNode: updateTaskNode,
        onSetTaskParent: setTaskParent,
        onLocateTaskNode: locateTaskNode,
        onToggleTaskChildren: toggleTaskChildren,
        onToggleAiResponseExpanded: toggleAiResponseExpanded,
        onToggleTextExpanded: toggleTextExpanded,
        onToggleImagePromptExpanded: toggleImagePromptExpanded,
        onToggleMusicChildExpanded: toggleMusicChildExpanded,
        onUpdateProjectTag: updateProjectTag,
        projectId,
        toggleReaderCollapse,
      }),
    [
      createNoteNode,
      createMusicChild,
      createMusicPlayer,
      createDerivedImageNode,
      ensureMusicPlayback,
      ensureMusicWaveform,
      createTextChildNode,
      edges,
      nodes,
      locateMusicPlayer,
      musicLyricsOverlay?.playerNodeId,
      seekMusicPlayer,
      selectMusicSource,
      toggleMusicLyricsOverlay,
      toggleMusicPlayback,
      updateMusicNode,
      updateMusicPlayback,
      projectId,
      resolveImageNodeDimensions,
      submitImageGenerationNode,
      submitVideoGenerationNode,
      submitTextGenerationNode,
      toggleReaderCollapse,
      updateImageGenerationNode,
      updateVideoNode,
      updateTextGenerationNode,
      updateTextNode,
      updateTaskNode,
      setTaskParent,
      locateTaskNode,
      toggleTaskChildren,
      toggleAiResponseExpanded,
      toggleTextExpanded,
      toggleImagePromptExpanded,
      toggleMusicChildExpanded,
      updateProjectTag,
    ],
  );

  const displayedNodes = useMemo(
    () => [
      ...altDragPreviewNodes,
      ...renderedNodes.map((node) => {
        const stableNode = removeAltDragPreviewClasses(node);
        return altDragMovingNodeIds.has(node.id)
          ? {
              ...stableNode,
              className: [stableNode.className, "zenme-alt-drag-copy-preview"]
                .filter(Boolean)
                .join(" "),
            }
          : stableNode;
      }),
    ],
    [altDragMovingNodeIds, altDragPreviewNodes, renderedNodes],
  );

  if (!canvasHydrated) {
    if (canvasLoadError) {
      return (
        <div
          className="flex h-full flex-col items-center justify-center gap-3 bg-white px-6 text-center"
          role="alert"
        >
          <div className="text-sm font-medium text-zinc-800">画布加载失败</div>
          <div className="max-w-md text-xs leading-5 text-zinc-500">
            {canvasLoadError}
          </div>
          <button
            className="mt-1 inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 active:bg-zinc-100"
            onClick={() => setCanvasLoadAttempt((attempt) => attempt + 1)}
            type="button"
          >
            <RefreshCw className="size-4" aria-hidden />
            重新加载
          </button>
        </div>
      );
    }

    return (
      <div
        aria-live="polite"
        className="flex h-full items-center justify-center bg-white text-sm text-zinc-500"
        role="status"
      >
        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
        正在加载画布...
      </div>
    );
  }

  return (
    <div className={`zenme-canvas-shell h-full overflow-hidden bg-white text-zinc-950 ${isNodeDragging ? "zenme-canvas-node-dragging" : ""}`}>
      <main
        className="relative h-full w-full"
        onAuxClickCapture={(event) => {
          if (shouldPreventNativeCanvasAuxClick(event.nativeEvent)) {
            event.preventDefault();
          }
        }}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDownCapture={(event) => {
          if (shouldPreventNativeCanvasAuxClick(event.nativeEvent)) {
            event.preventDefault();
          }
        }}
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
          nodes={displayedNodes}
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
          multiSelectionKeyCode="Shift"
          onNodeClick={(_event, node) => bringNodeToFront(node.id)}
          onNodeDrag={(_event, node) => moveGroupedNodesWithFrame(node)}
          onNodeDragStart={(event, node) =>
            handleCanvasNodeDragStart(node, event.altKey)
          }
          onNodeDragStop={(_event, node) => handleCanvasNodeDragStop(node)}
          onNodesChange={handleNodesChange}
          onPaneClick={() => {
            setNodeActionMenu(null);
            setCanvasAddMenu(null);
          }}
          panOnDrag={[1]}
          panOnScroll={false}
          proOptions={{ hideAttribution: true }}
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
            color="var(--color-canvas-grid)"
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
              bgColor="var(--color-surface-container-lowest)"
              className={MINI_MAP_CLASS}
              maskColor="var(--color-canvas-minimap-mask)"
              maskStrokeColor="var(--color-border-strong)"
              maskStrokeWidth={1}
              nodeBorderRadius={4}
              nodeColor="var(--color-surface-container-high)"
              nodeStrokeColor="var(--color-text-tertiary)"
              nodeStrokeWidth={1}
              pannable
              zoomable
            />
          ) : null}
        </ReactFlow>

        {musicLyricsOverlay ? (
          <MusicLyricsOverlay
            currentTime={musicLyricsOverlayPlayer?.data.musicCurrentTime ?? 0}
            error={musicLyricsOverlayContent.error}
            lines={musicLyricsOverlayContent.lines}
            onClose={() => setMusicLyricsOverlay(undefined)}
            onMove={(position) => setMusicLyricsOverlay((current) => current
              ? { ...current, position }
              : current)}
            position={musicLyricsOverlay.position}
            songTitle={musicLyricsOverlaySource?.data.title || "当前歌曲歌词"}
            status={musicLyricsOverlayContent.status}
          />
        ) : null}

        {selectionToolbarPosition && !isNodeDragging ? (
          <CanvasSelectionToolbar
            left={selectionToolbarPosition.left}
            onGroupSelectedNodes={groupSelectedNodes}
            top={selectionToolbarPosition.top}
          />
        ) : null}

        <CanvasSideToolbar
          onArrange={quickArrangeCanvas}
          onOpenAgent={() => setIsAgentOpen(true)}
          onSave={() => void saveCanvas({ includeThumbnail: true })}
          onToggleSearch={toggleCanvasSearch}
          searchOpen={isCanvasSearchOpen}
        />

        {isCanvasSearchOpen ? (
          <CanvasTextSearchPanel
            onClose={closeCanvasSearch}
            onFocusNode={(nodeId) => focusCanvasNode(nodeId, { preserveZoom: true })}
            onQueryChange={setCanvasSearchQuery}
            query={canvasSearchQuery}
            results={canvasSearchResults}
          />
        ) : null}

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
            onCreateVideoGenerationNode={createVideoGenerationNodeAt}
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

function getProviderId(modelId: string) {
  return parseProviderModelReference(modelId)?.providerId ?? "chatgpt";
}
