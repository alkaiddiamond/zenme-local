import { describe, expect, it, vi } from "vitest";

import { getRenderedCanvasNodes } from "./rendered-nodes";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
  type?: string;
}): CanvasNode {
  return {
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
    id: input.id,
    position: { x: 0, y: 0 },
    type: input.type ?? "text",
  } as CanvasNode;
}

describe("rendered canvas nodes", () => {
  it("keeps running nodes active without mounting far multi-selected content", () => {
    const selected = node({ id: "selected" });
    selected.selected = true;
    const renderedNodes = getRenderedCanvasNodes({
      activeContentNodeIds: new Set(["nearby"]),
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [
        node({ id: "nearby" }),
        node({ id: "far" }),
        selected,
        node({ data: { aiStatus: "generating" }, id: "running" }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.map((item) => item.data.canvasContentActive)).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("reuses unchanged rendered nodes while another node moves", () => {
    const stable = node({ id: "stable" });
    const moving = node({ id: "moving" });
    const input = {
      createNoteNode: vi.fn(),
      edges: [],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    };
    const first = getRenderedCanvasNodes({
      ...input,
      nodes: [stable, moving],
    });
    const moved = {
      ...moving,
      position: { x: 120, y: 80 },
    };
    const second = getRenderedCanvasNodes({
      ...input,
      nodes: [stable, moved],
    });

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it("keeps derived folder nodes stable when only an unrelated position changes", () => {
    const folder = node({
      data: { kind: "musicFolder" },
      id: "folder",
      type: "musicFolder",
    });
    const music = node({
      data: { kind: "music", musicFolderId: "folder", title: "歌曲" },
      id: "music",
      type: "music",
    });
    const unrelated = node({ id: "unrelated" });
    const input = {
      createNoteNode: vi.fn(),
      edges: [],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    };
    const first = getRenderedCanvasNodes({
      ...input,
      nodes: [folder, music, unrelated],
    });
    const second = getRenderedCanvasNodes({
      ...input,
      nodes: [
        folder,
        music,
        { ...unrelated, position: { x: 40, y: 30 } },
      ],
    });

    expect(second[0]).toBe(first[0]);
  });

  it("injects the derived-image callback into image nodes", () => {
    const onCreateDerivedImageNode = vi.fn();
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [node({ data: { kind: "image" }, id: "image", type: "image" })],
      onCreateDerivedImageNode,
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes[0].data.onCreateDerivedImageNode)
      .toBe(onCreateDerivedImageNode);
  });

  it("marks selected nodes when the canvas has a multi-selection", () => {
    const first = node({ id: "first" });
    const second = node({ id: "second" });
    first.selected = true;
    second.selected = true;

    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [first, second, node({ id: "unselected" })],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "first")?.data)
      .toMatchObject({ isMultiSelection: true });
    expect(renderedNodes.find((item) => item.id === "second")?.data)
      .toMatchObject({ isMultiSelection: true });
    expect(renderedNodes.find((item) => item.id === "unselected")?.data)
      .toMatchObject({ isMultiSelection: false });
  });

  it("injects text composer update handlers into text-like nodes", () => {
    const onToggleAiResponseExpanded = vi.fn();
    const onToggleImagePromptExpanded = vi.fn();
    const onToggleTextExpanded = vi.fn();
    const onUpdateTextGenerationNode = vi.fn();
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [
        node({ id: "text" }),
        node({
          data: { comment: "note", kind: "note" },
          id: "note",
          type: "note",
        }),
        node({
          data: { aiResponse: "answer", kind: "agent" },
          id: "agent",
          type: "agent",
        }),
        node({
          data: { imagePrompt: "prompt", kind: "imageGeneration" },
          id: "image-prompt",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onToggleAiResponseExpanded,
      onToggleImagePromptExpanded,
      onToggleTextExpanded,
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode,
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "text")?.data)
      .toMatchObject({
        onToggleTextExpanded,
        onUpdateTextGenerationNode,
      });
    expect(renderedNodes.find((item) => item.id === "note")?.data)
      .toMatchObject({
        onUpdateTextGenerationNode,
      });
    expect(renderedNodes.find((item) => item.id === "agent")?.data)
      .toMatchObject({
        onToggleAiResponseExpanded,
        onUpdateTextGenerationNode,
      });
    expect(renderedNodes.find((item) => item.id === "image-prompt")?.data)
      .toMatchObject({ onToggleImagePromptExpanded });
  });

  it("shares project tag options across managed text nodes", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [],
      nodes: [
        node({
          data: {
            kind: "managedText",
            tagColors: { 产品: "blue" },
            tags: ["产品", "灵感"],
          },
          id: "managed-a",
          type: "managedText",
        }),
        node({
          data: { kind: "managedText", tags: ["产品", "待办"] },
          id: "managed-b",
          type: "managedText",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes[0].data.projectTags).toEqual(["产品", "待办", "灵感"]);
    expect(renderedNodes[1].data.projectTags).toEqual(["产品", "待办", "灵感"]);
    expect(renderedNodes[0].data.projectTagColors).toEqual({ 产品: "blue" });
    expect(renderedNodes[1].data.projectTagColors).toEqual({ 产品: "blue" });
  });

  it("keeps managed text rendering stable when unrelated nodes move", () => {
    const managed = node({
      data: { kind: "managedText", tags: ["资料"] },
      id: "managed",
      type: "managedText",
    });
    const unrelated = node({ id: "unrelated" });
    const input = {
      createNoteNode: vi.fn(),
      edges: [],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateProjectTag: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    };
    const first = getRenderedCanvasNodes({
      ...input,
      nodes: [managed, unrelated],
    });
    const second = getRenderedCanvasNodes({
      ...input,
      nodes: [
        managed,
        { ...unrelated, position: { x: 100, y: 100 } },
      ],
    });

    expect(second[0]).toBe(first[0]);
  });

  it("derives direct task children, progress and shared project tags", () => {
    const onLocateTaskNode = vi.fn();
    const onRequestTaskParentOptions = vi.fn();
    const onSetTaskParent = vi.fn();
    const onUpdateTaskNode = vi.fn();
    const onToggleTaskChildren = vi.fn();
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "parent", target: "plain-text" },
        { source: "parent", target: "image" },
        { source: "parent", target: "managed-text" },
      ],
      nodes: [
        node({
          data: {
            kind: "task",
            name: "父任务",
            tags: ["迭代"],
            taskStatus: "inProgress",
          },
          id: "parent",
          type: "task",
        }),
        node({
          data: {
            kind: "task",
            name: "完成项",
            taskParentId: "parent",
            taskStatus: "completed",
          },
          id: "done-child",
          type: "task",
        }),
        node({
          data: {
            kind: "task",
            name: "进行项",
            taskParentId: "parent",
            taskStatus: "inProgress",
          },
          id: "active-child",
          type: "task",
        }),
        node({ id: "plain-text" }),
        node({
          data: { kind: "image", title: "任务参考图" },
          id: "image",
          type: "image",
        }),
        node({
          data: { kind: "managedText", name: "任务说明" },
          id: "managed-text",
          type: "managedText",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onLocateTaskNode,
      onRequestTaskParentOptions,
      onSetTaskParent,
      onUpdateTaskNode,
      onToggleTaskChildren,
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    const parent = renderedNodes.find((item) => item.id === "parent");
    expect(parent?.data.taskChildren).toEqual([
      { id: "done-child", name: "完成项", status: "completed" },
      { id: "active-child", name: "进行项", status: "inProgress" },
    ]);
    expect(parent?.data.taskProgress).toBe(0.5);
    expect(parent?.data.projectTags).toEqual(["迭代"]);
    expect(parent?.data.taskParentOptions).toBeUndefined();
    expect(parent?.data.onLocateTaskNode).toBe(onLocateTaskNode);
    expect(parent?.data.onRequestTaskParentOptions)
      .toBe(onRequestTaskParentOptions);
    expect(parent?.data.onSetTaskParent).toBe(onSetTaskParent);
    expect(parent?.data.onUpdateTaskNode).toBe(onUpdateTaskNode);
    expect(parent?.data.onToggleTaskChildren).toBe(onToggleTaskChildren);
    expect(renderedNodes.find((item) => item.id === "done-child")?.data)
      .toMatchObject({ taskParentId: "parent", taskParentName: "父任务" });
  });

  it("derives image-generation references from incoming image edges", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "image-a", target: "generation" },
        { source: "image-b", target: "generation" },
      ],
      nodes: [
        node({
          data: { kind: "image", previewUrl: "/a.webp", title: "参考 A" },
          id: "image-a",
          type: "image",
        }),
        node({
          data: { kind: "image", originalUrl: "/b.png", title: "参考 B" },
          id: "image-b",
          type: "image",
        }),
        node({
          data: { kind: "imageGeneration", title: "图片生成" },
          id: "generation",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "generation")?.data.imageReferences)
      .toEqual([
        { nodeId: "image-a", title: "参考 A", url: "/a.webp" },
        { nodeId: "image-b", title: "参考 B", url: "/b.png" },
      ]);
  });

  it("keeps an incoming image available as an @ candidate on a generated image", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [{ source: "reference", target: "generated" }],
      nodes: [
        node({
          data: {
            imageGenerated: true,
            kind: "image",
            previewUrl: "/reference.webp",
            title: "人物参考",
          },
          id: "reference",
          type: "image",
        }),
        node({
          data: {
            imageGenerated: true,
            kind: "image",
            originalUrl: "/generated.webp",
          },
          id: "generated",
          type: "image",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "generated")?.data.imageReferenceCandidates)
      .toEqual([
        { nodeId: "reference", title: "人物参考", url: "/reference.webp" },
      ]);
  });

  it("derives selectable text references from incoming text edges", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "prompt-a", target: "generation" },
        { source: "prompt-b", target: "generation" },
      ],
      nodes: [
        node({
          data: {
            imagePrompt: "庭院提示词",
            kind: "imageGeneration",
            title: "构图提示",
          },
          id: "prompt-a",
          type: "imageGeneration",
        }),
        node({
          data: { kind: "text", plainText: "秋日光线", title: "光影提示" },
          id: "prompt-b",
          type: "text",
        }),
        node({
          data: {
            imageTextReferenceNodeIds: ["prompt-b"],
            kind: "imageGeneration",
          },
          id: "generation",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });
    const generation = renderedNodes.find((item) => item.id === "generation");

    expect(generation?.data.imageTextReferenceCandidates).toEqual([
      { nodeId: "prompt-a", title: "构图提示" },
      { nodeId: "prompt-b", title: "光影提示" },
    ]);
    expect(generation?.data.imageTextReferences).toEqual([
      { nodeId: "prompt-b", title: "光影提示" },
    ]);
  });

  it("shows only explicitly selected reference candidates", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "image-a", target: "generation" },
        { source: "image-b", target: "generation" },
      ],
      nodes: [
        node({ data: { kind: "image", previewUrl: "/a.webp" }, id: "image-a", type: "image" }),
        node({ data: { kind: "image", previewUrl: "/b.webp" }, id: "image-b", type: "image" }),
        node({
          data: {
            imageReferenceNodeIds: ["image-b", "image-a"],
            kind: "imageGeneration",
          },
          id: "generation",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });
    const generation = renderedNodes.find((item) => item.id === "generation");
    expect(generation?.data.imageReferenceCandidates).toHaveLength(2);
    expect(generation?.data.imageReferences?.map((item) => item.nodeId)).toEqual([
      "image-b",
      "image-a",
    ]);
  });

  it("locks a source while one of its generation children is running", () => {
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "text", target: "agent-running" },
        { source: "image", target: "image-running" },
      ],
      nodes: [
        node({ id: "text" }),
        node({ data: { kind: "agent", aiStatus: "generating" }, id: "agent-running", type: "agent" }),
        node({ data: { kind: "image", imageGenerated: true }, id: "image", type: "image" }),
        node({
          data: { kind: "imageGeneration", imageGenerationResult: true, imageStatus: "editing" },
          id: "image-running",
          type: "imageGeneration",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "text")?.data.hasRunningGenerationChild).toBe(true);
    expect(renderedNodes.find((item) => item.id === "image")?.data.hasRunningGenerationChild).toBe(true);
  });

  it("keeps persisted lyrics when the transient analysis result is absent after refresh", () => {
    const persistedLyrics = [
      { start: 55, end: 61, text: "第一句" },
      { start: 61, end: 67, text: "第二句" },
    ];
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [{ source: "player", target: "lyrics" }],
      nodes: [
        node({
          data: { kind: "musicPlayer" },
          id: "player",
          type: "musicPlayer",
        }),
        node({
          data: {
            kind: "lyrics",
            lyricsFetchStatus: "succeeded",
            musicLyrics: persistedLyrics,
          },
          id: "lyrics",
          type: "lyrics",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "lyrics")?.data.musicLyrics)
      .toEqual(persistedLyrics);
  });

  it("renders every connected music source and derives media from the selected source", () => {
    const onSelectAdjacentMusicSource = vi.fn();
    const onSelectMusicSource = vi.fn();
    const onToggleMusicLyricsOverlay = vi.fn();
    const renderedNodes = getRenderedCanvasNodes({
      createNoteNode: vi.fn(),
      edges: [
        { source: "music-a", target: "player" },
        { source: "music-b", target: "player" },
      ],
      musicLyricsOverlayPlayerNodeId: "player",
      nodes: [
        node({
          data: { kind: "music", originalUrl: "/a.mp3", title: "歌曲 A" },
          id: "music-a",
          type: "music",
        }),
        node({
          data: { kind: "music", originalUrl: "/b.mp3", title: "歌曲 B" },
          id: "music-b",
          type: "music",
        }),
        node({
          data: { kind: "musicPlayer", musicSourceNodeId: "music-b", title: "旧播放器名称" },
          id: "player",
          type: "musicPlayer",
        }),
      ],
      onCreateTextChildNode: vi.fn(),
      onSelectAdjacentMusicSource,
      onSelectMusicSource,
      onToggleMusicLyricsOverlay,
      onSubmitImageNode: vi.fn(),
      onSubmitTextGenerationNode: vi.fn(),
      onUpdateImageNode: vi.fn(),
      onUpdateTextGenerationNode: vi.fn(),
      onUpdateTextNode: vi.fn(),
      projectId: "project",
      toggleReaderCollapse: vi.fn(),
    });

    expect(renderedNodes.find((item) => item.id === "player")?.data).toMatchObject({
      musicSourceNodeId: "music-b",
      musicLyricsOverlayOpen: true,
      musicSources: [
        { id: "music-a", title: "歌曲 A" },
        { id: "music-b", title: "歌曲 B" },
      ],
      onSelectAdjacentMusicSource,
      onSelectMusicSource,
      onToggleMusicLyricsOverlay,
      originalUrl: "/b.mp3",
      title: "音乐播放器",
    });
  });

});
