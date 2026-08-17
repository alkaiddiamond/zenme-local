import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("./global-agent-dialog.tsx", import.meta.url), "utf8");
const nodeSource = readFileSync(new URL("./nodes/global-agent-node.tsx", import.meta.url), "utf8");

describe("Global Agent Workspace Root interaction", () => {
  it("loads readable roots and lets the user correct every planned task before dispatch", () => {
    expect(dialogSource).toContain("getWorkspaceBindingFromApi(projectId)");
    expect(dialogSource).toContain('root.status === "resolved" && root.permissions.read');
    expect(dialogSource).toContain("Workspace Root");
    expect(dialogSource).toContain("aria-label={`任务 ${index + 1} Workspace Root`}");
    expect(dialogSource).toContain("{ ...item, rootId: event.target.value }");
    expect(dialogSource).toContain("!hasValidTaskRoots");
  });

  it("keeps the selected root visible on the running orchestration node", () => {
    expect(nodeSource).toContain("task.rootDisplayName");
    expect(nodeSource).toContain("task.allowedPathPrefixes.join");
  });
});
