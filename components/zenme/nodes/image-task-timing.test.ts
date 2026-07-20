import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const timingSource = readFileSync(
  new URL("./image-task-timing.tsx", import.meta.url),
  "utf8",
);

describe("image task timing placement", () => {
  it("uses the same external top-right placement as AI response nodes", () => {
    expect(timingSource).toContain("absolute -top-8 right-1");
    expect(timingSource).not.toContain("right-3 top-3");
    expect(timingSource).not.toContain("rounded-full bg-white/90");
  });

  it("keeps both running and completed timing labels", () => {
    expect(timingSource).toContain(
      '{running ? "执行中 " : "耗时 "}',
    );
  });
});
