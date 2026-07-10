import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("auth email redirect configuration", () => {
  it("routes sign-up confirmation emails through the auth confirm handler", () => {
    const source = readProjectFile("components/sign-up-form.tsx");

    expect(source).toContain("/auth/confirm?next=/");
    expect(source).not.toContain("emailRedirectTo: `${window.location.origin}/`,");
  });

  it("routes password recovery emails through the auth confirm handler", () => {
    const source = readProjectFile("components/forgot-password-form.tsx");

    expect(source).toContain("/auth/confirm?next=/auth/update-password");
    expect(source).not.toContain(
      "redirectTo: `${window.location.origin}/auth/update-password`,",
    );
  });
});
