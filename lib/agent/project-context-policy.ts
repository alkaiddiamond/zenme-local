import type {
  ProjectAgentCompactionPlan,
  ProjectAgentEvent,
  ProjectAgentSession,
} from "@/lib/agent/project-session-types";
import { projectConversationEvents, projectUnscopedConversationEvents } from "@/lib/agent/project-agent-transcript";

export const PROJECT_AGENT_COMPACT_PRESERVE = {
  minTokens: 10_000,
  minTextMessages: 5,
  maxTokens: 40_000,
} as const;

export const PROJECT_AGENT_TOOL_RESULT_CLEARED = "[Old tool result content cleared]";

// Match cc-haha's microcompact boundary: only discard bulky, reproducible
// observation results. Approval, task, memory, browser and MCP results carry
// durable state and must remain intact even when they are old.
const PROJECT_AGENT_MICROCOMPACT_TOOLS = new Set([
  "read_file",
  "shell_command",
  "search_files",
  "glob_files",
  "web_search",
  "web_fetch",
  "edit_file",
  "write_file",
  "apply_patch",
  "notebook_edit",
]);

export const PROJECT_AGENT_MICROCOMPACT_MIN_SAVED_TOKENS = 4_000;

export function estimateProjectAgentTextTokens(value: string) {
  return Math.ceil(value.length / 3);
}

export function estimateProjectAgentEventTokens(event: ProjectAgentEvent) {
  return estimateProjectAgentTextTokens(
    `${event.content ?? ""}${event.data ? safeStringify(event.data) : ""}`,
  );
}

export function planProjectAgentCompaction(
  session: ProjectAgentSession,
  config: {
    minTokens?: number;
    minTextMessages?: number;
    maxTokens?: number;
  } = {},
): ProjectAgentCompactionPlan | null {
  const activeEvents = projectUnscopedConversationEvents(session.events).filter(
    (event) => event.sequence > session.context.compactedThroughSequence && event.type !== "compact",
  );
  return planAgentCompaction(activeEvents, session.context.activeSummary, config);
}

export function planProjectAgentConversationCompaction(
  session: ProjectAgentSession,
  conversationId: string,
  config: {
    minTokens?: number;
    minTextMessages?: number;
    maxTokens?: number;
  } = {},
): ProjectAgentCompactionPlan | null {
  const conversation = session.conversations?.find((candidate) => candidate.id === conversationId);
  if (!conversation) return null;
  const activeEvents = projectConversationEvents(session.events, conversationId, {
    compactedThroughSequence: conversation.compactedThroughSequence,
  }).filter((event) => event.type !== "compact");
  return planAgentCompaction(activeEvents, conversation.summary ?? "", config);
}

function planAgentCompaction(
  activeEvents: ProjectAgentEvent[],
  previousSummary: string,
  config: {
    minTokens?: number;
    minTextMessages?: number;
    maxTokens?: number;
  },
): ProjectAgentCompactionPlan | null {
  const minTokens = positiveInteger(config.minTokens, PROJECT_AGENT_COMPACT_PRESERVE.minTokens);
  const minTextMessages = positiveInteger(config.minTextMessages, PROJECT_AGENT_COMPACT_PRESERVE.minTextMessages);
  const maxTokens = positiveInteger(config.maxTokens, PROJECT_AGENT_COMPACT_PRESERVE.maxTokens);
  if (activeEvents.length < 2) return null;

  const groups = groupEventsByTurn(activeEvents);
  const protectedTurnIds = findProtectedTurnIds(activeEvents);
  let keepGroupIndex = groups.length;
  let retainedTokenEstimate = 0;
  let retainedTextMessages = 0;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]!;
    retainedTokenEstimate += group.reduce((total, event) => total + estimateProjectAgentEventTokens(event), 0);
    retainedTextMessages += group.filter(isTextMessage).length;
    keepGroupIndex = index;
    const hasProtectedEarlierGroup = groups.slice(0, index).some((candidate) =>
      candidate.some((event) => protectedTurnIds.has(event.turnId)),
    );
    if (
      !hasProtectedEarlierGroup &&
      (retainedTokenEstimate >= maxTokens ||
        (retainedTokenEstimate >= minTokens && retainedTextMessages >= minTextMessages))
    ) break;
  }

  const eventsToKeep = groups.slice(keepGroupIndex).flat();
  const keepIds = new Set(eventsToKeep.map((event) => event.id));
  const eventsToSummarize = activeEvents.filter((event) => !keepIds.has(event.id));
  if (eventsToSummarize.length === 0 || eventsToKeep.length === 0) return null;

  const compactedThroughSequence = eventsToSummarize.at(-1)!.sequence;
  if (eventsToKeep.some((event) => event.sequence <= compactedThroughSequence)) return null;

  return {
    previousSummary,
    eventsToSummarize,
    eventsToKeep,
    compactedThroughSequence,
    sourceTokenEstimate: eventsToSummarize.reduce(
      (total, event) => total + estimateProjectAgentEventTokens(event),
      estimateProjectAgentTextTokens(previousSummary),
    ),
    retainedTokenEstimate: eventsToKeep.reduce(
      (total, event) => total + estimateProjectAgentEventTokens(event),
      0,
    ),
  };
}

