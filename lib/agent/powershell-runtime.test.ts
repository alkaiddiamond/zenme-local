import { describe, expect, it } from "vitest";

import { resolvePowerShellExecutable } from "@/lib/agent/powershell-runtime";

describe("resolvePowerShellExecutable", () => {
  it("prefers PowerShell 7 even when Windows PowerShell appears earlier on PATH", async () => {
    const existing = new Set([
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "C:\\Tools\\PowerShell\\pwsh.exe",
    ].map((candidate) => candidate.toLowerCase()));
    await expect(resolvePowerShellExecutable({
      Path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Tools\\PowerShell",
      SystemRoot: "C:\\Windows",
    }, "win32", async (candidate) => {
      if (!existing.has(candidate.toLowerCase())) throw new Error("missing");
    })).resolves.toBe("C:\\Tools\\PowerShell\\pwsh.exe");
  });

  it("falls back to the system Windows PowerShell executable", async () => {
    const fallback = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    await expect(resolvePowerShellExecutable({ SystemRoot: "C:\\Windows" }, "win32", async (candidate) => {
      if (candidate.toLowerCase() !== fallback.toLowerCase()) throw new Error("missing");
    })).resolves.toBe(fallback);
  });

  it("ignores an invalid override and keeps the safe PowerShell fallback", async () => {
    const fallback = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    await expect(resolvePowerShellExecutable({
      ZENME_POWERSHELL_PATH: "C:\\Tools\\cmd.exe",
      SystemRoot: "C:\\Windows",
    }, "win32", async (candidate) => {
      if (candidate.toLowerCase() !== fallback.toLowerCase()) throw new Error("missing");
    })).resolves.toBe(fallback);
  });
});
