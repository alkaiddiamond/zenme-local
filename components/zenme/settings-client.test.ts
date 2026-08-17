import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./settings-client.tsx", import.meta.url),
  "utf8",
);

describe("model provider settings", () => {
  it("uses one provider menu instead of a separate Agent Plan action", () => {
    expect(source).toContain("MODEL_PROVIDER_PRESET_OPTIONS.map");
    expect(source).toContain("添加服务商");
    expect(source).not.toContain("添加 Agent Plan");
  });

  it.each(["ChatGPT", "Ollama", "自定义"])("offers the %s provider type", (label) => {
    expect(source).toContain(`label: "${label}"`);
  });

  it("describes custom providers by their compatible protocols", () => {
    expect(source).toContain('description: "兼容 OpenAI 或 Anthropic 协议接口"');
    expect(source).not.toContain("智谱、火山、OpenRouter 或其他兼容接口");
  });

  it("classifies hosted compatible services under the custom provider type", () => {
    const providerTypes = source.slice(
      source.indexOf("const MODEL_PROVIDER_PRESET_OPTIONS"),
      source.indexOf("const AUTH_TYPE_OPTIONS"),
    );

    expect(providerTypes).not.toContain('value: "zhipu"');
    expect(providerTypes).not.toContain('value: "volcengine_agent_plan"');
    expect(providerTypes).not.toContain('value: "openrouter"');
    expect(source).toContain(
      'const isCustomProvider = providerPreset === "custom"',
    );
    expect(source).toContain("CUSTOM_PROVIDER_API_FORMAT_OPTIONS");
    expect(source).toContain('label: "Zhipu GLM"');
    expect(source).toContain('label: "火山方舟 Agent Plan"');
    expect(source).toContain('label: "OpenRouter Images / Chat"');
    expect(source).toContain('draft.authType === "none"');
  });

  it("offers compatible-service presets inside the custom provider editor", () => {
    expect(source).toContain("CUSTOM_PROVIDER_PRESET_OPTIONS.map");
    expect(source).toContain("applyProviderPreset(option.value)");
    expect(source).toContain('{isNewProvider ? "添加服务商" : "编辑服务商"}');
    expect(source).toContain('["openai", "anthropic"].includes(option.value)');
  });

  it("configures network proxy independently for each provider", () => {
    expect(source).toContain("<ProviderProxyFields");
    expect(source).toContain("onEditProxyProvider");
    expect(source).toContain("NETWORK_PROXY_MODE_OPTIONS");
    expect(source).toContain("仅应用于当前服务商");
    expect(source).toContain("localhost、127.0.0.1 和 ::1 始终直连");
  });

  it("manages models directly without a separate model mapping section", () => {
    expect(source).not.toContain("文本模型映射");
    expect(source).not.toContain("图片模型映射");
    expect(source).not.toContain("用于标记该服务商的文本与图片处理入口");
    expect(source).toContain("模型列表");
    expect(source).toContain("添加模型");
    expect(source).toContain("拉取模型");
  });

  it("does not expose removed music analysis settings", () => {
    expect(source).not.toContain("音乐分析");
    expect(source).not.toContain("/api/music/health");
    expect(source).not.toContain("getMusicServiceStatus");
  });

  it("offers persistent light, black, warm eye-care, and system themes", () => {
    expect(source).toContain('label="通用"');
    expect(source).toContain('title="外观"');
    expect(source).toContain('label: "浅色"');
    expect(source).toContain('label: "黑色"');
    expect(source).toContain('label: "护眼"');
    expect(source).toContain('value: "warm"');
    expect(source).toContain('label: "跟随系统"');
    expect(source).toContain("announceThemePreference(nextTheme)");
    expect(source).toContain("persistSettings({ theme: nextTheme })");
  });

  it("places functional session defaults in General settings", () => {
    expect(source).toContain('title="默认会话权限"');
    expect(source).toContain('title="默认模型"');
    expect(source).toContain('title="推理强度"');
    expect(source).toContain('title="模型速度"');
    expect(source).toContain('{ value: "low", label: "轻" }');
    expect(source).toContain('{ value: "medium", label: "中" }');
    expect(source).toContain('{ value: "high", label: "高" }');
    expect(source).toContain('{ value: "xhigh", label: "极高" }');
    expect(source).not.toContain('{ value: "none", label: "无" }');
    expect(source).not.toContain('{ value: "max", label: "最大" }');
    expect(source).toContain('label="启用自动做梦"');
    expect(source).toContain("showAutoDreamConfirmation");
    expect(source).toContain("persistSettings({ defaultSessionPermissionMode: mode })");
    expect(source).toContain("defaultReasoningEffort: effort");
    expect(source).toContain("defaultModelSpeed: speed");
    expect(source).toContain('rememberAiModelPreference("text", modelId)');
    expect(source).toContain("persistSettings({ autoDreamEnabled: true })");
    expect(source).toContain('value: "untrusted", label: "不可信"');
    expect(source).toContain('value: "onRequest", label: "按请求"');
    expect(source).toContain('value: "neverAsk", label: "从不请求审批"');
    expect(source).not.toContain('value: "bypassPermissions"');
  });

  it("provides a cc-haha-compatible Agent plugin configuration surface", () => {
    expect(source).toContain('label="Agent 插件"');
    expect(source).toContain('fetch("/api/settings/agent-plugins"');
    expect(source).toContain("configuration.configuredKeys.includes(key)");
    expect(source).toContain("已配置；留空保持原值");
    expect(source).toContain("敏感字段独立保存在本地凭据文件中");
  });
});
