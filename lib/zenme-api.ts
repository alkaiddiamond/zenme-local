"use client";

import type { ImageCameraControl } from "@/components/zenme/image-edit-options";
import type { AppShellState } from "@/lib/local/app-shell-state";
import type {
  Execution,
  ExecutionError,
  ExecutionInputSnapshot,
  ExecutionKind,
  ExecutionStatus,
} from "@/lib/execution/types";
import type { CanvasSnapshotPayload, ZenmeProject } from "@/lib/zenme";
import type { WorkspaceBinding } from "@/lib/workspace/types";
import type {
  WorkspaceFileDocumentView,
  WorkspaceFileEntry,
} from "@/lib/workspace/file-document-types";
import type { WorkspaceChangeSet } from "@/lib/workspace/change-set-types";
import type {
  AgentExecutionDetail,
} from "@/lib/agent/types";
import type { AgentContextSnapshot } from "@/lib/agent/context-model";
import type {
  GlobalOrchestration,
} from "@/lib/global-agent/types";
import type { ContinuousGlobalAgentState } from "@/lib/global-agent/continuous-types";
import type {
  ProjectMemory,
  ProjectMemoryContextItem,
  ProjectMemoryKind,
  ProjectMemorySource,
} from "@/lib/memory/types";
import type { KnowledgeSearchResponse } from "@/lib/knowledge/types";
import type { ProjectAgentSession } from "@/lib/agent/project-session-types";
import type { ZenmeModelSpeed, ZenmeReasoningEffort, ZenmeSessionPermissionMode } from "@/lib/local/settings";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

export async function listProjectsFromApi() {
  const projects = await readJson<ZenmeProject[]>(await fetch("/api/projects", {
    cache: "no-store",
  }));

  return projects.map(withProjectThumbnailUrl);
}

