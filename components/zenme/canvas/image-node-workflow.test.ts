import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const imageNodeSource = readFileSync(
  new URL("../nodes/image-node.tsx", import.meta.url),
  "utf8",
);
const imageGenerationNodeSource = readFileSync(
  new URL("../nodes/image-edit-node.tsx", import.meta.url),
  "utf8",
);
const canvasClientSource = readFileSync(
  new URL("../canvas-client.tsx", import.meta.url),
  "utf8",
);
const menuSource = readFileSync(
  new URL("./menus.tsx", import.meta.url),
  "utf8",
);
const visualComponentsSource = readFileSync(
  new URL("../visual-components.tsx", import.meta.url),
  "utf8",
);

describe("direct image editing workflow", () => {
  it("opens the AI composer for any image with local content", () => {
    expect(imageNodeSource).toContain("if (imageUrl) {");
    expect(imageNodeSource).toContain("描述想如何编辑这张图片");
    expect(imageNodeSource).toContain(
      "const isGeneratedImage = Boolean(nodeData.imageGenerated)",
    );
    expect(canvasClientSource).toContain(
      "Boolean(node.data.originalUrl || node.data.previewUrl)",
    );
  });

  it("uses the same neutral frame for uploaded and generated images", () => {
    expect(imageNodeSource).toContain(
      'rounded-xl border bg-zinc-100 ${',
    );
    expect(imageNodeSource).not.toContain('border-zinc-800');
    expect(imageNodeSource).not.toContain(
      'isGeneratedImage ? "bg-zinc-950"',
    );
  });

  it("keeps the generated-image model picker interactive outside the canvas node", () => {
    expect(imageNodeSource).toContain(
      "(selected || isModelPickerOpen)",
    );
    expect(imageNodeSource).toContain(
      "onOpenChange={setIsModelPickerOpen}",
    );
    expect(visualComponentsSource).toContain(
      "nodrag nopan nowheel zenme-shadow-dropdown",
    );
    expect(visualComponentsSource).toContain(
      "onPointerDown={(event) => event.stopPropagation()}",
    );
  });

  it("does not create an empty image-generation node from an image action menu", () => {
    expect(menuSource).not.toContain(
      'actionNode?.data.kind !== "image"',
    );
    expect(menuSource).not.toContain(
      'onClick={() => onCreateConnectedPlaceholder("imageGeneration")}\n        title="图片生成"',
    );
  });

  it("uses the request composer as the image-generation node body", () => {
    expect(imageGenerationNodeSource).toContain(
      "const isResultNode = Boolean(nodeData.imageGenerationResult)",
    );
    expect(imageGenerationNodeSource).toContain(
      'className="relative h-full min-h-[176px] w-full min-w-[420px] text-zinc-950"',
    );
    expect(imageGenerationNodeSource).not.toContain("showComposer");
    expect(imageGenerationNodeSource).not.toContain("composerStyle");
  });

  it("allows dragging the image-generation request from blank panel areas", () => {
    expect(imageGenerationNodeSource).toContain(
      "zenme-shadow-node flex h-full min-h-[176px]",
    );
    expect(imageGenerationNodeSource).not.toContain(
      "zenme-shadow-node nodrag nowheel flex h-full min-h-[176px]",
    );
    expect(imageGenerationNodeSource).toContain(
      "zenme-text-ai-input nodrag nowheel",
    );
    expect(imageGenerationNodeSource).toContain(
      "nodrag nowheel mt-auto flex items-end",
    );
  });

  it("keeps progress feedback only for a submitted result node", () => {
    expect(imageGenerationNodeSource).toContain(
      "{isResultNode ? (",
    );
    expect(imageGenerationNodeSource).toContain("正在生成图片...");
    expect(imageGenerationNodeSource).toContain(
      "生成完成后，图片会显示在当前节点",
    );
  });
});
