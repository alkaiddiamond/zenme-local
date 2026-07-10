import type { AgentMessage } from "@/components/zenme/agent-types";

import type { AgentSessionSnapshot } from "./types";

export function loadAgentSessionSnapshot(
  storageKey: string,
  fallbackModel: string,
  modelOptions: string[],
) {
  try {
    const stored = window.localStorage.getItem(storageKey);

    if (!stored) {
      return null;
    }

    const snapshot = JSON.parse(stored) as Partial<AgentSessionSnapshot>;

    if (snapshot.version !== 1) {
      return null;
    }

    return {
      input: typeof snapshot.input === "string" ? snapshot.input : "",
      messages: Array.isArray(snapshot.messages) ? snapshot.messages : [],
      model:
        typeof snapshot.model === "string" &&
        modelOptions.includes(snapshot.model)
          ? snapshot.model
          : fallbackModel,
    };
  } catch {
    return null;
  }
}

export function saveAgentSessionSnapshot(input: {
  key: string;
  messages: AgentMessage[];
  model: string;
  prompt: string;
}) {
  try {
    const snapshot: AgentSessionSnapshot = {
      version: 1,
      input: input.prompt,
      messages: input.messages,
      model: input.model,
      updatedAt: new Date().toISOString(),
    };

    window.localStorage.setItem(input.key, JSON.stringify(snapshot));
  } catch {
    // Agent 会话保存失败不影响画布操作。
  }
}
