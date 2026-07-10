const AUTH_ERROR_MESSAGES: Record<string, string> = {
  confirm_link_invalid: "确认链接无效或已过期，请重新发起登录或注册流程。",
  confirm_link_missing: "确认链接缺少必要信息，请重新打开邮件中的完整链接。",
  supabase_config_missing: "当前部署缺少 Supabase 配置，请联系管理员检查环境变量。",
};

const AUTH_FORM_ERROR_PATTERNS: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "邮箱或密码不正确，请检查后重试。"],
  [/email not confirmed/i, "邮箱尚未确认，请先完成邮箱验证。"],
  [/user already registered|already registered/i, "该邮箱已经注册，请直接登录。"],
  [/password.*(?:at least|characters|weak)/i, "密码强度不足，请使用更长或更复杂的密码。"],
  [/rate limit|too many requests/i, "操作过于频繁，请稍后再试。"],
  [/signup.*disabled/i, "当前暂不开放注册，请稍后再试。"],
  [/token.*(?:expired|invalid)|invalid.*token/i, "登录或重置链接无效或已过期，请重新发起流程。"],
];

export function getAuthErrorMessage(errorCode?: string | null) {
  if (!errorCode) {
    return "认证流程发生错误，请稍后重试。";
  }

  return AUTH_ERROR_MESSAGES[errorCode] ?? "认证流程发生错误，请稍后重试。";
}

export function getAuthFormErrorMessage(
  error: unknown,
  fallback = "认证请求失败，请稍后重试。",
) {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const matched = AUTH_FORM_ERROR_PATTERNS.find(([pattern]) =>
    pattern.test(error.message),
  );

  return matched?.[1] ?? fallback;
}
