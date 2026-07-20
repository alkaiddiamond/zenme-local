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

  it.each([
    "智谱 GLM",
    "火山方舟 Agent Plan",
    "OpenRouter",
    "Ollama",
    "自定义",
  ])("offers the %s provider preset", (label) => {
    expect(source).toContain(`label: "${label}"`);
  });

  it("shows generic protocol controls only for custom providers", () => {
    expect(source).toContain("isCustomProvider ? (");
    expect(source).toContain("GENERIC_API_FORMAT_OPTIONS");
    expect(source).toContain('draft.authType === "none"');
  });

  it("configures network proxy independently for each provider", () => {
    expect(source).toContain("<ProviderProxyFields");
    expect(source).toContain("onEditProxyProvider");
    expect(source).toContain("NETWORK_PROXY_MODE_OPTIONS");
    expect(source).toContain("仅应用于当前服务商");
    expect(source).toContain("localhost、127.0.0.1 和 ::1 始终直连");
  });
});
