import { describe, expect, it } from "vitest";

import { isAgentShellConcurrencySafe } from "@/lib/agent/shell-concurrency";

describe("isAgentShellConcurrencySafe", () => {
  it("allows explicit read-only Git inspection commands", () => {
    expect(isAgentShellConcurrencySafe({ executable: "git", args: ["status", "--short"], reason: "检查状态" }))
      .toBe(true);
    expect(isAgentShellConcurrencySafe({ executable: "git.exe", args: ["diff", "--stat"], reason: "检查差异" }))
      .toBe(true);
  });

  it("serializes commands that can mutate state or execute arbitrary code", () => {
    expect(isAgentShellConcurrencySafe({ executable: "git", args: ["reset", "--hard"], reason: "重置" }))
      .toBe(false);
    expect(isAgentShellConcurrencySafe({ executable: "node", args: ["-e", "process.exit()"], reason: "执行脚本" }))
      .toBe(false);
    expect(isAgentShellConcurrencySafe({ executable: "rg", args: ["x", ">", "result.txt"], reason: "写结果" }))
      .toBe(false);
    expect(isAgentShellConcurrencySafe({ executable: "git", args: ["status"], run_in_background: true, reason: "后台检查" }))
      .toBe(false);
  });

  it("serializes compound scripts on every platform", () => {
    expect(isAgentShellConcurrencySafe({ command: "rg TODO .; git status --short", reason: "复合检查" }))
      .toBe(false);
  });
});
