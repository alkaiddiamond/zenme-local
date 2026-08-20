import { describe, expect, it } from "vitest";

import { decodeCommandOutput } from "@/lib/agent/command-output-decoder";

describe("decodeCommandOutput", () => {
  it("preserves UTF-8 characters split across process chunks", () => {
    const encoded = Buffer.from("执行完成", "utf8");
    expect(decodeCommandOutput([
      encoded.subarray(0, 2),
      encoded.subarray(2, 7),
      encoded.subarray(7),
    ])).toBe("执行完成");
  });

  it("decodes Windows GBK output through the GB18030 superset", () => {
    expect(decodeCommandOutput(
      [Buffer.from([0xb2, 0xe2, 0xca, 0xd4])],
      { platform: "win32" },
    )).toBe("测试");
  });

  it("holds an incomplete trailing UTF-8 character while a task is running", () => {
    const encoded = Buffer.from("执行", "utf8");
    expect(decodeCommandOutput(
      [encoded.subarray(0, encoded.length - 1)],
      { final: false, platform: "win32" },
    )).toBe("执");
  });

  it("decodes PowerShell-style UTF-16LE output", () => {
    const payload = Buffer.from("构建成功", "utf16le");
    expect(decodeCommandOutput([Buffer.concat([Buffer.from([0xff, 0xfe]), payload])])).toBe("构建成功");
  });
});