export function thinProjectAgentToolResults(
  events: ProjectAgentEvent[],
  options: {
    keepRecent?: number;
    clearedEventIds?: readonly string[];
    minSavedTokens?: number;
    protectLatestUserTurn?: boolean;
  } = {},
) {
  const keepRecent = Math.max(1, positiveInteger(options.keepRecent, 5));
  const minSavedTokens = nonNegativeInteger(
    options.minSavedTokens,
    PROJECT_AGENT_MICROCOMPACT_MIN_SAVED_TOKENS,
  );
  const protectedTurnIds = findProtectedTurnIds(events, {
    protectLatestUserTurn: options.protectLatestUserTurn ?? true,
  });
  const previouslyClearedIds = new Set(options.clearedEventIds ?? []);
  const toolResults = events.filter(isMicrocompactableToolResult);
  const retainedResultIds = new Set(toolResults.slice(-keepRecent).map((event) => event.id));
  const newCandidates = toolResults.filter((event) =>
    !previouslyClearedIds.has(event.id) &&
    !retainedResultIds.has(event.id) && !protectedTurnIds.has(event.turnId),
  );
  const newEstimatedTokensSaved = newCandidates.reduce(
    (total, event) => total + estimateToolResultTokensSaved(event),
    0,
  );
  const newlyClearedEventIds = newEstimatedTokensSaved >= minSavedTokens
    ? newCandidates.map((event) => event.id)
    : [];
  const candidateIds = new Set([...previouslyClearedIds, ...newlyClearedEventIds]);
  if (candidateIds.size === 0) return {
    events,
    clearedEventIds: [],
    newlyClearedEventIds: [],
    estimatedTokensSaved: 0,
    newlyEstimatedTokensSaved: 0,
  };
  const clearedEventIds: string[] = [];
  let estimatedTokensSaved = 0;
  const compactedToolCallIds = new Set<string>();
  const projectedResults = events.map((event) => {
    if (!candidateIds.has(event.id)) return event;
    clearedEventIds.push(event.id);
    estimatedTokensSaved += estimateToolResultTokensSaved(event);
    if (typeof event.data?.toolCallEventId === "string") {
      compactedToolCallIds.add(event.data.toolCallEventId);
    }
    return {
      ...event,
      content: PROJECT_AGENT_TOOL_RESULT_CLEARED,
      data: compactToolResultData(event.data),
    };
  });
  const projectedEvents = projectedResults.map((event) =>
    event.type === "toolCall" && compactedToolCallIds.has(event.id)
      ? { ...event, data: compactToolCallData(event.data) }
      : event,
  );
  return {
    events: projectedEvents,
    clearedEventIds,
    newlyClearedEventIds,
    estimatedTokensSaved,
    newlyEstimatedTokensSaved: newlyClearedEventIds.length ? newEstimatedTokensSaved : 0,
  };
}

/**
 * Keep the durable event log rich enough for UI/recovery while giving the
 * model the same compact Shell result contract used by cc-haha. In
 * particular, a background process is a Shell process, not a shared project
 * task; exposing the full persisted command record encourages the model to
 * confuse task_list with process lifecycle management.
 */

export function normalizeProjectAgentToolName(value: unknown): string {
  if (value === "run_command") return "shell_command";
  if (value === "project_task_list") return "task_list";
  return typeof value === "string" ? value : "";
}

export function isProjectAgentShellCommandTool(value: unknown): boolean {
  return normalizeProjectAgentToolName(value) === "shell_command";
}

