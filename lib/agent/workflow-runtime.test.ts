import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentWorkflowJournal } from "@/lib/agent/workflow-journal";
import { executeAgentWorkflow, prepareAgentWorkflow } from "@/lib/agent/workflow-runtime";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("agent workflow runtime", () => {
  it("requires a first-statement pure metadata literal", () => {
    expect(prepareAgentWorkflow(`export const meta = { name: "review", description: "Review files", phases: [{ title: "Inspect" }] };\nreturn 1;`))
      .toMatchObject({ ok: true, value: { meta: { name: "review", description: "Review files", phases: [{ title: "Inspect" }] } } });
    expect(prepareAgentWorkflow(`const value = "x"; export const meta = { name: value, description: "bad" };`))
      .toMatchObject({ ok: false });
    expect(prepareAgentWorkflow(`export const meta = { name: (() => "x")(), description: "bad" };`))
      .toMatchObject({ ok: false });
  });

  it("runs parallel agents with a bounded concurrency and preserves result order", async () => {
    const prepared = requirePrepared(`
export const meta = { name: "parallel_review", description: "Review in parallel", phases: [{ title: "Review" }] };
phase("Review");
const results = await parallel(args.map(item => () => agent("review " + item, { label: item })));
return results;
`);
    let active = 0;
    let maximumActive = 0;
    const events: string[] = [];
    const outcome = await executeAgentWorkflow({
      prepared,
      runId: "wf_parallel",
      args: ["a", "b", "c", "d"],
      concurrency: 2,
      onProgress: (event) => events.push(`${event.type}:${"state" in event ? event.state : ""}`),
      runAgent: async ({ prompt, index }) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, index % 2 === 0 ? 5 : 15));
        active -= 1;
        return { agentId: `agent-${index}`, value: prompt };
      },
    });

    expect(outcome).toMatchObject({ result: ["review a", "review b", "review c", "review d"], agentCount: 4, failures: [] });
    expect(maximumActive).toBe(2);
    expect(events.filter((event) => event === "workflow_agent:queued")).toHaveLength(4);
    expect(events.filter((event) => event === "workflow_agent:succeeded")).toHaveLength(4);
  });

  it("resumes the longest unchanged prefix from an append-only journal", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workflow-"));
    temporaryDirectories.push(directory);
    const journal = new AgentWorkflowJournal(path.join(directory, "journal.jsonl"));
    const firstScript = workflowScript(["one", "two", "three"]);
    const firstPrompts: string[] = [];
    await executeAgentWorkflow({
      prepared: requirePrepared(firstScript), runId: "wf_resume", journal,
      runAgent: async ({ prompt, index }) => { firstPrompts.push(prompt); return { agentId: `first-${index}`, value: `${prompt}-result` }; },
    });
    expect(firstPrompts).toEqual(["one", "two", "three"]);

    const snapshot = await journal.load();
    const resumedPrompts: string[] = [];
    const resumed = await executeAgentWorkflow({
      prepared: requirePrepared(workflowScript(["one", "changed", "three"])),
      runId: "wf_resume", journal, resumeSnapshot: snapshot,
      runAgent: async ({ prompt, index }) => { resumedPrompts.push(prompt); return { agentId: `second-${index}`, value: `${prompt}-result` }; },
    });
    expect(resumedPrompts).toEqual(["changed", "three"]);
    expect(resumed.result).toEqual(["one-result", "changed-result", "three-result"]);
  });

  it("withholds Node globals and blocks code generation and nondeterminism", async () => {
    const globals = await executeAgentWorkflow({
      prepared: requirePrepared(`export const meta = { name: "sandbox", description: "Sandbox" };\nreturn [typeof process, typeof require, typeof fetch];`),
      runId: "wf_sandbox",
      runAgent: async () => ({ value: null }),
    });
    expect(globals.result).toEqual(["undefined", "undefined", "undefined"]);

    for (const body of ["return eval('1 + 1');", "return Date.now();", "return Math.random();", "return await import('node:fs');"]) {
      const outcome = await executeAgentWorkflow({
        prepared: requirePrepared(`export const meta = { name: "blocked", description: "Blocked" };\n${body}`),
        runId: "wf_blocked",
        runAgent: async () => ({ value: null }),
      });
      expect(outcome.error).toBeTruthy();
    }
  });
});

function requirePrepared(script: string) {
  const prepared = prepareAgentWorkflow(script);
  if (!prepared.ok) throw new Error(prepared.error);
  return prepared.value;
}

function workflowScript(prompts: string[]) {
  return `export const meta = { name: "resume", description: "Resume" };\nconst values = [];\n${prompts.map((prompt) => `values.push(await agent(${JSON.stringify(prompt)}));`).join("\n")}\nreturn values;`;
}
