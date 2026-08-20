import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./workspace-binding-dialog.tsx", import.meta.url), "utf8");

describe("workspace binding Git permissions", () => {
  it("shows and confirms the explicit Git-write capability", () => {
    expect(source).toContain("setProjectWorkspaceGitWriteAccess");
    expect(source).toContain("confirmGitWriteCapability");
    expect(source).toContain("启用 Git 写操作");
    expect(source).toContain("关闭 Git 写操作");
    expect(source).toContain('binding.permissions.gitWrite ? "已允许" : "未授权"');
  });
});
