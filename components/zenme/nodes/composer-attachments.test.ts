import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImagePreview } from "@/components/zenme/canvas/files";
import { registerReadingAsset } from "@/components/zenme/canvas/reading-assets";
import { composerAttachmentPayload, mergeComposerReadingAssets, prepareComposerAttachment, validateComposerAttachments } from "./composer-attachments";

vi.mock("@/components/zenme/canvas/files", async (original) => ({
  ...await original<typeof import("@/components/zenme/canvas/files")>(),
  createImagePreview: vi.fn(),
}));
vi.mock("@/components/zenme/canvas/reading-assets", () => ({ registerReadingAsset: vi.fn() }));

describe("node composer attachments", () => {
  beforeEach(() => vi.resetAllMocks());

  it("prepares images and documents through existing Agent attachment channels", async () => {
    vi.mocked(createImagePreview).mockResolvedValue({ dataUrl: "data:image/webp;base64,YQ==", blob: new Blob(), width: 1, height: 1 });
    vi.mocked(registerReadingAsset).mockResolvedValue({ id: "reading-1" } as Awaited<ReturnType<typeof registerReadingAsset>>);
    const image = new File(["image"], "shot.png", { type: "image/png" });
    const document = new File(["hello"], "notes.txt", { type: "text/plain" });
    const context = { projectId: "project", nodeId: "node" };
    const files = [image, document];
    expect(() => validateComposerAttachments(files, [])).not.toThrow();
    const attachments = await Promise.all(files.map((file) => prepareComposerAttachment(file, context)));
    expect(registerReadingAsset).toHaveBeenCalledWith({ ...context, file: document, fileName: "notes.txt" });
    expect(composerAttachmentPayload(attachments)).toEqual({ imageDataUrls: ["data:image/webp;base64,YQ=="], readingAssetIds: ["reading-1"] });
    expect(composerAttachmentPayload(attachments.filter((item) => item.kind !== "image"))).toEqual({ imageDataUrls: [], readingAssetIds: ["reading-1"] });
  });

  it("rejects unsupported files and excess attachments without silently truncating", () => {
    expect(() => validateComposerAttachments([new File(["x"], "program.exe")], [])).toThrow("不支持附件");
    expect(() => validateComposerAttachments(Array.from({ length: 5 }, () => new File(["x"], "x.txt")), [])).toThrow("4 个文档");
    expect(() => validateComposerAttachments(Array.from({ length: 5 }, () => new File(["x"], "x.png", { type: "image/png" })), [])).toThrow("4 张图片");
    expect(() => validateComposerAttachments([new File(["x"], "x.txt")], [{ id: "old", kind: "document", readingAssetId: "old", name: "old.txt", size: 32 * 1024 * 1024 }])).toThrow("32 MB");
  });

  it("surfaces failed uploads for retry instead of returning an empty attachment", async () => {
    vi.mocked(registerReadingAsset).mockRejectedValue(new Error("upload failed"));
    await expect(prepareComposerAttachment(new File(["x"], "x.txt"), { projectId: "p", nodeId: "n" })).rejects.toThrow("upload failed");
  });

  it("merges new and upstream documents without losing either and preserves the limit", () => {
    expect(mergeComposerReadingAssets(["upstream"], ["attached", "upstream"])).toEqual(["upstream", "attached"]);
    expect(() => mergeComposerReadingAssets(["1", "2", "3", "4"], ["5"])).toThrow("合计不能超过 4 个");
  });
});
