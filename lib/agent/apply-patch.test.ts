import { describe, expect, it } from "vitest";

import { applyPatchPaths, applyPatchToText, parseApplyPatchDocument } from "@/lib/agent/apply-patch";

describe("Agent apply_patch", () => {
  it("parses add, update, delete and move operations", () => {
    const patch = `*** Begin Patch
*** Add File: src/new.ts
+export const created = true;
*** Update File: src/a.ts
@@ -1,2 +1,2 @@
-export const value = 1;
+export const value = 2;
 export const keep = true;
*** Delete File: src/old.ts
*** Update File: src/from.ts
*** Move to: src/to.ts
*** End Patch`;

    expect(parseApplyPatchDocument(patch)).toMatchObject([
      { kind: "add", relativePath: "src/new.ts", content: "export const created = true;\n" },
      { kind: "update", relativePath: "src/a.ts" },
      { kind: "delete", relativePath: "src/old.ts" },
      { kind: "move", relativePath: "src/from.ts", targetRelativePath: "src/to.ts" },
    ]);
    expect(applyPatchPaths(patch)).toEqual(["src/new.ts", "src/a.ts", "src/old.ts", "src/from.ts", "src/to.ts"]);
  });

  it("applies multiple exact hunks while preserving CRLF and final newline", () => {
    const [operation] = parseApplyPatchDocument(`*** Begin Patch
*** Update File: src/a.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const a = 2;
 const b = 1;
@@ -4,1 +4,2 @@
 const d = 1;
+const e = 1;
*** End Patch`);
    if (operation.kind !== "update") throw new Error("unexpected operation");
    expect(applyPatchToText("const a = 1;\r\nconst b = 1;\r\nconst c = 1;\r\nconst d = 1;\r\n", operation.hunks, operation.relativePath))
      .toBe("const a = 2;\r\nconst b = 1;\r\nconst c = 1;\r\nconst d = 1;\r\nconst e = 1;\r\n");
  });

  it("rejects ambiguous or stale context", () => {
    const [ambiguous] = parseApplyPatchDocument(`*** Begin Patch
*** Update File: src/a.ts
@@
-same
+changed
*** End Patch`);
    if (ambiguous.kind !== "update") throw new Error("unexpected operation");
    expect(() => applyPatchToText("same\nother\nsame\n", ambiguous.hunks, ambiguous.relativePath)).toThrow("匹配多处");
    expect(() => applyPatchToText("different\n", ambiguous.hunks, ambiguous.relativePath)).toThrow("不一致");
  });

  it("rejects malformed, duplicate and combined move patches", () => {
    expect(() => parseApplyPatchDocument("*** Update File: a\n*** End Patch")).toThrow("Begin Patch");
    expect(() => parseApplyPatchDocument(`*** Begin Patch
*** Add File: a
+one
*** Delete File: a
*** End Patch`)).toThrow("重复操作路径");
    expect(() => parseApplyPatchDocument(`*** Begin Patch
*** Update File: a
*** Move to: b
@@
-one
+two
*** End Patch`)).toThrow("不能同时修改内容");
  });
});