export async function createProjectInApi(input: {
  initialCanvas?: CanvasSnapshotPayload;
  name: string;
  prompt: string;
  model: string;
}) {
  return readJson<ZenmeProject>(await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function getProjectFromApi(projectId: string) {
  const project = await readJson<ZenmeProject>(await fetch(`/api/projects/${projectId}`, {
    cache: "no-store",
  }));
  return withProjectThumbnailUrl(project);
}

export async function updateProjectNameInApi(input: {
  name: string;
  projectId: string;
}) {
  return readJson<ZenmeProject>(await fetch(`/api/projects/${input.projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: input.name }),
  }));
}

export async function deleteProjectInApi(projectId: string) {
  return readJson<{ ok: true }>(await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
  }));
}

export async function getAppShellStateFromApi() {
  const payload = await readJson<{ state: AppShellState }>(
    await fetch("/api/app-shell-state", { cache: "no-store" }),
  );
  return payload.state;
}

export async function updateAppShellStateInApi(
  updates: Partial<Omit<AppShellState, "version">>,
) {
  const payload = await readJson<{ state: AppShellState }>(
    await fetch("/api/app-shell-state", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(updates),
      keepalive: true,
    }),
  );
  return payload.state;
}

export async function getCanvasSnapshotFromApi(projectId: string) {
  return readJson<{ snapshot: CanvasSnapshotPayload; updated_at: string } | null>(
    await fetch(`/api/projects/${projectId}/canvas`, {
      cache: "no-store",
    }),
  );
}

export async function saveCanvasSnapshotToApi(input: {
  projectId: string;
  snapshot: CanvasSnapshotPayload;
  thumbnail?: Blob | null;
}) {
  const formData = new FormData();
  formData.set("snapshot", JSON.stringify(input.snapshot));
  if (input.thumbnail) {
    formData.set("thumbnail", input.thumbnail, "thumbnail.webp");
  }

  await readJson<{ ok: true }>(await fetch(`/api/projects/${input.projectId}/canvas`, {
    method: "PUT",
    body: formData,
  }));
}

export async function saveProjectThumbnailToApi(input: {
  projectId: string;
  thumbnail: Blob;
}) {
  await readJson<{ ok: true }>(
    await fetch(`/api/projects/${input.projectId}/thumbnail`, {
      method: "PUT",
      headers: { "content-type": "image/webp" },
      body: input.thumbnail,
    }),
  );
}

export async function uploadProjectFileToApi(input: {
  projectId: string;
  file: File;
  preview?: Blob;
}) {
  const formData = new FormData();
  formData.set("file", input.file, input.file.name);
  if (input.preview) {
    formData.set("preview", input.preview, "preview.webp");
  }

  return readJson<{
    fileId: string;
    originalPath: string;
    previewPath: string | null;
    originalUrl: string;
    previewUrl?: string;
  }>(await fetch(`/api/projects/${input.projectId}/files`, {
    method: "POST",
    body: formData,
  }));
}

export async function refreshFileSignedUrlsFromApi(_fileId: string) {
  void _fileId;
  return null;
}

export async function generateOrEditImage(input: {
  aspectRatio?: string;
  cameraControl?: ImageCameraControl;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  model: string;
  operation?: "edit" | "generate";
  prompt: string;
  quality?: string;
  signal?: AbortSignal;
}) {
  const { signal, ...body } = input;
  return readJson<{
    b64Json: string;
    mediaType: string;
    model: string;
    revisedPrompt?: string;
    usage?: unknown;
  }>(await fetch("/api/ai/image-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }));
}

export type VideoTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export async function createVideoTask(input: {
  duration: number;
  generateAudio: boolean;
  imageDataUrls?: string[];
  imageRoles?: Array<"first_frame" | "last_frame" | "reference_image">;
  model: string;
  prompt: string;
  ratio: string;
  resolution: string;
  signal?: AbortSignal;
}) {
  const { signal, ...body } = input;
  const response = await fetch("/api/ai/video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "视频生成失败");
  }
  return readJson<{
    model: string;
    status: VideoTaskStatus;
    taskId: string;
  }>(response);
}

export async function getProjectAgentSessionFromApi(projectId: string) {
  return readJson<ProjectAgentSession>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-session`,
    { cache: "no-store" },
  ));
}

export type ProjectAgentTurnApiResult = {
  answer?: string;
  commandRequestId?: string;
  executionId?: string;
  options?: Array<{ label: string; description?: string }>;
  question?: string;
  questions?: Array<{ question: string; header: string; options: Array<{ label: string; description?: string; preview?: string }>; multiSelect?: boolean }>;
  status: "completed" | "waitingApproval" | "waitingInput";
  turnId: string;
};

export async function runProjectAgentTurnFromApi(input: {
  contextSnapshot?: AgentContextSnapshot;
  canvasContext?: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  parentConversationIds?: string[];
  fileDocumentIds?: string[];
  imageDataUrls?: string[];
  model: string;
  projectId: string;
  prompt: string;
  parentTurnId?: string;
  resultNodeId?: string;
  selectedNodeIds?: string[];
  signal?: AbortSignal;
  sourceNodeId?: string;
  turnId?: string;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  permissionMode?: ZenmeSessionPermissionMode;
  resume?: boolean;
  questionAnswer?: {
    eventId: string;
    value?: string;
    answers?: Record<string, string>;
    annotations?: Record<string, { notes?: string; preview?: string }>;
  };
}): Promise<ProjectAgentTurnApiResult> {
  const started = await readJson<{ status: "running"; turnId: string } | ProjectAgentTurnApiResult>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/agent-session/turns`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contextSnapshot: input.contextSnapshot,
        canvasContext: input.canvasContext,
        currentNodeContext: input.currentNodeContext,
        connectedGraphContext: input.connectedGraphContext,
        conversationId: input.conversationId,
        parentConversationIds: input.parentConversationIds,
        fileDocumentIds: input.fileDocumentIds,
        imageDataUrls: input.imageDataUrls,
        model: input.model,
        prompt: input.prompt,
        parentTurnId: input.parentTurnId,
        resultNodeId: input.resultNodeId,
        selectedNodeIds: input.selectedNodeIds,
        sourceNodeId: input.sourceNodeId,
        turnId: input.turnId,
        reasoningEffort: input.reasoningEffort,
        modelSpeed: input.modelSpeed,
        permissionMode: input.permissionMode,
        resume: input.resume,
        questionAnswer: input.questionAnswer,
      }),
      signal: input.signal,
    },
  ));
  if (started.status !== "running") return started;
  while (true) {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await delayApiPoll(400, input.signal);
    const state = await readJson<(ProjectAgentTurnApiResult | { status: "running" | "failed" | "stopped"; turnId: string; error?: string })>(await fetch(
      `/api/projects/${encodeURIComponent(input.projectId)}/agent-session/turns?turnId=${encodeURIComponent(started.turnId)}`,
      { cache: "no-store", signal: input.signal },
    ));
    if (state.status === "running") continue;
    if (state.status === "failed") throw new Error(state.error || "项目 Agent Turn 执行失败");
    if (state.status === "stopped") throw new DOMException("项目 Agent Turn 已停止", "AbortError");
    return state as ProjectAgentTurnApiResult;
  }
}

export async function stopProjectAgentTurnFromApi(projectId: string, turnId: string) {
  return readJson<{ stopped: boolean; turnId: string }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-session/turns?turnId=${encodeURIComponent(turnId)}`,
    { method: "DELETE" },
  ));
}

