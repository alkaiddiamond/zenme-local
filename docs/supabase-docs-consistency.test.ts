import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readDoc(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("Supabase documentation consistency", () => {
  it("does not describe local project mode as the current runtime", () => {
    const prd = readDoc("docs/prd.md");

    expect(prd).not.toContain("未登录时进入本地演示模式，项目和画布保存在浏览器本地。");
    expect(prd).not.toContain("未登录本地项目模式，登录后进入云端保存模式");
    expect(prd).toContain("当前项目运行态不再保留未登录本地项目模式");
  });

  it("does not claim browser E2E is complete before credentials exist", () => {
    const prd = readDoc("docs/prd.md");

    expect(prd).not.toContain("已通过真实登录态 E2E 验证");
    expect(prd).toContain("真实登录态 E2E 仍待执行");
  });

  it("keeps reading runtime documented as Supabase-backed", () => {
    const readingDoc = readDoc("docs/阅读体系需求文档.md");

    expect(readingDoc).toContain("当前项目/阅读运行态已收口到 Supabase");
    expect(readingDoc).toContain("旧 SQLite repository 不再作为运行态实现");
    expect(readingDoc).not.toContain("未登录本地演示模式也支持阅读体系");
  });
});
