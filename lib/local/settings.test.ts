import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLocalSettings,
  getLocalSettingsPath,
  updateLocalSettings,
} from "@/lib/local/settings";
import { createVolcengineAgentPlanProvider } from "@/lib/ai/provider-presets";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-settings-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local settings", () => {
  it("returns defaults and persists updates to settings.json", async () => {
    await expect(getLocalSettings(dataDir)).resolves.toMatchObject({
      autoSaveIntervalMs: 5000,
      dataDir,
      modelProviders: expect.arrayContaining([
        expect.objectContaining({
          networkProxy: {
            mode: "environment",
            noProxy: "localhost,127.0.0.1,::1",
            url: "",
          },
        }),
      ]),
      version: 1,
    });

    const settings = await updateLocalSettings({
      autoSaveIntervalMs: 1000,
      lastImageAspectRatio: "auto",
      lastImageQuality: "1K",
      lastTextModelId: "glm-5.2",
    }, dataDir);

    expect(settings).toMatchObject({
      autoSaveIntervalMs: 5000,
      lastImageAspectRatio: "auto",
      lastImageQuality: "1K",
      lastTextModelId: "glm-5.2",
    });
    await expect(
      fs.readFile(getLocalSettingsPath(dataDir), "utf-8"),
    ).resolves.toContain('"lastTextModelId": "glm-5.2"');
    await expect(
      fs.readFile(getLocalSettingsPath(dataDir), "utf-8"),
    ).resolves.toContain('"lastImageAspectRatio": "auto"');
  });

  it("migrates a legacy global proxy to each provider", async () => {
    await fs.writeFile(
      getLocalSettingsPath(dataDir),
      JSON.stringify({
        version: 1,
        dataDir,
        autoSaveIntervalMs: 5000,
        networkProxy: {
          mode: "custom",
          url: "http://127.0.0.1:7890/",
          noProxy: "localhost,example.internal",
        },
        modelProviders: [
          {
            id: "provider",
            name: "Provider",
            baseUrl: "https://example.com/v1",
            apiFormat: "openai",
            authType: "bearer",
            enabled: true,
            modelMapping: { main: "" },
            models: [],
            contextWindows: {},
            modelModalities: {},
          },
        ],
      }),
    );

    const settings = await getLocalSettings(dataDir);
    expect(
      settings.modelProviders.find((provider) => provider.id === "provider")
        ?.networkProxy,
    ).toEqual({
      mode: "custom",
      url: "http://127.0.0.1:7890",
      noProxy: "localhost,example.internal",
    });
  });

  it("provides the Agent Plan language and image model preset", () => {
    const provider = createVolcengineAgentPlanProvider();

    expect(provider).toMatchObject({
      apiFormat: "volcengine_agent_plan",
      authType: "bearer",
      baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
      modelMapping: {
        image: "doubao-seedream-5.0-lite",
        main: "doubao-seed-2.0-pro",
      },
    });
    expect(provider.models.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        "ark-code-latest",
        "doubao-seed-2.0-pro",
        "glm-5.2",
        "deepseek-v4-pro",
        "kimi-k3",
        "doubao-embedding-vision",
        "doubao-seedream-5.0-lite",
      ]),
    );
  });

  it("migrates a legacy OpenAI Agent Plan provider and fills its documented models", async () => {
    await fs.writeFile(
      getLocalSettingsPath(dataDir),
      JSON.stringify({
        version: 1,
        dataDir,
        autoSaveIntervalMs: 5000,
        modelProviders: [
          {
            id: "legacy-agent-plan",
            name: "火山 AgentPlan",
            baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
            apiFormat: "openai",
            authType: "bearer",
            apiKey: "local-test-key",
            enabled: true,
            isDefault: false,
            modelMapping: { main: "" },
            models: [],
            contextWindows: {},
            modelModalities: {},
          },
        ],
      }),
    );

    const settings = await getLocalSettings(dataDir);
    const provider = settings.modelProviders.find(
      (item) => item.id === "legacy-agent-plan",
    );
    expect(provider).toMatchObject({
      apiFormat: "volcengine_agent_plan",
      apiKey: "local-test-key",
      modelMapping: {
        image: "doubao-seedream-5.0-lite",
        main: "doubao-seed-2.0-pro",
      },
    });
    expect(provider?.models.length).toBeGreaterThan(10);
  });

  it("recognizes a local Ollama OpenAI-compatible provider", async () => {
    await fs.writeFile(
      getLocalSettingsPath(dataDir),
      JSON.stringify({
        version: 1,
        dataDir,
        autoSaveIntervalMs: 5000,
        modelProviders: [
          {
            id: "local-models",
            name: "Local models",
            baseUrl: "http://localhost:11434/v1/",
            apiFormat: "openai",
            authType: "none",
            apiKey: "",
            enabled: true,
            isDefault: false,
            modelMapping: { main: "qwen3" },
            models: [
              {
                id: "qwen3",
                alias: "Qwen 3",
                enabled: true,
                modalities: ["text"],
              },
            ],
            contextWindows: {},
            modelModalities: { qwen3: ["text"] },
          },
        ],
      }),
    );

    const settings = await getLocalSettings(dataDir);
    const provider = settings.modelProviders.find(
      (item) => item.id === "local-models",
    );
    expect(provider).toMatchObject({
      apiFormat: "ollama",
      authType: "none",
      baseUrl: "http://localhost:11434/v1/",
      modelMapping: { main: "qwen3" },
    });
  });
});
