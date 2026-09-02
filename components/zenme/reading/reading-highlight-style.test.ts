import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../../../app/globals.css", import.meta.url),
  "utf8",
);

describe("reading highlight focus style", () => {
  it("uses a subtle underline instead of a heavy black focus box", () => {
    const rule = styles.match(
      /\.zenme-note-focus-ring\s*\{(?<body>[\s\S]*?)\}/,
    )?.groups?.body;

    expect(rule).toContain("text-decoration-line: underline");
    expect(rule).toContain("outline: none");
    expect(rule).not.toContain("box-shadow");
    expect(rule).not.toContain("#18181b");
  });

  it("keeps selected PDF text transparent above the rendered canvas", () => {
    const selectionRule = styles.match(
      /\.zenme-pdf-text-layer ::selection\s*\{(?<body>[\s\S]*?)\}/,
    )?.groups?.body;
    const firefoxSelectionRule = styles.match(
      /\.zenme-pdf-text-layer ::-moz-selection\s*\{(?<body>[\s\S]*?)\}/,
    )?.groups?.body;

    expect(selectionRule).toContain("color: transparent");
    expect(firefoxSelectionRule).toContain("color: transparent");
  });
});
