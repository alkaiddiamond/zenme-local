/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertTargets,
  profiles,
  SIXTY_HZ_FRAME_BUDGET_MS,
  summarizeDurations,
} = require("./performance-packaged-app.cjs");

test("canvas performance profiles keep the agreed node and edge counts", () => {
  assert.deepEqual(profiles, {
    daily: { edgeCount: 150, nodeCount: 100 },
    large: { edgeCount: 750, nodeCount: 500 },
    pressure: { edgeCount: 2_000, nodeCount: 1_000 },
  });
});

test("canvas performance runner calculates frame percentiles", () => {
  assert.equal(SIXTY_HZ_FRAME_BUDGET_MS, 17);
  assert.deepEqual(summarizeDurations([10, 12, 16, 17, 60]), {
    averageMs: 23,
    frames: 5,
    maxMs: 60,
    p50Ms: 16,
    p95Ms: 60,
    p99Ms: 60,
  });
});

test("large canvas assertions reject missed frame and mount targets", () => {
  const scenario = {
    longTaskCount: 0,
    longTaskMaxMs: 0,
    nodeMounts: 0,
    nodeUnmounts: 0,
    p95Ms: 16,
  };
  assert.doesNotThrow(() =>
    assertTargets([{
      connect: scenario,
      nodeDrag: scenario,
      pan: scenario,
      profile: "large",
      resize: scenario,
      selection: scenario,
      zoom: scenario,
    }]),
  );
  assert.throws(
    () =>
      assertTargets([
        {
          connect: scenario,
          pan: { ...scenario, p95Ms: 24 },
          nodeDrag: scenario,
          profile: "large",
          resize: scenario,
          selection: scenario,
          zoom: scenario,
        },
      ]),
    /exceeds 17\.0ms/,
  );
});