export async function resolveProjectAgentTurnCommandApprovalFromApi(input: {
  projectId: string;
  turnId: string;
  eventId: string;
  decision: "approve" | "reject";
  scope?: "once" | "project";
}) {
  return readJson<{ status: "running"; turnId: string }>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/agent-session/turns`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        turnId: input.turnId,
        commandApproval: {
          eventId: input.eventId,
          decision: input.decision,
          scope: input.scope,
        },
      }),
    },
  ));
}

export async function steerProjectAgentTurnFromApi(input: {
  projectId: string;
  prompt: string;
  signal?: AbortSignal;
  turnId: string;
}) {
  return readJson<{ revision: number; status: "steered"; turnId: string }>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/agent-session/turns`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: input.prompt, steer: true, turnId: input.turnId }),
      signal: input.signal,
    },
  ));
}

function delayApiPoll(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function appendProjectAgentEventFromApi(input: {
  content?: string;
  data?: Record<string, unknown>;
  projectId: string;
  turnId: string;
  type: "approval" | "toolCall" | "toolResult" | "status";
}) {
  return readJson<import("@/lib/agent/project-session-types").ProjectAgentEvent>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/agent-session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "appendEvent", ...input, projectId: undefined }),
    },
  ));
}

export async function stopProjectAgentBackgroundTaskFromApi(projectId: string, taskId: string) {
  return readJson<import("@/lib/agent/types").AgentCommandRequest>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stopBackgroundTask", taskId }),
    },
  ));
}

export async function getWorkspaceBindingFromApi(projectId: string) {
  return readJson<WorkspaceBinding | null>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace`,
    { cache: "no-store" },
  ));
}

export async function unbindWorkspaceFromApi(projectId: string) {
  return readJson<{ ok: true }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace`,
    { method: "DELETE" },
  ));
}

export async function getWorkspaceFilesFromApi(projectId: string, rootId?: string) {
  return readJson<{ entries: WorkspaceFileEntry[] }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/files${rootId ? `?rootId=${encodeURIComponent(rootId)}` : ""}`,
    { cache: "no-store" },
  ));
}

export async function openWorkspaceFileFromApi(
  projectId: string,
  relativePath: string,
  rootId?: string,
) {
  return readJson<WorkspaceFileDocumentView>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/documents`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ relativePath, rootId }),
    },
  ));
}

export async function getWorkspaceFileDocumentFromApi(
  projectId: string,
  documentId: string,
) {
  return readJson<WorkspaceFileDocumentView>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/documents/${encodeURIComponent(documentId)}`,
    { cache: "no-store" },
  ));
}

export async function saveWorkspaceFileDocumentFromApi(input: {
  content: string;
  documentId: string;
  expectedHash: string;
  projectId: string;
}) {
  return readJson<WorkspaceFileDocumentView>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/workspace/documents/${encodeURIComponent(input.documentId)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: input.content, expectedHash: input.expectedHash }),
    },
  ));
}

export async function listWorkspaceChangeSetsFromApi(projectId: string) {
  return readJson<{ changeSets: WorkspaceChangeSet[] }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/change-sets`,
    { cache: "no-store" },
  ));
}

