import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  areOverlayScrollbarMetricsEqual,
  getOverlayScrollbarMetrics,
} from "@/components/zenme/nodes/overlay-scrollbar";

const overlayScrollbarSource = readFileSync(
  new URL("./overlay-scrollbar.tsx", import.meta.url),
  "utf8",
);

describe("overlay scrollbar metrics", () => {
  it("stays hidden while all content fits", () => {
    expect(
      getOverlayScrollbarMetrics({
        clientSize: 200,
        scrollOffset: 0,
        scrollSize: 200,
      }),
    ).toEqual({ thumbOffset: 0, thumbSize: 0, visible: false });
  });

  it("sizes the thumb without changing the content viewport", () => {
    expect(
      getOverlayScrollbarMetrics({
        clientSize: 200,
        scrollOffset: 0,
        scrollSize: 400,
      }),
    ).toEqual({ thumbOffset: 0, thumbSize: 92, visible: true });
  });

  it("places the thumb at the end of the track at maximum scroll", () => {
    expect(
      getOverlayScrollbarMetrics({
        clientSize: 200,
        scrollOffset: 200,
        scrollSize: 400,
      }),
    ).toEqual({ thumbOffset: 92, thumbSize: 92, visible: true });
  });

  it("avoids updates while the measured scrollbar geometry is unchanged", () => {
    expect(
      areOverlayScrollbarMetricsEqual(
        { thumbOffset: 0, thumbSize: 92, visible: true },
        { thumbOffset: 0, thumbSize: 92, visible: true },
      ),
    ).toBe(true);
    expect(
      areOverlayScrollbarMetricsEqual(
        { thumbOffset: 0, thumbSize: 92, visible: true },
        { thumbOffset: 12, thumbSize: 92, visible: true },
      ),
    ).toBe(false);
  });

  it("defers content measurements and does not observe every text mutation", () => {
    expect(overlayScrollbarSource).toContain(
      'element.addEventListener("input", scheduleContentMetricsUpdate)',
    );
    expect(overlayScrollbarSource).toContain("CONTENT_MEASURE_DELAY");
    expect(overlayScrollbarSource).not.toContain("new MutationObserver");
  });
});
