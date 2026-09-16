import { describe, expect, it } from "vitest";

import { createCenteredCropRect, mapClientPointToImage, normalizeCropRect } from "./image-transform";

describe("image transform geometry", () => {
  it("maps displayed pointer coordinates to original image pixels", () => {
    expect(mapClientPointToImage({
      bounds: { height: 250, left: 100, top: 50, width: 500 },
      clientX: 350,
      clientY: 175,
      imageHeight: 1000,
      imageWidth: 2000,
    })).toEqual({ x: 1000, y: 500 });
  });

  it("normalizes reverse crop gestures and clamps them to the image", () => {
    expect(normalizeCropRect(
      { x: 900, y: 700 },
      { x: -20, y: 100 },
      800,
      600,
    )).toEqual({ height: 500, width: 800, x: 0, y: 100 });
  });

  it("rejects empty crop selections", () => {
    expect(normalizeCropRect(
      { x: 10, y: 10 },
      { x: 10.5, y: 11 },
      100,
      100,
    )).toBeNull();
  });

  it.each([1, 16 / 9, 9 / 16, 4 / 3, 3 / 4])("locks crop gestures to ratio %s in either direction", (ratio) => {
    for (const end of [{ x: 760, y: 540 }, { x: -200, y: -100 }]) {
      const rect = normalizeCropRect({ x: 400, y: 300 }, end, 800, 600, ratio)!;
      expect(rect).not.toBeNull();
      expect(Math.abs(rect.width - rect.height * ratio)).toBeLessThanOrEqual(2);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(800);
      expect(rect.y + rect.height).toBeLessThanOrEqual(600);
    }
  });

  it("centers a preset within the existing crop without enlarging or moving it outside", () => {
    expect(createCenteredCropRect(800, 600, 1)).toEqual({ x: 100, y: 0, width: 600, height: 600 });
    expect(createCenteredCropRect(800, 600, 1, { x: 100, y: 100, width: 400, height: 200 })).toEqual({ x: 200, y: 100, width: 200, height: 200 });
  });
});
