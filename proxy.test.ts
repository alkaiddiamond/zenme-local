import { describe, expect, it } from "vitest";

import { config } from "./proxy";

function isMatched(pathname: string) {
  const pattern = config.matcher[0];

  return new RegExp(`^${pattern}`).test(pathname);
}

describe("proxy matcher", () => {
  it("runs the auth proxy for application and API routes", () => {
    expect(isMatched("/")).toBe(true);
    expect(isMatched("/projects")).toBe(true);
    expect(isMatched("/projects/project-1")).toBe(true);
    expect(isMatched("/api/reading/assets")).toBe(true);
    expect(isMatched("/auth/login")).toBe(true);
  });

  it("skips Next internals and static image files", () => {
    expect(isMatched("/_next/static/chunk.js")).toBe(false);
    expect(isMatched("/_next/image?url=%2Fcover.png&w=640&q=75")).toBe(false);
    expect(isMatched("/favicon.ico")).toBe(false);
    expect(isMatched("/logo.svg")).toBe(false);
    expect(isMatched("/cover.webp")).toBe(false);
  });
});
