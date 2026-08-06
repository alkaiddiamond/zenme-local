import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loadingStateSource = readFileSync(
  new URL("./reading-workspace-state.tsx", import.meta.url),
  "utf8",
);
const payloadHookSource = readFileSync(
  new URL("./use-reading-payload.ts", import.meta.url),
  "utf8",
);

describe("reading payload loading progress", () => {
  it("shows determinate download progress and a separate parsing phase", () => {
    expect(loadingStateSource).toContain('role="progressbar"');
    expect(loadingStateSource).toContain("正在加载内容 ${percent}%");
    expect(loadingStateSource).toContain("下载完成，正在解析");
    expect(payloadHookSource).toContain("onProgress(progress)");
    expect(payloadHookSource).toContain("controller.abort()");
  });
});
