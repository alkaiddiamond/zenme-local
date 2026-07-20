import { describe, expect, it } from "vitest";

import {
  getImageRequestReferenceUrls,
  getOrderedImageReferenceUrls,
} from "./image-reference-order";
import type { CanvasNode } from "./types";

function imageNode(id: string, url: string): CanvasNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "image",
    data: {
      kind: "image",
      originalUrl: url,
      title: id,
    },
  };
}

describe("image reference request order", () => {
  it("uses the current result image as the first reference when regenerating", () => {
    expect(
      getImageRequestReferenceUrls({
        connectedReferenceImageUrls: ["/clothes.png", "/current.png"],
        currentImageUrl: "/current.png",
      }),
    ).toEqual(["/current.png", "/clothes.png"]);
  });

  it("keeps connected references for a text-to-image request", () => {
    expect(
      getImageRequestReferenceUrls({
        connectedReferenceImageUrls: ["/a.png", "/b.png"],
      }),
    ).toEqual(["/a.png", "/b.png"]);
  });

  it("uses the explicit selection order instead of edge storage order", () => {
    expect(
      getOrderedImageReferenceUrls({
        edges: [
          { id: "a-generation", source: "image-a", target: "generation" },
          { id: "b-generation", source: "image-b", target: "generation" },
        ],
        nodes: [
          imageNode("image-a", "/a.png"),
          imageNode("image-b", "/b.png"),
        ],
        selectedNodeIds: ["image-b", "image-a"],
        targetNodeId: "generation",
      }),
    ).toEqual(["/b.png", "/a.png"]);
  });

  it("excludes selected images that are no longer connected", () => {
    expect(
      getOrderedImageReferenceUrls({
        edges: [
          { id: "a-generation", source: "image-a", target: "generation" },
        ],
        nodes: [
          imageNode("image-a", "/a.png"),
          imageNode("image-b", "/b.png"),
        ],
        selectedNodeIds: ["image-b", "image-a"],
        targetNodeId: "generation",
      }),
    ).toEqual(["/a.png"]);
  });
});
