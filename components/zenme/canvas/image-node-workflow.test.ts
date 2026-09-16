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
const imageCameraControlSource = readFileSync(
  new URL("../nodes/image-camera-control-picker.tsx", import.meta.url),
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
const globalStylesSource = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);

describe("direct image editing workflow", () => {
  it("requires image-edit models to support both image input and image output", () => {
    expect(imageNodeSource).toContain(
      'useAiModelOptions("image", ["vision", "image"])',
    );
  });

  it("keeps mounted canvas images from blocking initial interaction", () => {
    expect(imageNodeSource).toContain('decoding="async"');
    expect(imageNodeSource).toContain('loading="lazy"');
    expect(imageGenerationNodeSource).toContain('decoding="async"');
    expect(imageGenerationNodeSource).toContain('loading="lazy"');
  });

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

  it("lets the image prompt composer grow vertically without shrinking below its original height", () => {
    expect(imageNodeSource).toContain(
      "h-[220px] min-h-[220px] w-[640px] max-w-[calc(100vw-48px)] resize-y",
    );
    expect(imageNodeSource).toContain("resize-y flex-col overflow-hidden");
  });

  it("keeps generation feedback inside a scrollable body and the action row visible", () => {
    expect(imageNodeSource).toContain('aria-label="图片生成输入区"');
    expect(imageNodeSource).toContain('viewportClassName="flex h-full flex-col overflow-y-auto"');
    expect(imageNodeSource).toContain('className="relative min-h-24 shrink-0 flex-1"');
    expect(imageNodeSource).toContain('className="mt-auto flex shrink-0 items-end justify-between gap-3 pt-3"');
    expect(imageNodeSource).toContain('className="flex min-w-0 flex-wrap items-center gap-2"');
    expect(imageNodeSource).toContain('role="status"');
  });

  it("uses the same neutral frame for uploaded and generated images", () => {
    expect(imageNodeSource).toContain(
      'rounded-xl border bg-zinc-100 ${',
    );
    expect(imageNodeSource).not.toContain('border-zinc-800');
    expect(imageNodeSource).not.toContain(
      'isGeneratedImage ? "bg-zinc-950"',
    );
    expect(imageNodeSource).not.toContain("min-w-[220px]");
  });

  it("shows the current uploaded or generated image as the fixed first reference", () => {
    expect(imageNodeSource).toContain(
      "fixedReferences={displayImageUrl ? [{",
    );
    expect(imageNodeSource).toContain("nodeId: id");
    expect(imageNodeSource).toContain("title: imageTitle");
    expect(imageNodeSource).toContain("url: displayImageUrl");
    expect(imageGenerationNodeSource).toContain(
      "...fixedReferences,",
    );
    expect(imageGenerationNodeSource).toContain(
      "!fixedReferenceIds.has(reference.nodeId) ? (",
    );
  });

  it("sends upstream text context with a connected image-generation request", () => {
    expect(canvasClientSource).toContain(
      "const textContext = collectTextGenerationContext({",
    );
    expect(canvasClientSource).toContain("context: textContext,");
    expect(canvasClientSource).toContain("prompt: requestPrompt,");
    expect(canvasClientSource).toContain(
      "sourceNodeIds: selectedTextReferenceNodeIds",
    );
  });

  it("keeps image source handles white in the dark theme", () => {
    expect(
      imageNodeSource.match(/className="zenme-image-source-handle"/g),
    ).toHaveLength(2);
    expect(globalStylesSource).toContain(
      "html.dark .zenme-canvas .zenme-image-source-handle",
    );
    expect(globalStylesSource).toContain(
      "background-color: #fff !important;",
    );
  });

  it("shows connected image and text nodes in both the reference bar and @ candidates", () => {
    expect(imageGenerationNodeSource).toContain("imageTextReferenceCandidates");
    expect(imageGenerationNodeSource).toContain("imageTextReferences");
    expect(imageGenerationNodeSource).toContain("toggleTextReference");
    expect(imageGenerationNodeSource).toContain("imageTextReferences");
    expect(imageGenerationNodeSource).not.toContain("showReferenceBar={false}");
  });

  it("keeps generated-image option pickers interactive outside the canvas node", () => {
    expect(imageNodeSource).toContain(
      "(selected || isModelPickerOpen || isCameraPickerOpen)",
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

  it("shows the original image resolution in the maximized preview", () => {
    expect(imageNodeSource).toContain("imageHeight={nodeData.imageHeight}");
    expect(imageNodeSource).toContain("imageWidth={nodeData.imageWidth}");
    expect(imageNodeSource).toContain("image.naturalWidth || image.width");
    expect(imageNodeSource).toContain("分辨率：</span>");
    expect(imageNodeSource).toContain(
      "`${resolution.width} × ${resolution.height} px`",
    );
  });

  it("switches the hovered camera-control column with a throttled mouse wheel", () => {
    expect(imageCameraControlSource).toContain("onWheel={handleWheel}");
    expect(imageCameraControlSource).toContain("event.preventDefault()");
    expect(imageCameraControlSource).toContain("event.stopPropagation()");
    expect(imageCameraControlSource).toContain(
      "now - lastWheelAt.current < 100",
    );
    expect(imageCameraControlSource).toContain(
      "cameraControlImagesPreloaded = true",
    );
    expect(imageCameraControlSource).toContain(
      "zenme-camera-wheel-transition",
    );
  });

  it("uses the text-node creation menu for image action handles", () => {
    expect(menuSource).toContain('actionNode?.data.kind === "image" ||');
    expect(menuSource).toContain("<NodeCreationMenuItems");
    expect(menuSource).toContain(
      'onCreateConnectedPlaceholder("imageGeneration")',
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

  it("does not expose internal prompt implementation details in the size picker", () => {
    expect(imageGenerationNodeSource).not.toContain(
      "尺寸选项会写入图片编辑 system prompt。",
    );
  });

  it("does not submit image generation when pressing Enter in the prompt", () => {
    expect(imageGenerationNodeSource).not.toContain(
      'event.key === "Enter" && !event.shiftKey',
    );
    expect(imageGenerationNodeSource).not.toContain(
      'closest("form")?.requestSubmit()',
    );
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

  it("keeps long image-generation prompts inside the node boundary", () => {
    expect(imageGenerationNodeSource).toContain(
      "flex h-full min-h-[176px] flex-col overflow-hidden rounded-xl",
    );
    expect(imageGenerationNodeSource).toContain(
      'className="relative min-h-0 flex-1"',
    );
    expect(imageGenerationNodeSource).toContain(
      "zenme-overlay-scroll-container ${viewportClassName",
    );
    expect(imageGenerationNodeSource).toContain(
      "zenme-text-ai-input nodrag nowheel absolute inset-0 overflow-auto",
    );
  });

  it("adds text-style expand and copy actions to image prompts", () => {
    expect(imageGenerationNodeSource).toContain(
      "aria-expanded={isPromptExpanded}",
    );
    expect(imageGenerationNodeSource).toContain(
      "nodeData.onToggleImagePromptExpanded?.(",
    );
    expect(imageGenerationNodeSource).toContain('title="复制提示词"');
    expect(imageGenerationNodeSource).toContain(
      "writeTextToClipboard(content)",
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

  it("turns the busy image action into an enabled stop control", () => {
    for (const source of [imageNodeSource, imageGenerationNodeSource]) {
      expect(source).toContain('"停止图片生成"');
      expect(source).toContain("nodeData.onStopImageGenerationNode?.(id)");
      expect(source).toContain('type={isSubmissionLocked ? "button" : "submit"}');
      expect(source).toContain("!isSubmissionLocked && (");
    }
    expect(canvasClientSource).toContain(
      'controller.abort(new DOMException("Image generation stopped", "AbortError"))',
    );
    expect(canvasClientSource).toContain(
      'status: timedOut ? "timedOut" : stopped ? "stopped" : "failed"',
    );
  });

  it("does not clear an already-selected reference when chosen from the picker", () => {
    expect(imageGenerationNodeSource).toContain(
      "if (!selected && !(mentionOnly && handled)) {",
    );
    expect(imageGenerationNodeSource).toContain(
      "toggleReference(candidate.nodeId);",
    );
    expect(imageGenerationNodeSource).toContain("setIsOpen(false);");
    expect(imageGenerationNodeSource).toContain(
      "onOpenChangeRef.current?.(true)",
    );
    expect(imageGenerationNodeSource).not.toContain(
      "onOpenChange?.(isOpen)",
    );
  });

  it("keeps top references separate from inline @ mentions", () => {
    expect(imageGenerationNodeSource).toContain("ImagePromptEditor");
    expect(imageGenerationNodeSource).toContain("dataset.imagePromptReferenceId");
    expect(imageGenerationNodeSource).toContain("mentionOnly");
    expect(imageGenerationNodeSource).toContain("onTextSelect");
    expect(imageGenerationNodeSource).toContain(
      "getTypedImageReferenceTriggerRange(range, editor)",
    );
    expect(imageGenerationNodeSource).toContain("onInput={handleInput}");
    expect(imageGenerationNodeSource).not.toContain("/(^|\\s)@$/");
    expect(canvasClientSource).toContain(
      "const normalizedPromptContent = normalizeImagePromptContent(",
    );
    expect(canvasClientSource).toContain("expandImagePromptMentions({");
    expect(canvasClientSource).toContain("mergeReferenceNodeIds(");
  });

  it("removes inline image references from either their hover action or Backspace", () => {
    expect(imageGenerationNodeSource).toContain('event.key === "Backspace"');
    expect(imageGenerationNodeSource).toContain(
      "getImagePromptReferenceBeforeCaret(range, editor)",
    );
    expect(imageGenerationNodeSource).toContain(
      "removeImagePromptReferenceChip(referenceChip, editor)",
    );
    expect(imageGenerationNodeSource).toContain("group-hover:flex");
    expect(imageGenerationNodeSource).toContain("删除引用：${reference.title}");
    expect(imageGenerationNodeSource).toContain(
      "removeImagePromptReferenceChip(chip, editor)",
    );
    expect(imageGenerationNodeSource).toContain(
      'editor.dispatchEvent(new Event("input", { bubbles: true }))',
    );
  });

  it("creates connected non-destructive image nodes from brush and crop tools", () => {
    expect(imageNodeSource).toContain('onEdit={() => setIsTransformOpen(true)}');
    expect(imageNodeSource).toContain('operation: "edit"');
    expect(imageNodeSource).not.toContain('aria-label="画笔标记"');
    expect(imageNodeSource).not.toContain('aria-label="裁剪图片"');
    expect(imageNodeSource).toContain("onCreateDerivedImageNode(id");
    expect(canvasClientSource).toContain("createDerivedImageChildCanvasNode({");
    expect(canvasClientSource).toContain("edges: [result.edge]");
    expect(canvasClientSource).toContain("nodes: [result.node]");
  });
});