export async function createWorkspaceChangeSetFromApi(
  projectId: string,
  input: {
    description?: string;
    operations: Array<{
      fileDocumentId?: string;
      kind: "create" | "modify" | "delete" | "rename";
      proposedContent?: string | null;
      relativePath: string;
      targetRelativePath?: string;
    }>;
    source?: "user" | "agent";
    title: string;
  },
) {
  return readJson<WorkspaceChangeSet>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/change-sets`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  ));
}

export async function updateWorkspaceChangeSetFromApi(
  projectId: string,
  changeSetId: string,
  action: "approve" | "apply" | "reject" | "revert",
) {
  return readJson<WorkspaceChangeSet>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/workspace/change-sets/${encodeURIComponent(changeSetId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    },
  ));
}

export async function getAgentExecutionFromApi(projectId: string, executionId: string) {
  return readJson<AgentExecutionDetail>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/agent-executions/${encodeURIComponent(executionId)}`,
    { cache: "no-store" },
  ));
}

export async function updateAgentExecutionFromApi(input: {
  action: "stop";
  executionId: string;
  projectId: string;
}) {
  return readJson<AgentExecutionDetail | { detail: AgentExecutionDetail; execution: Execution }>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/agent-executions/${encodeURIComponent(input.executionId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  ));
}

export async function getGlobalOrchestrationFromApi(projectId: string, orchestrationId: string) {
  return readJson<GlobalOrchestration>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/global-agent/${encodeURIComponent(orchestrationId)}`,
    { cache: "no-store" },
  ));
}

export async function updateGlobalOrchestrationFromApi(input: {
  action: "stop";
  orchestrationId: string;
  projectId: string;
}) {
  return readJson<GlobalOrchestration | { orchestration: GlobalOrchestration; dispatched: GlobalOrchestration["tasks"] }>(await fetch(
    `/api/projects/${encodeURIComponent(input.projectId)}/global-agent/${encodeURIComponent(input.orchestrationId)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
  ));
}

export async function getContinuousGlobalAgentSupervisorStatesFromApi(projectIds: string[]) {
  return readJson<{ states: ContinuousGlobalAgentState[] }>(await fetch(
    "/api/global-agent/continuous-supervisor",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectIds }),
    },
  ));
}

export async function runContinuousGlobalAgentFromApi(projectId: string, signal?: AbortSignal) {
  return readJson<{ ran: boolean; runId?: string; state: ContinuousGlobalAgentState }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/global-agent/continuous`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "runOnce" }), signal },
  ));
}

export async function listProjectMemoriesFromApi(projectId: string, validate = false) {
  return readJson<{ memories: ProjectMemory[] }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/memories${validate ? "?validate=1" : ""}`,
    { cache: "no-store" },
  ));
}

export async function getConfirmedProjectMemoryContextFromApi(projectId: string) {
  return readJson<{ memories: ProjectMemoryContextItem[] }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/memories?context=1`,
    { cache: "no-store" },
  ));
}

export async function createProjectMemoryFromApi(projectId: string, input: {
  content: string;
  createdBy?: "user" | "agent";
  kind: ProjectMemoryKind;
  reason?: string;
  sources: ProjectMemorySource[];
  status?: "candidate" | "confirmed";
  title: string;
}) {
  return readJson<ProjectMemory>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/memories`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  }));
}

export async function updateProjectMemoryFromApi(projectId: string, memoryId: string, input: {
  action: "confirm" | "reject" | "revise" | "pin" | "unpin";
  content?: string;
  reason?: string;
  sources?: ProjectMemorySource[];
  title?: string;
}) {
  return readJson<ProjectMemory>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
  ));
}

export async function deleteProjectMemoryFromApi(projectId: string, memoryId: string) {
  return readJson<{ ok: true }>(await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`,
    { method: "DELETE" },
  ));
}

export type ProjectKnowledgeStatus = {
  version: number;
  projectId: string;
  status: "missing" | "ready" | "paused" | "error";
  diskBytes: number;
  entities: number;
  edges: number;
  chunks: number;
  ignoredSensitiveFiles: number;
  reusedChunks?: number;
  updatedAt: string | null;
  embeddingProvider: { id: string; kind: "local" | "cloud"; dimension: number; disclosure?: string; authorizedAt?: string } | null;
  embeddingOptions: Array<{ id: string; kind: "local" | "cloud"; label: string; disclosure: string }>;
};

export async function getProjectKnowledgeStatusFromApi(projectId: string) {
  return readJson<ProjectKnowledgeStatus>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/knowledge`, { cache: "no-store" }));
}