export function projectAgentToolCallForModel(name: unknown, argumentsValue: unknown) {
  const rawName = typeof name === "string" ? name : "";
  if (isLegacyModelHiddenToolName(rawName)) return null;
  const normalizedName = normalizeProjectAgentToolName(rawName);
  if (!normalizedName) return null;
  return {
    name: normalizedName,
    arguments: normalizeLegacyToolArguments(normalizedName, argumentsValue),
  };
}

export function projectProjectAgentToolResultsForModel(events: ProjectAgentEvent[]) {
  const legacyShellTaskListResultIds = new Set<string>();
  const legacyShellTaskListCallIds = new Set<string>();
  for (const event of events) {
    if (event.type !== "toolResult" || normalizeProjectAgentToolName(event.data?.name) !== "task_list" ||
        !isLegacyShellTaskListResult(event)) continue;
    legacyShellTaskListResultIds.add(event.id);
    if (typeof event.data?.toolCallEventId === "string") legacyShellTaskListCallIds.add(event.data.toolCallEventId);
  }
  return events.filter((event) =>
    !legacyShellTaskListResultIds.has(event.id) && !legacyShellTaskListCallIds.has(event.id) &&
    !isLegacyModelHiddenToolName(typeof event.data?.name === "string" ? event.data.name : ""),
  ).map((event) => {
    const projectedTool = projectAgentToolCallForModel(event.data?.name, event.data?.arguments);
    const toolName = projectedTool?.name ?? normalizeProjectAgentToolName(event.data?.name);
    if (event.type !== "toolCall" && event.type !== "toolResult") return event;
    if (toolName !== "shell_command") {
      return {
        ...event,
        data: {
          ...event.data,
          name: toolName,
          ...(event.type === "toolCall"
            ? { arguments: projectedTool?.arguments ?? event.data?.arguments }
            : {}),
        },
      };
    }
    const normalizedEvent: ProjectAgentEvent = {
      ...event,
      data: {
        ...event.data,
        name: "shell_command",
        ...(event.type === "toolCall"
          ? { arguments: projectedTool?.arguments ?? event.data?.arguments }
          : {}),
      },
    };
    if (event.type !== "toolResult") return normalizedEvent;

    const output = event.data?.output;
    if (!isRecord(output) || typeof output.id !== "string" || typeof output.status !== "string") {
      return normalizedEvent;
    }
    const modelOutput = formatShellResultForModel(output);
    return {
      ...normalizedEvent,
      content: modelOutput,
      data: {
        ...normalizedEvent.data,
        output: modelOutput,
      },
    };
  });
}

const LEGACY_MODEL_HIDDEN_TOOL_NAMES = new Set([
  "todo_write",
  "run_approved_command",
  "open_preview",
  "restart_service",
  "start_dev_server",
  "scan_ports",
]);

function isLegacyModelHiddenToolName(value: string) {
  return LEGACY_MODEL_HIDDEN_TOOL_NAMES.has(value);
}

function normalizeLegacyToolArguments(toolName: string, value: unknown) {
  if (!isRecord(value) || toolName !== "shell_command") return value;
  if (value.run_in_background !== undefined || value.background === undefined) return value;
  const { background, ...rest } = value;
  return { ...rest, run_in_background: background };
}

function isLegacyShellTaskListResult(event: ProjectAgentEvent) {
  const output = event.data?.output;
  if (isRecord(output)) {
    if (typeof output.guidance === "string" && output.guidance.includes("restartCommand")) return true;
    if (Array.isArray(output.tasks) && output.tasks.some((task) =>
      isRecord(task) && (typeof task.executable === "string" ||
        (isRecord(task.restartCommand) && typeof task.restartCommand.executable === "string")))) return true;
  }
  const content = event.content ?? "";
  return content.includes("task_list") && content.includes("restartCommand") && content.includes("executable");
}

function formatShellResultForModel(output: Record<string, unknown>) {
  const stdout = typeof output.stdout === "string" ? output.stdout.trim() : "";
  const stderr = typeof output.stderr === "string" ? output.stderr.trim() : "";
  const outputFilePath = typeof output.outputFilePath === "string" ? output.outputFilePath : "";
  if (output.status === "running") {
    return [
      `Command running in background with ID: ${output.id}.`,
      outputFilePath ? `Output is being written to: ${outputFilePath}.` : "",
    ].filter(Boolean).join(" ");
  }

  const content = [stdout, stderr ? `[stderr]\n${stderr}` : ""].filter(Boolean).join("\n");
  if (content) return content;
  if (typeof output.error === "string" && output.error.trim()) return output.error.trim();
  if (output.status === "succeeded") {
    return typeof output.exitCode === "number"
      ? `Command completed with exit code ${output.exitCode}.`
      : "Command completed successfully.";
  }
  return `Command ${output.status}${typeof output.exitCode === "number" ? ` with exit code ${output.exitCode}` : ""}.`;
}

