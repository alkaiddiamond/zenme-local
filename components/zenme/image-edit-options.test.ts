import { describe, expect, it } from "vitest";

import {
  buildImageEditSystemPrompt,
  buildImageGenerationSystemPrompt,
  getImageDisplaySize,
  getImageEditResultNodeSize,
} from "@/components/zenme/image-edit-options";

describe("image canvas display size", () => {
  it("uses the same size for uploaded and generated images with the same ratio", () => {
    expect(getImageDisplaySize(3 / 4)).toEqual(
      getImageEditResultNodeSize("3:4"),
    );
    expect(getImageDisplaySize(16 / 9)).toEqual(
      getImageEditResultNodeSize("16:9"),
    );
  });

  it("preserves non-standard ratios with a shared circumcircle", () => {
    const size = getImageDisplaySize(5 / 7);
    expect(size.width / size.height).toBeCloseTo(5 / 7, 2);
    expect(Math.hypot(size.width, size.height)).toBeCloseTo(
      Math.hypot(280, 280),
      0,
    );
  });

  it("keeps extreme ratios instead of clamping them", () => {
    const portrait = getImageDisplaySize(1 / 4);
    const landscape = getImageDisplaySize(4);
    expect(portrait.width / portrait.height).toBeCloseTo(1 / 4, 2);
    expect(landscape.width / landscape.height).toBeCloseTo(4, 2);
    expect(Math.hypot(portrait.width, portrait.height)).toBeCloseTo(
      Math.hypot(landscape.width, landscape.height),
      0,
    );
  });
});

describe("image system prompts", () => {
  it("forces generation and carries size requirements", () => {
    const prompt = buildImageGenerationSystemPrompt({ aspectRatio: "16:9", quality: "2K" });
    expect(prompt).toContain("必须调用创建图片功能");
    expect(prompt).toContain("16:9 横向构图");
    expect(prompt).toContain("最终输出画布必须严格符合 16:9 宽高比");
    expect(prompt).toContain("不得通过黑边、白边、透明边或空白留边");
    expect(prompt).toContain("2K 清晰度");
  });

  it("forces editing while preserving the reference subject", () => {
    const prompt = buildImageEditSystemPrompt({ aspectRatio: "3:4", quality: "1K" });
    expect(prompt).toContain("必须调用图片编辑功能");
    expect(prompt).toContain("局部修改时执行精确编辑");
    expect(prompt).toContain("以参考图为基础重新生成");
    expect(prompt).toContain("3:4 竖向构图");
    expect(prompt).toContain("最终输出画布必须严格符合 3:4 宽高比");
    expect(prompt).toContain("不得通过黑边、白边、透明边或空白留边");
  });

  it("preserves the source ratio when editing in adaptive mode", () => {
    const prompt = buildImageEditSystemPrompt({ aspectRatio: "auto", quality: "1K" });
    expect(prompt).toContain("保持参考图片的真实宽高比");
    expect(prompt).toContain("不得改用模型默认比例");
  });
});
