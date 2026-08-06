import { AlertCircle, Check, Loader2, Pencil } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  canPrepareReadingAsset,
  getActionNode,
  getGroupableNodes,
  getSaveStatusIcon,
  getSaveStatusTone,
  getSelectionToolbarPosition,
} from "./derived-state";
import type { CanvasNode, SaveStatus } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  hidden?: boolean;
  id: string;
  parentId?: string;
  position?: { x: number; y: number };
  selected?: boolean;
  style?: CanvasNode["style"];
  type?: string;
}): CanvasNode {
  return {
    hidden: input.hidden,
    id: input.id,
    parentId: input.parentId,
    position: input.position ?? { x: 0, y: 0 },
    selected: input.selected,
    style: input.style,
    type: input.type ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

describe("canvas derived state helpers", () => {
  it.each<[SaveStatus, string]>([
    ["未保存", "text-zinc-500"],
    ["保存中", "text-zinc-500"],
    ["已保存", "text-emerald-600"],
    ["保存失败", "text-red-600"],
    ["离线", "text-red-600"],
  ])("maps save status %s to tone %s", (status, tone) => {
    expect(getSaveStatusTone(status)).toBe(tone);
  });

  it.each<[SaveStatus, unknown]>([
    ["未保存", Pencil],
    ["保存中", Loader2],
    ["已保存", Check],
    ["保存失败", AlertCircle],
    ["离线", AlertCircle],
  ])("maps save status %s to an icon", (status, icon) => {
    expect(getSaveStatusIcon(status)).toBe(icon);
  });

  it("filters groupable nodes to selected standalone non-group nodes", () => {
    const nodes = [
      node({ id: "selected", selected: true }),
      node({ id: "hidden", hidden: true, selected: true }),
      node({
        data: { kind: "group" },
        id: "group",
        selected: true,
        type: "group",
      }),
      node({
        data: { groupId: "group-1" },
        id: "group-child",
        selected: true,
      }),
      node({ id: "parented", parentId: "group-1", selected: true }),
      node({ id: "not-selected", selected: false }),
    ];

    expect(getGroupableNodes(nodes).map((item) => item.id)).toEqual([
      "selected",
    ]);
  });

  it("finds the node targeted by an action menu", () => {
    const nodes = [node({ id: "a" }), node({ id: "b" })];

    expect(getActionNode({ nodeId: "b", nodes })?.id).toBe("b");
    expect(getActionNode({ nodeId: "missing", nodes })).toBeUndefined();
    expect(getActionNode({ nodes })).toBeUndefined();
  });

  it("detects book nodes that need reading asset preparation", () => {
    expect(
      canPrepareReadingAsset(
        node({
          data: {
            fileName: "book.epub",
            kind: "book",
            originalUrl: "blob:book",
          },
          id: "book",
        }),
      ),
    ).toBe(true);

    expect(
      canPrepareReadingAsset(
        node({
          data: {
            fileName: "book.epub",
            kind: "book",
            originalUrl: "blob:book",
            readingAssetId: "asset-1",
          },
          id: "registered-book",
        }),
      ),
    ).toBe(false);
    expect(
      canPrepareReadingAsset(
        node({
          data: { fileName: "book.epub", kind: "book" },
          id: "missing-url",
        }),
      ),
    ).toBe(false);
    expect(
      canPrepareReadingAsset(
        node({
          data: {
            fileName: "image.png",
            kind: "image",
            originalUrl: "blob:image",
          },
          id: "image",
        }),
      ),
    ).toBe(false);
    expect(canPrepareReadingAsset(undefined)).toBe(false);

    expect(
      canPrepareReadingAsset(
        node({
          data: {
            kind: "text",
            plainText: "# 可阅读内容",
            readingAssetId: "older-snapshot",
            textMode: "markdown",
          },
          id: "markdown-text",
        }),
      ),
    ).toBe(true);
    expect(
      canPrepareReadingAsset(
        node({
          data: { kind: "text", plainText: "   ", textMode: "markdown" },
          id: "empty-text",
        }),
      ),
    ).toBe(false);
  });

  it("positions the selection toolbar above the selected node bounds", () => {
    const nodes = [
      node({
        id: "a",
        position: { x: 20, y: 40 },
        selected: true,
        style: { height: 60, width: 80 },
      }),
      node({
        id: "b",
        position: { x: 180, y: 120 },
        selected: true,
        style: { height: 80, width: 100 },
      }),
    ];

    expect(
      getSelectionToolbarPosition({
        canvasViewport: { x: 10, y: 20, zoom: 2 },
        groupableNodes: nodes,
        nodes,
      }),
    ).toEqual({
      left: 310,
      top: 38,
    });
  });

  it("does not show the selection toolbar for fewer than two groupable nodes", () => {
    const selected = node({ id: "selected", selected: true });

    expect(
      getSelectionToolbarPosition({
        canvasViewport: { x: 0, y: 0, zoom: 1 },
        groupableNodes: [selected],
        nodes: [selected],
      }),
    ).toBeNull();
  });
});
