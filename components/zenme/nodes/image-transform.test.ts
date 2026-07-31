import { describe, expect, it } from "vitest";

import { mapClientPointToImage, normalizeCropRect } from "./image-transform";

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
});
