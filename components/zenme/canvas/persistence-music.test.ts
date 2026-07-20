import { describe, expect, it, vi } from "vitest";

import { getPersistableCanvasNodes } from "@/components/zenme/canvas/persistence";
import type { CanvasNode } from "@/components/zenme/canvas/types";

describe("music analysis canvas persistence", () => {
  it("removes transient multi-selection state from canvas snapshots", () => {
    const node: CanvasNode = {
      id: "text-1",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        isMultiSelection: true,
        kind: "text",
        title: "文本",
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.isMultiSelection).toBeUndefined();
  });

  it("persists the job reference without duplicating the full analysis result", () => {
    const node: CanvasNode = {
      id: "analysis-job-1",
      type: "musicAnalysis",
      position: { x: 100, y: 200 },
      data: {
        kind: "musicAnalysis",
        title: "分析结果",
        musicJobId: "job-1",
        musicJobStatus: "succeeded",
        musicAnalysisResult: { notes: Array.from({ length: 1_000 }, (_, index) => index) },
        onMusicAnalysisComplete: vi.fn(),
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.musicJobId).toBe("job-1");
    expect(persisted.data.musicJobStatus).toBe("succeeded");
    expect(persisted.data.musicAnalysisResult).toBeUndefined();
    expect(persisted.data.onMusicAnalysisComplete).toBeUndefined();
    expect(node.data.musicAnalysisResult).toBeDefined();
  });
});
