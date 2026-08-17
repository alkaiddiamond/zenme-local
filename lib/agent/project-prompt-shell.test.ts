import { describe, expect, it } from "vitest";

import {
  formatProjectPromptShellOutput,
  projectPromptShellMatches,
  substituteProjectPromptShellOutputs,
} from "@/lib/agent/project-prompt-shell";

describe("project prompt shell", () => {
  it("matches cc-haha block and inline syntax without consuming inline whitespace", () => {
    const text = "Before !`printf one` after\n```!\nprintf two\n```";
    const matches = projectPromptShellMatches(text);
    expect(matches.map((match) => match.command)).toEqual(["printf one", "printf two"]);
    expect(substituteProjectPromptShellOutputs(text, matches, ["ONE", "TWO"]))
      .toBe("Before ONE after\nTWO");
  });

  it("does not treat adjacent markdown or shell-variable text as an inline command", () => {
    expect(projectPromptShellMatches("`foo`!`bar` and $!`pid`")).toEqual([]);
  });

  it("formats stdout and stderr with cc-haha prompt semantics", () => {
    expect(formatProjectPromptShellOutput({ stdout: "ok\n", stderr: "warning\n" }))
      .toBe("ok\n[stderr]\nwarning");
  });
});
