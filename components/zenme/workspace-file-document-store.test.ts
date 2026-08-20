import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/zenme-api", () => ({
  getWorkspaceFileDocumentFromApi: vi.fn(),
  saveWorkspaceFileDocumentFromApi: vi.fn(),
}));

import {
  reconcileWorkspaceFileSnapshot,
  subscribeWorkspaceFileDocument,
  type WorkspaceFileDocumentSnapshot,
} from "@/components/zenme/workspace-file-document-store";
import type { WorkspaceFileDocumentView } from "@/lib/workspace/file-document-types";

function snapshot(overrides: Partial<WorkspaceFileDocumentSnapshot> = {}): WorkspaceFileDocumentSnapshot {
  return {
    baselineContent: "external\nbravo\n",
    baselineHash: "old-hash",
    buffer: "mine\nbravo\n",
    conflict: false,
    dirty: true,
    error: null,
    loading: false,
    saving: false,
    view: null,
    ...overrides,
  };
}

function view(content: string, contentHash: string): WorkspaceFileDocumentView {
  return {
    change: "modified",
    content,
    contentHash,
    contentKind: "text",
    document: {
      createdAt: "2026-08-12T00:00:00.000Z",
      fileIdentity: { device: "1", inode: "2" },
      id: "document-id",
      projectId: "project-id",
      relativePath: "sample.txt",
      updatedAt: "2026-08-12T00:00:00.000Z",
      version: 1,
    },
    encoding: "utf-8",
    gitStatus: " M",
    ignored: false,
    modifiedAt: "2026-08-12T00:00:00.000Z",
    sensitive: false,
    size: content.length,
    status: "resolved",
    writable: true,
  };
}

describe("workspace file document reconciliation", () => {
  it("accepts a ChangeSet write that makes disk match the dirty buffer", () => {
    const next = reconcileWorkspaceFileSnapshot(snapshot(), view("mine\nbravo\n", "new-hash"));

    expect(next).toMatchObject({
      baselineContent: "mine\nbravo\n",
      baselineHash: "new-hash",
      buffer: "mine\nbravo\n",
      conflict: false,
      dirty: false,
    });
  });

  it("keeps an actual external edit as a conflict without replacing the buffer", () => {
    const next = reconcileWorkspaceFileSnapshot(snapshot(), view("other\nbravo\n", "other-hash"));

    expect(next).toMatchObject({
      baselineContent: "external\nbravo\n",
      baselineHash: "old-hash",
      buffer: "mine\nbravo\n",
      conflict: true,
      dirty: true,
    });
  });

  it("shares one polling interval and releases it after the last node unsubscribes", () => {
    vi.useFakeTimers();
    const first = subscribeWorkspaceFileDocument("project-subscription", "document-subscription", vi.fn());
    const second = subscribeWorkspaceFileDocument("project-subscription", "document-subscription", vi.fn());
    expect(vi.getTimerCount()).toBe(1);

    first();
    expect(vi.getTimerCount()).toBe(1);
    second();
    expect(vi.getTimerCount()).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
