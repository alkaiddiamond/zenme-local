import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectAgentTurnReferences } from "./agent-context";
import { createTextGenerationNodeDataUpdate } from "./node-updates";
import { collectTextGenerationContext, getCanvasNodeContextText, hasCanvasNodeContextText, isTextGenerationContextNode } from "./text-generation-context";
import type { CanvasNode } from "./types";

const video: CanvasNode = {
  id: "video", type: "video", position: { x: 0, y: 0 },
  data: { kind: "video", title: "镜头一", fileName: "clip.mp4", videoPrompt: "人物转身", videoStatus: "done", videoDuration: 5, videoResolution: "720p", originalUrl: "/api/projects/test/files/video" },
};

describe("video node Agent conversations", () => {
  it("reuses the Agent composer only for individually selected result nodes", () => {
    const source = readFileSync(new URL("../nodes/video-node.tsx", import.meta.url), "utf8");
    expect(source).toContain("isResult && selected && !isRenaming && !nodeData.isMultiSelection");
    expect(source).toContain("<TextNodeComposer nodeData={nodeData} nodeId={id} resizable />");
  });

  it("saves Agent drafts without changing video generation settings or the media", () => {
    const result = createTextGenerationNodeDataUpdate({ nodeId: video.id, nodes: [video], updates: { textGenerationPrompt: "改进分镜", textGenerationModel: "agent-model" } });
    expect(result?.nextNodes[0].data).toMatchObject({ ...video.data, textGenerationPrompt: "改进分镜", textGenerationModel: "agent-model" });
    expect(result?.beforeNodeSnapshots.has(video.id)).toBe(true);
    expect(video.data.textGenerationPrompt).toBeUndefined();
  });

  it("supplies video metadata without claiming to have seen the video", () => {
    const context = getCanvasNodeContextText(video);
    expect(context).toContain("视频节点「镜头一」");
    expect(context).toContain("人物转身");
    expect(context).toContain("clip.mp4");
    expect(context).toContain("未提供视频画面或音轨");
    expect(isTextGenerationContextNode(video)).toBe(true);
    expect(hasCanvasNodeContextText(video)).toBe(true);
  });

  it("carries the video and upstream references into downstream conversations", () => {
    const request: CanvasNode = { ...video, id: "request", type: "videoGeneration", data: { kind: "videoGeneration", title: "请求", videoPrompt: "海边日落" } };
    const reply: CanvasNode = { ...video, id: "reply", type: "agent", data: { kind: "agent", title: "回复" } };
    const edges = [{ id: "a", source: request.id, target: video.id }, { id: "b", source: video.id, target: reply.id }];
    const input = { nodeId: reply.id, nodes: [request, video, reply], edges };
    expect(collectTextGenerationContext(input)).toContain("海边日落");
    expect(collectTextGenerationContext(input)).toContain("镜头一");
    expect(collectAgentTurnReferences(input).selectedNodeIds).toEqual([request.id, video.id, reply.id]);
  });

  it("keeps resize and overflow behavior opt-in for video conversations", () => {
    const source = readFileSync(new URL("../nodes/text-node-composer.tsx", import.meta.url), "utf8");
    expect(source).toContain("resizable = false");
    expect(source).toContain('resizable ? "h-[220px] resize-y overflow-hidden" : ""');
    expect(source).toContain('viewportClassName="flex h-full flex-col overflow-y-auto [&>*]:shrink-0"');
    expect(source).toContain('resizable ? "shrink-0 flex-wrap" : ""');
  });
});
