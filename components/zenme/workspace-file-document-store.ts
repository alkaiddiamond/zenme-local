"use client";

import { useSyncExternalStore } from "react";

import {
  getWorkspaceFileDocumentFromApi,
  saveWorkspaceFileDocumentFromApi,
} from "@/lib/zenme-api";
import type { WorkspaceFileDocumentView } from "@/lib/workspace/file-document-types";

export type WorkspaceFileDocumentSnapshot = {
  baselineContent: string;
  baselineHash: string | null;
  buffer: string;
  conflict: boolean;
  dirty: boolean;
  error: string | null;
  loading: boolean;
  saving: boolean;
  view: WorkspaceFileDocumentView | null;
};

type StoreEntry = {
  listeners: Set<() => void>;
  polling: ReturnType<typeof setInterval> | null;
  refreshing: boolean;
  snapshot: WorkspaceFileDocumentSnapshot;
};

const entries = new Map<string, StoreEntry>();
const POLL_INTERVAL_MS = 2_000;

export function useWorkspaceFileDocument(projectId?: string, documentId?: string) {
  const key = projectId && documentId ? `${projectId}:${documentId}` : "";
  const snapshot = useSyncExternalStore(
    (listener) => projectId && documentId
      ? subscribeWorkspaceFileDocument(projectId, documentId, listener)
      : subscribeEmptyEntry(listener),
    () => getEntry(key).snapshot,
    () => getEntry(key).snapshot,
  );
  const entry = getEntry(key);
  return {
    ...snapshot,
    edit: (buffer: string) => editEntry(entry, buffer),
    keepMine: () => keepMine(entry),
    reload: () => reloadEntry(entry),
    revert: () => revertEntry(entry),
    save: () => projectId && documentId
      ? saveEntry(entry, projectId, documentId)
      : Promise.resolve(),
  };
}

export async function refreshWorkspaceFileDocuments(projectId: string) {
  await Promise.all(
    Array.from(entries.entries())
      .filter(([key]) => key.startsWith(`${projectId}:`))
      .map(([key, entry]) => refreshEntry(entry, projectId, key.slice(projectId.length + 1))),
  );
}

export function subscribeWorkspaceFileDocument(
  projectId: string,
  documentId: string,
  listener: () => void,
) {
  const key = `${projectId}:${documentId}`;
  const entry = getEntry(key);
  entry.listeners.add(listener);
  if (entry.listeners.size === 1) {
    void refreshEntry(entry, projectId, documentId);
    entry.polling = setInterval(() => {
      void refreshEntry(entry, projectId, documentId);
    }, POLL_INTERVAL_MS);
  }
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.polling) {
      clearInterval(entry.polling);
      entry.polling = null;
    }
  };
}

function subscribeEmptyEntry(listener: () => void) {
  const entry = getEntry("");
  entry.listeners.add(listener);
  return () => { entry.listeners.delete(listener); };
}

function getEntry(key: string) {
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: StoreEntry = {
    listeners: new Set(),
    polling: null,
    refreshing: false,
    snapshot: {
      baselineContent: "",
      baselineHash: null,
      buffer: "",
      conflict: false,
      dirty: false,
      error: null,
      loading: Boolean(key),
      saving: false,
      view: null,
    },
  };
  entries.set(key, entry);
  return entry;
}

async function refreshEntry(entry: StoreEntry, projectId: string, documentId: string) {
  if (entry.refreshing) return;
  entry.refreshing = true;
  try {
    const view = await getWorkspaceFileDocumentFromApi(projectId, documentId);
    entry.snapshot = reconcileWorkspaceFileSnapshot(entry.snapshot, view);
  } catch (error) {
    entry.snapshot = {
      ...entry.snapshot,
      error: error instanceof Error ? error.message : "文件状态加载失败",
      loading: false,
      view: entry.snapshot.view,
    };
  } finally {
    entry.refreshing = false;
    for (const listener of entry.listeners) listener();
  }
}

export function reconcileWorkspaceFileSnapshot(
  snapshot: WorkspaceFileDocumentSnapshot,
  view: WorkspaceFileDocumentView,
): WorkspaceFileDocumentSnapshot {
  const isEditableText = view.contentKind === "text" && view.content !== null;
  const diskMatchesBuffer = Boolean(
    snapshot.dirty &&
    isEditableText &&
    view.content === snapshot.buffer,
  );
  const externalConflict = Boolean(
    snapshot.dirty &&
    snapshot.baselineHash &&
    view.contentHash &&
    snapshot.baselineHash !== view.contentHash &&
    !diskMatchesBuffer,
  );
  const acceptDisk = isEditableText && (!snapshot.dirty || diskMatchesBuffer);

  return {
    ...snapshot,
    baselineContent: acceptDisk ? view.content! : snapshot.baselineContent,
    baselineHash: acceptDisk ? view.contentHash : snapshot.baselineHash,
    buffer: acceptDisk ? view.content! : snapshot.buffer,
    conflict: diskMatchesBuffer ? false : snapshot.conflict || externalConflict,
    dirty: diskMatchesBuffer ? false : snapshot.dirty,
    error: null,
    loading: false,
    view,
  };
}

function editEntry(entry: StoreEntry, buffer: string) {
  entry.snapshot = {
    ...entry.snapshot,
    buffer,
    dirty: buffer !== entry.snapshot.baselineContent,
    error: null,
  };
  notify(entry);
}

function reloadEntry(entry: StoreEntry) {
  const content = entry.snapshot.view?.content;
  if (entry.snapshot.view?.contentKind !== "text" || content === null || content === undefined) return;
  entry.snapshot = {
    ...entry.snapshot,
    baselineContent: content,
    baselineHash: entry.snapshot.view.contentHash,
    buffer: content,
    conflict: false,
    dirty: false,
    error: null,
  };
  notify(entry);
}

function keepMine(entry: StoreEntry) {
  const view = entry.snapshot.view;
  if (!view?.contentHash || view.contentKind !== "text") return;
  entry.snapshot = {
    ...entry.snapshot,
    baselineContent: view.content ?? "",
    baselineHash: view.contentHash,
    conflict: false,
    dirty: entry.snapshot.buffer !== (view.content ?? ""),
    error: null,
  };
  notify(entry);
}

function revertEntry(entry: StoreEntry) {
  entry.snapshot = {
    ...entry.snapshot,
    buffer: entry.snapshot.baselineContent,
    dirty: false,
    error: null,
  };
  notify(entry);
}

async function saveEntry(entry: StoreEntry, projectId: string, documentId: string) {
  const expectedHash = entry.snapshot.baselineHash;
  if (!entry.snapshot.dirty || entry.snapshot.saving || !expectedHash) return;
  entry.snapshot = { ...entry.snapshot, error: null, saving: true };
  notify(entry);
  try {
    const view = await saveWorkspaceFileDocumentFromApi({
      content: entry.snapshot.buffer,
      documentId,
      expectedHash,
      projectId,
    });
    entry.snapshot = {
      ...entry.snapshot,
      baselineContent: entry.snapshot.buffer,
      baselineHash: view.contentHash,
      conflict: false,
      dirty: false,
      error: null,
      saving: false,
      view,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件保存失败";
    entry.snapshot = {
      ...entry.snapshot,
      conflict: message.includes("发生变化") || entry.snapshot.conflict,
      error: message,
      saving: false,
    };
  }
  notify(entry);
}

function notify(entry: StoreEntry) {
  for (const listener of entry.listeners) listener();
}
