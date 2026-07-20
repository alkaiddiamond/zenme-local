import { describe, expect, it } from "vitest";

import {
  buildImageEditSystemPrompt,
  buildImageGenerationSystemPrompt,
  DEFAULT_IMAGE_CAMERA_CONTROL,
  getImageDisplaySize,
  getImageEditResultNodeSize,
  normalizeImageCameraControl,
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

  it("adds saved camera direction to generation prompts", () => {
    const prompt = buildImageGenerationSystemPrompt({
      aspectRatio: "16:9",
      cameraControl: DEFAULT_IMAGE_CAMERA_CONTROL,
      quality: "2K",
    });

    expect(prompt).toContain("摄影机与镜头指导");
    expect(prompt).toContain("Sony Venice");
    expect(prompt).toContain("Zeiss Ultra Prime");
    expect(prompt).toContain("125mm");
    expect(prompt).toContain("ƒ/11");
    expect(prompt).toContain("视角、透视压缩");
  });

  it("drops incomplete or unknown camera controls", () => {
    expect(normalizeImageCameraControl(DEFAULT_IMAGE_CAMERA_CONTROL)).toEqual(
      DEFAULT_IMAGE_CAMERA_CONTROL,
    );
    expect(
      normalizeImageCameraControl({
        ...DEFAULT_IMAGE_CAMERA_CONTROL,
        camera: "unknown-camera" as typeof DEFAULT_IMAGE_CAMERA_CONTROL.camera,
      }),
    ).toBeUndefined();
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

  it("binds multi-image edit roles to the input order", () => {
    const prompt = buildImageEditSystemPrompt({
      aspectRatio: "3:4",
      quality: "1K",
      referenceCount: 2,
    });

    expect(prompt).toContain("图片编号严格按照接口输入顺序");
    expect(prompt).toContain("第一张图片是主体底图");
    expect(prompt).toContain("第二张图片只提供被指定替换的局部元素");
    expect(prompt).toContain("不得融合、平均或互换不同参考图中的人物身份");
  });
});
