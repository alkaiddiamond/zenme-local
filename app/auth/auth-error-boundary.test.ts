import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("auth error boundary", () => {
  it("renders auth errors through the safe message mapper", () => {
    const pageSource = readProjectFile("app/auth/error/page.tsx");

    expect(pageSource).toContain("getAuthErrorMessage");
    expect(pageSource).not.toContain("Code error");
    expect(pageSource).not.toContain("An unspecified error occurred");
  });

  it("does not redirect raw Supabase auth messages into the URL", () => {
    const confirmRouteSource = readProjectFile("app/auth/confirm/route.ts");

    expect(confirmRouteSource).not.toContain("error.message");
    expect(confirmRouteSource).not.toContain("No token hash or type");
    expect(confirmRouteSource).toContain("confirm_link_invalid");
    expect(confirmRouteSource).toContain("confirm_link_missing");
  });

  it("sanitizes auth callback redirect targets", () => {
    const confirmRouteSource = readProjectFile("app/auth/confirm/route.ts");

    expect(confirmRouteSource).toContain("getSafeAuthRedirectPath");
    expect(confirmRouteSource).not.toContain('const next = searchParams.get("next")');
  });
});
