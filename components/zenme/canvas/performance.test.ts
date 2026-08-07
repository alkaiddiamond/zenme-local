import { describe, expect, it } from "vitest";

import { summarizeCanvasFrameDurations } from "./performance";

describe("canvas performance metrics", () => {
  it("summarizes real frame gaps with percentiles and dropped frames", () => {
    expect(summarizeCanvasFrameDurations([10, 16, 17, 34, 60])).toEqual({
      averageFrameGap: 27.4,
      droppedFrameCount: 3,
      longFrameCount: 1,
      maxFrameGap: 60,
      p50FrameGap: 17,
      p95FrameGap: 60,
      p99FrameGap: 60,
    });
  });

  it("ignores invalid samples and handles an empty interaction", () => {
    expect(summarizeCanvasFrameDurations([Number.NaN, -1])).toEqual({
      averageFrameGap: 0,
      droppedFrameCount: 0,
      longFrameCount: 0,
      maxFrameGap: 0,
      p50FrameGap: 0,
      p95FrameGap: 0,
      p99FrameGap: 0,
    });
  });
});
