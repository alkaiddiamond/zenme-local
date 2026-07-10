import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertSafePathSegment,
  createSafeFileName,
  resolveInside,
} from "@/lib/local/path-safety";

describe("local path safety", () => {
  it("rejects unsafe path segments", () => {
    expect(() => assertSafePathSegment("project-1")).not.toThrow();
    expect(() => assertSafePathSegment("..")).toThrow();
    expect(() => assertSafePathSegment("../x")).toThrow();
    expect(() => assertSafePathSegment("C:\\tmp")).toThrow();
    expect(() => assertSafePathSegment("\\\\server\\share")).toThrow();
  });

  it("keeps resolved paths inside the root", () => {
    const root = path.join(os.tmpdir(), "zenme-root");

    expect(resolveInside(root, "projects", "one")).toBe(
      path.resolve(root, "projects", "one"),
    );
    expect(() => resolveInside(root, "..", "escape")).toThrow();
  });

  it("creates display-safe local filenames", () => {
    expect(createSafeFileName("a/bad:name?.pdf")).toBe("bad_name_.pdf");
    expect(createSafeFileName("   ")).toBe("file");
  });
});

