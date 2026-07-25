import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  createPendingVideoResultChildCanvasNode,
  createVideoGenerationCanvasNode,
} from "./node-factories";
import type { CanvasNode } from "./types";

const videoNodeSource = readFileSync(
  new URL("../nodes/video-node.tsx", import.meta.url),
  "utf8",
);
const nodeFactoriesSource = readFileSync(
  new URL("./node-factories.ts", import.meta.url),
  "utf8",
);
const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);
const renderedNodesSource = readFileSync(
  new URL("./rendered-nodes.ts", import.meta.url),
  "utf8",
);

describe("video generation node workflow", () => {
  it("uses the request composer as the video-generation node body", () => {
    expect(videoNodeSource).toContain(
      'className="relative h-full min-h-[176px] w-full min-w-[420px] text-zinc-950"',
    );
    expect(videoNodeSource).toContain(
      "zenme-shadow-node flex h-full min-h-[176px] flex-col",
    );
    expect(videoNodeSource).not.toContain("showComposer");
    expect(videoNodeSource).not.toContain("composerStyle");
    expect(videoNodeSource).not.toContain("useViewport");
    expect(videoNodeSource).not.toContain("zenme-node-floating-control");
  });

  it("allows dragging blank panel areas while keeping controls interactive", () => {
    expect(videoNodeSource).not.toContain(
      "zenme-shadow-node nodrag nowheel flex h-full min-h-[176px]",
    );
    expect(videoNodeSource).toContain(
      "nodrag nowheel mt-auto flex min-w-0 items-center",
    );
    expect(videoNodeSource).toContain("<NodeResizer");
    expect(canvasClientSource).toContain("if (!draggedNode) {");
  });

  it("opens the image picker for @ anywhere and inserts a persistent inline chip", () => {
    expect(videoNodeSource).toContain("ImageReferencePicker");
    expect(videoNodeSource).toContain("setReferencePickerRequest");
    expect(videoNodeSource).toContain('event.key === "@"');
    expect(videoNodeSource).toContain("event.preventDefault()");
    expect(videoNodeSource).toContain("insertPendingReference");
    expect(videoNodeSource).toContain("videoReferenceAnchor");
    expect(videoNodeSource).toContain("data-video-reference-id");
    expect(videoNodeSource).toContain("videoPromptMentions: nextMentions");
    expect(canvasClientSource).toContain(
      "selectedNodeIds: sourceNode.data.imageReferenceNodeIds",
    );
  });

  it("locks first-and-last-frame requests to adaptive ratio and keeps settings compact", () => {
    expect(videoNodeSource).toContain(
      'referenceMode === "firstLast" ? "adaptive" : ratio',
    );
    expect(videoNodeSource).toContain('videoRatio: "adaptive"');
    expect(videoNodeSource).toContain(
      'referenceMode !== "firstLast" || ratio === "adaptive"',
    );
    expect(videoNodeSource).toContain('label="比例"');
    expect(videoNodeSource).toContain(
      '<Segment active onClick={() => undefined}>自适应</Segment>',
    );
    expect(videoNodeSource).toContain(
      'const nextRatio = ratio === "adaptive" ? "16:9" : ratio',
    );
    expect(videoNodeSource).toContain('w-[28rem] rounded-xl');
    expect(videoNodeSource).toContain(
      'props.referenceMode === "reference" ? "grid-cols-6" : "grid-cols-1"',
    );
    expect(videoNodeSource).toContain('className="grid-cols-9" label="生成时长"');
    expect(videoNodeSource).not.toContain('["adaptive", "16:9"');
  });

  it("matches the compact TapNow composer proportions with Zenme surfaces", () => {
    expect(videoNodeSource).toContain('min-h-[176px] w-full min-w-[420px]');
    expect(videoNodeSource).toContain('min-h-[72px] flex-1');
    expect(videoNodeSource).toContain('rounded-xl border bg-white p-3');
  });

  it("matches image generation sizing for requests and keeps results at 16:9", () => {
    expect(nodeFactoriesSource).toContain(
      "VIDEO_GENERATION_REQUEST_NODE_DEFAULT_SIZE = IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE",
    );
    expect(renderedNodesSource).toContain(
      'nodeWithConnectionState.data.kind === "videoGeneration"',
    );
    expect(renderedNodesSource).toContain(
      "...IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE",
    );
    expect(renderedNodesSource).toContain("usesLegacyPlaceholderSize");
    expect(videoNodeSource).toContain("min-h-[176px]");
    expect(nodeFactoriesSource).toContain(
      "VIDEO_RESULT_NODE_DEFAULT_SIZE = { height: 315, width: 560 }",
    );

    const request = createVideoGenerationCanvasNode({
      id: "video-request",
      model: "volcengine/doubao-seedance-1-5-pro-251215",
      position: { x: 120, y: 80 },
    });
    expect(request.node).toMatchObject({
      id: "video-request",
      style: { height: 260, width: 520 },
      type: "videoGeneration",
      data: {
        kind: "videoGeneration",
        videoDuration: 5,
        videoReferenceMode: "firstLast",
        videoResolution: "720p",
      },
    });

    const result = createPendingVideoResultChildCanvasNode({
      duration: 5,
      generateAudio: true,
      id: "video-result",
      model: "volcengine/doubao-seedance-1-5-pro-251215",
      position: { x: 760, y: 80 },
      prompt: "机器人转身并向镜头挥手",
      ratio: "16:9",
      resolution: "720p",
      sourceNode: request.node as CanvasNode,
      startedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(result.node).toMatchObject({
      id: "video-result",
      style: { height: 315, width: 560 },
      type: "video",
      data: {
        kind: "video",
        videoGenerationResult: true,
        videoPrompt: "机器人转身并向镜头挥手",
        videoStatus: "generating",
      },
    });
  });
});
