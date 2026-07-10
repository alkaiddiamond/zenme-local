import { describe, expect, it } from "vitest";

import { getReadingApiErrorMessage } from "./api-errors";

describe("reading API error messages", () => {
  it("keeps ordinary domain errors user-facing", () => {
    expect(
      getReadingApiErrorMessage(new Error("不支持的阅读文件类型"), "读取失败"),
    ).toBe("不支持的阅读文件类型");
  });

  it("redacts invalid local storage paths", () => {
    expect(
      getReadingApiErrorMessage(
        new Error(
          "Invalid key: e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c-地师.epub",
        ),
        "阅读资料登记失败",
      ),
    ).toBe("阅读资料存储路径无效，请重新上传文件");
  });

  it("uses the route fallback when storage paths appear in generic errors", () => {
    expect(
      getReadingApiErrorMessage(
        new Error(
          "Object e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub is missing",
        ),
        "文件读取失败",
      ),
    ).toBe("文件读取失败");
  });

  it("uses the route fallback for generic repository or database errors", () => {
    expect(
      getReadingApiErrorMessage(
        new Error("database host internal.example leaked"),
        "阅读资料加载失败",
      ),
    ).toBe("阅读资料加载失败");
  });

  it("uses the route fallback for non-error values", () => {
    expect(getReadingApiErrorMessage("boom", "资源读取失败")).toBe("资源读取失败");
  });
});
