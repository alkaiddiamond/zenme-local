import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("./create-project-dialog.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");

describe("create project dialog", () => {
  it("requires a project name and a desktop-selected source folder", () => {
    expect(dialogSource).toContain('aria-label="项目名称"');
    expect(dialogSource).toContain("selectProjectWorkspace");
    expect(dialogSource).toContain("!name.trim() || !selection || busy");
    expect(dialogSource).toContain("createProjectWithWorkspace");
  });

  it("keeps folder authority behind an opaque one-time selection", () => {
    expect(dialogSource).toContain("selectionId: selection.selectionId");
    expect(dialogSource).not.toContain("rootPath:");
    expect(dialogSource).toContain("setSelection(null)");
  });

  it("uses the same modal from every app-shell new-project entry", () => {
    expect(shellSource).toContain("<CreateProjectDialog");
    expect(shellSource).toContain("setIsCreateProjectOpen(true)");
    expect(shellSource).toContain("OPEN_CREATE_PROJECT_DIALOG_EVENT");
  });
});
