import { existsSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("auth product redirects", () => {
  it("keeps password reset users in the Zenme product flow", () => {
    const source = readProjectFile("components/update-password-form.tsx");

    expect(source).toContain('router.push("/")');
    expect(source).not.toContain('router.push("/protected")');
  });

  it("does not ship the Supabase starter protected page", () => {
    const protectedPage = readProjectFile("app/protected/page.tsx");
    const protectedLayoutPath = path.join(ROOT_DIR, "app/protected/layout.tsx");

    expect(protectedPage).toContain('redirect("/")');
    expect(protectedPage).not.toContain("Next.js Supabase Starter");
    expect(protectedPage).not.toContain("This is a protected page");
    expect(existsSync(protectedLayoutPath)).toBe(false);
  });
});
