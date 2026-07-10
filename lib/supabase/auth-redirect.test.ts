import { describe, expect, it } from "vitest";

import { getSafeAuthRedirectPath } from "./auth-redirect";

describe("auth redirect paths", () => {
  it("allows same-origin relative paths", () => {
    expect(getSafeAuthRedirectPath("/")).toBe("/");
    expect(getSafeAuthRedirectPath("/projects")).toBe("/projects");
    expect(getSafeAuthRedirectPath("/projects/abc?tab=canvas#top")).toBe(
      "/projects/abc?tab=canvas#top",
    );
  });

  it("falls back for missing or external redirects", () => {
    expect(getSafeAuthRedirectPath()).toBe("/");
    expect(getSafeAuthRedirectPath("https://evil.example")).toBe("/");
    expect(getSafeAuthRedirectPath("//evil.example/path")).toBe("/");
    expect(getSafeAuthRedirectPath("javascript:alert(1)")).toBe("/");
  });

  it("falls back for malformed relative redirects", () => {
    expect(getSafeAuthRedirectPath("/\\evil.example")).toBe("/");
    expect(getSafeAuthRedirectPath("/projects/\u0000bad")).toBe("/");
  });
});
