import { describe, expect, it, vi } from "vitest";

import { canvasToWebpBlob } from "./persistence";

describe("canvas thumbnail encoding", () => {
  it("encodes thumbnails as actual WebP blobs", async () => {
    const webp = new Blob(["webp"], { type: "image/webp" });
    const toBlob = vi.fn((callback: BlobCallback, type?: string, quality?: number) => {
      callback(webp);
      expect(type).toBe("image/webp");
      expect(quality).toBe(0.82);
    });

    await expect(
      canvasToWebpBlob({ toBlob } as unknown as HTMLCanvasElement),
    ).resolves.toBe(webp);
    expect(toBlob).toHaveBeenCalledOnce();
  });

  it("rejects an encoder fallback with the wrong MIME type", async () => {
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });

    await expect(
      canvasToWebpBlob({ toBlob } as unknown as HTMLCanvasElement),
    ).resolves.toBeNull();
  });
});