export async function updateProjectKnowledgeFromApi(
  projectId: string,
  action: "rebuild" | "pause" | "resume" | "clear",
  options: { cloudAuthorized?: boolean; embeddingModel?: string; force?: boolean } = {},
) {
  return readJson<ProjectKnowledgeStatus | { ok: true }>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/knowledge`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...options }),
  }));
}

export async function searchProjectKnowledgeFromApi(projectId: string, query: string, options?: { budgetCharacters?: number; limit?: number }) {
  const params = new URLSearchParams({ query });
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.budgetCharacters) params.set("budgetCharacters", String(options.budgetCharacters));
  return readJson<KnowledgeSearchResponse>(await fetch(`/api/projects/${encodeURIComponent(projectId)}/knowledge?${params}`, { cache: "no-store" }));
}

export async function referenceProjectFileInApi(input: {
  externalPath: string;
  fileName: string;
  mimeType?: string;
  projectId: string;
}) {
  return readJson<{
    externalPath: string | null;
    fileId: string;
    originalPath: string;
    originalUrl: string;
    previewPath: string | null;
    previewUrl?: string;
  }>(await fetch(`/api/projects/${input.projectId}/files`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      externalPath: input.externalPath,
      fileName: input.fileName,
      mimeType: input.mimeType,
    }),
  }));
}

export async function createExecutionInApi(input: {
  attemptId?: string;
  executionId?: string;
  kind: ExecutionKind;
  input?: ExecutionInputSnapshot;
  modelId?: string;
  nodeId: string;
  nodeRunId?: string;
  projectId: string;
  providerId?: string;
  startedAt?: string;
  triggerNodeId: string;
}) {
  return readJson<Execution>(await fetch(`/api/projects/${input.projectId}/executions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function listRecoverableExecutionsFromApi(projectId: string) {
  return readJson<Execution[]>(await fetch(
    `/api/projects/${projectId}/executions?recoverable=1`,
    { cache: "no-store" },
  ));
}

export async function listExecutionsFromApi(projectId: string) {
  return readJson<Execution[]>(await fetch(
    `/api/projects/${projectId}/executions`,
    { cache: "no-store" },
  ));
}

export async function updateExecutionAttemptInApi(input: {
  assetFileIds?: string[];
  attemptId: string;
  error?: ExecutionError | null;
  executionId: string;
  externalTaskId?: string;
  outputText?: string;
  nodeRunId: string;
  projectId: string;
  status: ExecutionStatus;
}) {
  return readJson<Execution>(await fetch(
    `/api/projects/${input.projectId}/executions/${input.executionId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, action: "updateAttempt" }),
    },
  ));
}

export async function retryNodeRunInApi(input: {
  executionId: string;
  modelId?: string;
  nodeRunId: string;
  projectId: string;
  providerId?: string;
}) {
  return readJson<{ attempt: Execution["nodeRuns"][number]["attempts"][number]; execution: Execution }>(
    await fetch(`/api/projects/${input.projectId}/executions/${input.executionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, action: "retry" }),
    }),
  );
}

export async function stopExecutionInApi(input: {
  executionId: string;
  projectId: string;
}) {
  return readJson<Execution>(await fetch(
    `/api/projects/${input.projectId}/executions/${input.executionId}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    },
  ));
}

export async function getVideoTaskStatus(input: { model: string; signal?: AbortSignal; taskId: string }) {
  const params = new URLSearchParams({ model: input.model, taskId: input.taskId });
  return readJson<{
    error?: string;
    status: VideoTaskStatus;
    taskId: string;
  }>(await fetch(`/api/ai/video?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  }));
}

export async function downloadVideoTask(input: {
  model: string;
  projectId: string;
  signal?: AbortSignal;
  taskId: string;
}) {
  const params = new URLSearchParams({
    download: "1",
    model: input.model,
    projectId: input.projectId,
    taskId: input.taskId,
  });
  const response = await fetch(`/api/ai/video?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "生成视频下载失败");
  }
  return readJson<{
    fileId: string;
    model: string;
    originalUrl: string;
    taskId: string;
  }>(response);
}

function withProjectThumbnailUrl(project: ZenmeProject): ZenmeProject {
  if (!project.thumbnailPath) {
    return project;
  }

  return {
    ...project,
    thumbnail: `/api/projects/${project.id}/thumbnail?v=${encodeURIComponent(
      project.updatedAt,
    )}`,
  };
}
