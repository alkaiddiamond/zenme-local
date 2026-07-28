import { describe, expect, it } from "vitest";

import {
  canConnectCanvasNodeKinds,
  getCanvasNodeCapability,
  isExecutableCanvasNodeKind,
} from "@/components/zenme/canvas/node-capabilities";

describe("canvas node capabilities", () => {
  it("registers the first text, image and video execution kinds", () => {
    expect(getCanvasNodeCapability("textGeneration").executionKind).toBe("text");
    expect(getCanvasNodeCapability("imageGeneration").executionKind).toBe("image");
    expect(getCanvasNodeCapability("videoGeneration").executionKind).toBe("video");
    expect(isExecutableCanvasNodeKind("book")).toBe(false);
  });

  it("uses port data types instead of node-name pairs", () => {
    expect(canConnectCanvasNodeKinds({ sourceKind: "image", targetKind: "videoGeneration" })).toBe(true);
    expect(canConnectCanvasNodeKinds({ sourceKind: "video", targetKind: "imageGeneration" })).toBe(false);
    expect(canConnectCanvasNodeKinds({ sourceKind: "agent", targetKind: "imageGeneration" })).toBe(true);
    expect(canConnectCanvasNodeKinds({ sourceKind: "lyrics", targetKind: "textGeneration" })).toBe(true);
    expect(getCanvasNodeCapability("lyrics").outputs[0]?.accepts).toEqual(["text"]);
  });
});
