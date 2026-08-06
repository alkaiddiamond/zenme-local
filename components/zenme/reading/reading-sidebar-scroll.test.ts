import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceSource = readFileSync(
  new URL("../reading-workspace.tsx", import.meta.url),
  "utf8",
);

describe("reading annotation sidebar position", () => {
  it("restores and saves the real scrollTop when a reader remounts", () => {
    expect(workspaceSource).toContain("readCachedReadingNotesScrollTop(assetId)");
    expect(workspaceSource).toContain(
      "notesList.scrollTop = notesScrollTopRef.current",
    );
    expect(workspaceSource).toContain(
      "saveReadingNotesScrollTop(assetId, notesScrollTopRef.current)",
    );
    expect(workspaceSource).toContain(
      "payload.progress?.notesScrollTop ?? 0",
    );
    expect(workspaceSource).toContain("onScroll={handleNotesScroll}");
  });

  it("keeps note sidebar actions stable while the active reading page changes", () => {
    expect(workspaceSource).toContain("activeSectionRef,");
    expect(workspaceSource).not.toContain("useReadingNotes({\n    activeSection,");
  });
});
