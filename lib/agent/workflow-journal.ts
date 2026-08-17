import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type AgentWorkflowJournalEntry =
  | { type: "started"; key: string; agentId: string }
  | { type: "result"; key: string; agentId: string; result: unknown };

export type AgentWorkflowJournalSnapshot = {
  results: Map<string, { agentId: string; result: unknown }>;
  started: Map<string, string[]>;
};

export class AgentWorkflowJournal {
  private writeChain = Promise.resolve();

  constructor(readonly filePath: string) {}

  async append(entry: AgentWorkflowJournalEntry) {
    const line = `${safeWorkflowStringify(entry)}\n`;
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, line, "utf8");
    });
    return this.writeChain;
  }

  async flush() {
    await this.writeChain;
  }

  async load(): Promise<AgentWorkflowJournalSnapshot> {
    const snapshot: AgentWorkflowJournalSnapshot = { results: new Map(), started: new Map() };
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return snapshot;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: AgentWorkflowJournalEntry;
      try {
        entry = JSON.parse(line) as AgentWorkflowJournalEntry;
      } catch {
        continue;
      }
      if (!entry || typeof entry.key !== "string" || typeof entry.agentId !== "string") continue;
      if (entry.type === "result") {
        snapshot.results.set(entry.key, { agentId: entry.agentId, result: entry.result });
        snapshot.started.delete(entry.key);
      } else if (entry.type === "started" && !snapshot.results.has(entry.key)) {
        snapshot.started.set(entry.key, [...(snapshot.started.get(entry.key) ?? []), entry.agentId]);
      }
    }
    return snapshot;
  }
}

export function createAgentWorkflowJournalEntryId() {
  return `workflow_agent_${crypto.randomUUID()}`;
}

export function agentWorkflowCacheKey(prompt: string, options: unknown, previousKey: string) {
  return crypto.createHash("sha256")
    .update(previousKey)
    .update("\0")
    .update(prompt)
    .update("\0")
    .update(safeWorkflowStringify(options ?? null))
    .digest("hex");
}

export function safeWorkflowStringify(value: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "function") return undefined;
    if (item !== null && typeof item === "object") {
      if (seen.has(item)) return "[Circular]";
      seen.add(item);
    }
    return item;
  }) ?? "null";
}
