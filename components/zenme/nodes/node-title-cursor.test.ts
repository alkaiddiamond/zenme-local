import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);
const editableTitleSource = readFileSync(
  new URL("./editable-node-title.tsx", import.meta.url),
  "utf8",
);

describe("node title cursor", () => {
  it("uses the shared title bar for editable node titles", () => {
    expect(editableTitleSource).toContain("zenme-node-title-bar");
  });

  it("shows grab and grabbing cursors over the node icon and type name", () => {
    expect(globalStyles).toContain(
      ".zenme-canvas .zenme-node-title-bar *",
    );
    expect(globalStyles).toContain("cursor: grab !important;");
    expect(globalStyles).toContain("cursor: grabbing !important;");
    expect(editableTitleSource).not.toContain(
      'className="nodrag max-w-52',
    );
  });

  it("keeps the text cursor while renaming a node", () => {
    expect(globalStyles).toContain(
      ".zenme-canvas .zenme-node-title-bar input",
    );
    expect(globalStyles).toContain("cursor: text !important;");
  });
});
