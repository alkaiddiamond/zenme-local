import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { generateConfiguredImage } = vi.hoisted(() => ({
  generateConfiguredImage: vi.fn(async () => ({
    b64Json: Buffer.from("generated-image").toString("base64"),
    mediaType: "image/png",
    model: "image-model",
    providerId: "provider",
    providerName: "Image Provider",
  })),
}));

vi.mock("@/lib/ai/image-generation-service", () => ({ generateConfiguredImage }));

import { editAgentImages, generateAgentImages } from "@/lib/agent/image-tools";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

let dataDir: string;
let workspaceRoot: string;
let projectId: string;

beforeEach(async () => {
  generateConfiguredImage.mockClear();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-image-data-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-image-workspace-"));
  projectId = (await createLocalProject({ name: "Images", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await Promise.all([
    fs.rm(dataDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 }),
    fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 }),
  ]);
});

describe("Agent image tools", () => {
  it("uses the configured image model and persists stable local result paths", async () => {
    const result = await generateAgentImages({
      count: 2,
      dataDir,
      executionId: "execution-1",
      projectId,
      prompt: "生成两个图标",
    });

    expect(generateConfiguredImage).toHaveBeenCalledTimes(2);
    expect(generateConfiguredImage.mock.calls[0]?.[0]).not.toHaveProperty("model");
    expect(result).toMatchObject({ operation: "generate", model: "image-model", provider: "Image Provider" });
    expect(result.images).toHaveLength(2);
    for (const image of result.images) {
      expect(path.isAbsolute(image.absolutePath)).toBe(true);
      expect(image.url).toContain(`/api/projects/${projectId}/agent-images/execution-1/`);
      await expect(fs.readFile(image.absolutePath, "utf8")).resolves.toBe("generated-image");
    }
  });

  it("accepts readable Workspace images for editing and rejects unrelated absolute paths", async () => {
    const referencePath = path.join(workspaceRoot, "reference.png");
    await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } })
      .png()
      .toFile(referencePath);

    await expect(editAgentImages({
      dataDir,
      executionId: "execution-2",
      projectId,
      prompt: "改为蓝色",
      referencedImagePaths: [referencePath],
    })).resolves.toMatchObject({ operation: "edit" });
    expect(generateConfiguredImage.mock.calls[0]?.[0].imageDataUrls?.[0]).toMatch(/^data:image\/png;base64,/);

    const outsidePath = path.join(dataDir, "outside.png");
    await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } })
      .png()
      .toFile(outsidePath);
    await expect(editAgentImages({
      dataDir,
      executionId: "execution-3",
      projectId,
      prompt: "继续编辑",
      referencedImagePaths: [outsidePath],
    })).rejects.toThrow("不在当前项目的可读 Workspace");
  });
});
