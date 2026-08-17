import { describe, expect, it } from "vitest";

import { parseWorkflowStructuredResult } from "@/lib/agent/workflow-runner";

describe("workflow structured result", () => {
  const schema = {
    type: "object",
    properties: {
      summary: { type: "string", minLength: 1 },
      files: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "files"],
    additionalProperties: false,
  } as const;

  it("returns a parsed value only when it satisfies the declared JSON Schema", () => {
    expect(parseWorkflowStructuredResult('{"summary":"done","files":["a.ts"]}', schema))
      .toEqual({ summary: "done", files: ["a.ts"] });
  });

  it("rejects malformed JSON and schema mismatches with actionable errors", () => {
    expect(() => parseWorkflowStructuredResult("not-json", schema))
      .toThrow("未返回有效 JSON");
    expect(() => parseWorkflowStructuredResult('{"summary":"done","files":"a.ts"}', schema))
      .toThrow(/不符合 JSON Schema.*files.*array/);
  });

  it("rejects an invalid workflow schema instead of silently accepting it", () => {
    expect(() => parseWorkflowStructuredResult("{}", { type: "not-a-json-schema-type" }))
      .toThrow("Workflow JSON Schema 无效");
  });
});
