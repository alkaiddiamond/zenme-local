import { describe, expect, it } from "vitest";

import {
  createProjectName,
  formatFileSize,
  getProjectActivityTime,
  type ZenmeProject,
} from "./zenme";

function project(overrides: Partial<ZenmeProject> = {}): ZenmeProject {
  return {
    id: "project-1",
    name: "项目",
    prompt: "prompt",
    model: "glm-4-flash",
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T02:00:00.000Z",
    ...overrides,
  };
}

describe("zenme project helpers", () => {
  it("uses the freshest project activity timestamp available", () => {
    expect(
      getProjectActivityTime(
        project({
          lastOpenedAt: "2026-06-28T05:00:00.000Z",
          lastSavedAt: "2026-06-28T04:00:00.000Z",
        }),
      ),
    ).toBe("2026-06-28T05:00:00.000Z");
    expect(
      getProjectActivityTime(
        project({ lastSavedAt: "2026-06-28T04:00:00.000Z" }),
      ),
    ).toBe("2026-06-28T04:00:00.000Z");
    expect(getProjectActivityTime(project())).toBe(
      "2026-06-28T02:00:00.000Z",
    );
    expect(
      getProjectActivityTime(
        project({ updatedAt: undefined as unknown as string }),
      ),
    ).toBe("2026-06-28T01:00:00.000Z");
  });

  it("creates display project names from prompts", () => {
    expect(createProjectName("   ")).toBe("未命名项目");
    expect(createProjectName("一个短提示")).toBe("一个短提示");
    expect(createProjectName("这是一个非常非常长的项目提示用于生成名称")).toBe(
      "这是一个非常非常长的项目提示用于生成...",
    );
  });

  it("formats file sizes for node metadata display", () => {
    expect(formatFileSize()).toBe("0 B");
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatFileSize(12 * 1024 * 1024)).toBe("12 MB");
    expect(formatFileSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});
