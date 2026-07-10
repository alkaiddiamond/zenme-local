import { describe, expect, it } from "vitest";

import {
  getAuthErrorMessage,
  getAuthFormErrorMessage,
} from "./auth-error-message";

describe("auth error messages", () => {
  it("maps known auth error codes to safe user-facing messages", () => {
    expect(getAuthErrorMessage("supabase_config_missing")).toBe(
      "当前部署缺少 Supabase 配置，请联系管理员检查环境变量。",
    );
    expect(getAuthErrorMessage("confirm_link_missing")).toBe(
      "确认链接缺少必要信息，请重新打开邮件中的完整链接。",
    );
    expect(getAuthErrorMessage("confirm_link_invalid")).toBe(
      "确认链接无效或已过期，请重新发起登录或注册流程。",
    );
  });

  it("does not echo unknown error values", () => {
    expect(getAuthErrorMessage("Database password leaked")).toBe(
      "认证流程发生错误，请稍后重试。",
    );
    expect(getAuthErrorMessage()).toBe("认证流程发生错误，请稍后重试。");
  });

  it("maps common Supabase auth form errors to safe Chinese messages", () => {
    expect(getAuthFormErrorMessage(new Error("Invalid login credentials"))).toBe(
      "邮箱或密码不正确，请检查后重试。",
    );
    expect(getAuthFormErrorMessage(new Error("Email not confirmed"))).toBe(
      "邮箱尚未确认，请先完成邮箱验证。",
    );
    expect(getAuthFormErrorMessage(new Error("User already registered"))).toBe(
      "该邮箱已经注册，请直接登录。",
    );
    expect(
      getAuthFormErrorMessage(new Error("Password should be at least 6 characters")),
    ).toBe("密码强度不足，请使用更长或更复杂的密码。");
  });

  it("does not echo unknown auth form errors", () => {
    expect(getAuthFormErrorMessage(new Error("raw provider failure"))).toBe(
      "认证请求失败，请稍后重试。",
    );
    expect(getAuthFormErrorMessage("boom")).toBe("认证请求失败，请稍后重试。");
  });
});
