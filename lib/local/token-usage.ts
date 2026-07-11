import { randomUUID } from "node:crypto";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { resolveInside } from "@/lib/local/path-safety";

const MAX_EVENTS = 100_000;

export type TokenUsageInput = {
  providerId: string;
  providerName: string;
  modelId: string;
  modality: "text" | "image";
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs: number;
  messageCount?: number;
};

type TokenUsageEvent = Required<Omit<TokenUsageInput, "messageCount">> & {
  id: string;
  occurredAt: string;
  day: string;
  messageCount: number;
};

type TokenUsageFile = {
  version: 1;
  events: TokenUsageEvent[];
};

let writeQueue = Promise.resolve();

export function getTokenUsagePath(dataDir = getZenmeDataDir()) {
  return resolveInside(dataDir, "token-usage.json");
}

export async function recordTokenUsage(input: TokenUsageInput, dataDir = getZenmeDataDir()) {
  const task = writeQueue.catch(() => undefined).then(async () => {
    const current = await readUsageFile(dataDir);
    const inputTokens = normalizeCount(input.inputTokens);
    const outputTokens = normalizeCount(input.outputTokens);
    const totalTokens = normalizeCount(input.totalTokens) || inputTokens + outputTokens;
    const now = new Date();
    current.events.push({
      id: randomUUID(),
      occurredAt: now.toISOString(),
      day: formatLocalDay(now),
      providerId: input.providerId,
      providerName: input.providerName,
      modelId: input.modelId,
      modality: input.modality,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs: normalizeCount(input.durationMs),
      messageCount: normalizeCount(input.messageCount),
    });
    if (current.events.length > MAX_EVENTS) {
      current.events = current.events.slice(-MAX_EVENTS);
    }
    await writeJsonFile(getTokenUsagePath(dataDir), current);
  });
  writeQueue = task.then(() => undefined, () => undefined);
  return task;
}

export async function getTokenUsageStats(dataDir = getZenmeDataDir()) {
  const { events } = await readUsageFile(dataDir);
  const dailyMap = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number; requests: number }>();
  const modelMap = new Map<string, { modelId: string; providerName: string; totalTokens: number; requests: number }>();
  const providerMap = new Map<string, { providerName: string; totalTokens: number; requests: number }>();

  for (const event of events) {
    const daily = dailyMap.get(event.day) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0 };
    daily.inputTokens += event.inputTokens;
    daily.outputTokens += event.outputTokens;
    daily.totalTokens += event.totalTokens;
    daily.requests += 1;
    dailyMap.set(event.day, daily);

    const modelKey = `${event.providerId}\u0000${event.modelId}`;
    const model = modelMap.get(modelKey) ?? { modelId: event.modelId, providerName: event.providerName, totalTokens: 0, requests: 0 };
    model.totalTokens += event.totalTokens;
    model.requests += 1;
    modelMap.set(modelKey, model);

    const provider = providerMap.get(event.providerId) ?? { providerName: event.providerName, totalTokens: 0, requests: 0 };
    provider.totalTokens += event.totalTokens;
    provider.requests += 1;
    providerMap.set(event.providerId, provider);
  }

  const daily = Array.from(dailyMap, ([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date));
  const activeDays = daily.filter((item) => item.requests > 0).map((item) => item.date);
  const peak = daily.reduce<(typeof daily)[number] | null>((best, item) => !best || item.totalTokens > best.totalTokens ? item : best, null);
  const longest = events.reduce<TokenUsageEvent | null>((best, event) => !best || event.durationMs > best.durationMs ? event : best, null);
  const today = formatLocalDay(new Date());
  const streaks = calculateStreaks(activeDays, today);
  const totalTokens = events.reduce((sum, event) => sum + event.totalTokens, 0);
  const textRequests = events.filter((event) => event.modality === "text").length;
  const imageRequests = events.filter((event) => event.modality === "image").length;
  const firstDay = activeDays[0];
  const calendarDays = firstDay ? Math.max(1, dayDifference(firstDay, today) + 1) : 0;

  return {
    summary: {
      totalTokens,
      trackedDays: activeDays.length,
      peakDailyTokens: peak?.totalTokens ?? 0,
      peakDate: peak?.date ?? null,
      longestRequestMs: longest?.durationMs ?? 0,
      longestRequestMessages: longest?.messageCount ?? 0,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      currentDayTokens: dailyMap.get(today)?.totalTokens ?? 0,
      totalRequests: events.length,
      textRequests,
      imageRequests,
      activityRate: calendarDays ? Math.round(activeDays.length / calendarDays * 100) : 0,
    },
    daily,
    models: Array.from(modelMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
    providers: Array.from(providerMap.values()).sort((a, b) => b.totalTokens - a.totalTokens),
  };
}

async function readUsageFile(dataDir = getZenmeDataDir()) {
  return readJsonFile<TokenUsageFile>(getTokenUsagePath(dataDir), {
    defaultValue: { version: 1, events: [] },
    normalize: normalizeUsageFile,
  });
}

function normalizeUsageFile(value: unknown): TokenUsageFile | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as TokenUsageFile).events)) return null;
  const events = (value as TokenUsageFile).events.filter((event) =>
    event && typeof event === "object" && typeof event.day === "string" && typeof event.modelId === "string",
  );
  return { version: 1, events: events.slice(-MAX_EVENTS) };
}

function normalizeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function formatLocalDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function calculateStreaks(activeDays: string[], today: string) {
  const uniqueDays = Array.from(new Set(activeDays)).sort();
  let longest = 0;
  let running = 0;
  let previous: string | undefined;
  for (const day of uniqueDays) {
    running = previous && dayDifference(previous, day) === 1 ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = day;
  }
  const active = new Set(uniqueDays);
  let current = 0;
  let cursor = today;
  while (active.has(cursor)) {
    current += 1;
    const date = new Date(`${cursor}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    cursor = date.toISOString().slice(0, 10);
  }
  return { current, longest };
}
