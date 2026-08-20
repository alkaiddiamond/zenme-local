import { describe, expect, it } from "vitest";

import { analyzePowerShellCommand } from "@/lib/agent/powershell-command-analysis";

const windowsIt = process.platform === "win32" ? it : it.skip;

describe("analyzePowerShellCommand", () => {
  windowsIt("collects every command in a pipeline and compound statement", async () => {
    const result = await analyzePowerShellCommand("Get-ChildItem . | Select-Object -First 1; Stop-Process -Id 12");
    expect(result).toMatchObject({ valid: true });
    expect(result?.commands.map((command) => command.name)).toEqual(["Get-ChildItem", "Select-Object", "Stop-Process"]);
  });

  windowsIt("reports dynamic invocation and redirection security signals", async () => {
    const dynamic = await analyzePowerShellCommand("& $command");
    expect(dynamic).toMatchObject({ valid: true });
    expect(dynamic?.commands[0]).toMatchObject({ name: null, invocationOperator: "Ampersand" });

    const redirected = await analyzePowerShellCommand("Get-Content .\\input.txt > ..\\outside.txt");
    expect(redirected?.redirections).toHaveLength(1);
  });

  windowsIt("fails closed for malformed PowerShell", async () => {
    await expect(analyzePowerShellCommand("Get-ChildItem {")).resolves.toMatchObject({ valid: false });
  });
});
