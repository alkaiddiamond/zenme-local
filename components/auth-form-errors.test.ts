import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();
const AUTH_FORM_FILES = [
  "components/login-form.tsx",
  "components/sign-up-form.tsx",
  "components/forgot-password-form.tsx",
  "components/update-password-form.tsx",
];

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("auth form error handling", () => {
  it("maps Supabase auth form errors instead of echoing raw messages", () => {
    const rawMessageUsages = AUTH_FORM_FILES.flatMap((filePath) => {
      const source = readProjectFile(filePath);

      return source.includes("error.message") ? [filePath] : [];
    });

    expect(rawMessageUsages).toEqual([]);
  });

  it("uses the shared safe auth form error mapper", () => {
    const missingMapper = AUTH_FORM_FILES.filter(
      (filePath) => !readProjectFile(filePath).includes("getAuthFormErrorMessage"),
    );

    expect(missingMapper).toEqual([]);
  });
});