function isMicrocompactableToolResult(event: ProjectAgentEvent) {
  return event.type === "toolResult" && typeof event.data?.name === "string" &&
    PROJECT_AGENT_MICROCOMPACT_TOOLS.has(normalizeProjectAgentToolName(event.data.name));
}

function estimateToolResultTokensSaved(event: ProjectAgentEvent) {
  const compacted: ProjectAgentEvent = {
    ...event,
    content: PROJECT_AGENT_TOOL_RESULT_CLEARED,
    data: compactToolResultData(event.data),
  };
  return Math.max(0, estimateProjectAgentEventTokens(event) - estimateProjectAgentEventTokens(compacted));
}

function groupEventsByTurn(events: ProjectAgentEvent[]) {
  const groups: ProjectAgentEvent[][] = [];
  for (const event of events) {
    const current = groups.at(-1);
    if (current?.[0]?.turnId === event.turnId) current.push(event);
    else groups.push([event]);
  }
  return groups;
}

function findProtectedTurnIds(
  events: ProjectAgentEvent[],
  options: { protectLatestUserTurn?: boolean } = {},
) {
  const protectedTurnIds = new Set<string>();
  const resolvedCommandRequestIds = new Set(
    events.flatMap((event) =>
      event.type === "approval" &&
      event.data?.status !== "pending" &&
      typeof event.data?.commandRequestId === "string"
        ? [event.data.commandRequestId]
        : [],
    ),
  );
  const resolvedToolCallEventIds = new Set(
    events.flatMap((event) =>
      event.type === "toolResult" && typeof event.data?.toolCallEventId === "string"
        ? [event.data.toolCallEventId]
        : [],
    ),
  );
  if (options.protectLatestUserTurn ?? true) {
    const lastUserEvent = events.findLast((event) => event.type === "user");
    if (lastUserEvent) protectedTurnIds.add(lastUserEvent.turnId);
  }
  for (const event of events) {
    if (
      event.type === "approval" &&
      isPendingStatus(event.data?.status) &&
      !(typeof event.data?.commandRequestId === "string" && resolvedCommandRequestIds.has(event.data.commandRequestId))
    ) {
      protectedTurnIds.add(event.turnId);
    }
    if (
      event.type === "toolCall" &&
      isRunningStatus(event.data?.status) &&
      !resolvedToolCallEventIds.has(event.id)
    ) {
      protectedTurnIds.add(event.turnId);
    }
  }
  return protectedTurnIds;
}

function compactToolResultData(data: Record<string, unknown> | undefined) {
  if (!data) return { compacted: true };
  const result: Record<string, unknown> = { compacted: true };
  for (const key of ["toolCallId", "toolCallEventId", "executionId", "commandRequestId", "name", "status", "error"]) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  if (typeof data.summary === "string") result.summary = data.summary.slice(0, 2_000);
  return result;
}

function compactToolCallData(data: Record<string, unknown> | undefined) {
  if (!data) return { compacted: true };
  const result: Record<string, unknown> = { compacted: true };
  for (const key of ["executionId", "name", "status"]) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  if (data.arguments && typeof data.arguments === "object") {
    result.arguments = compactUnknown(data.arguments, 0);
  }
  return result;
}

function compactUnknown(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length <= 500 ? value : `${value.slice(0, 500)}… [${value.length} chars]`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (depth >= 3) return "[nested value cleared]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => compactUnknown(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [key, compactUnknown(item, depth + 1)]),
    );
  }
  return String(value);
}

function isTextMessage(event: ProjectAgentEvent) {
  return (event.type === "user" || event.type === "assistant") && Boolean(event.content?.trim());
}

function isPendingStatus(value: unknown) {
  return value === "pending" || value === "proposed" || value === "waitingApproval";
}

function isRunningStatus(value: unknown) {
  return value === "requested" || value === "queued" || value === "running";
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function safeStringify(value: Record<string, unknown>) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
