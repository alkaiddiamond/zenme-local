import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";

import { prepareAgentWorkflow } from "@/lib/agent/workflow-runtime";
import type { AgentWorkflowMeta } from "@/lib/agent/workflow-types";
import { resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import {
  canUseWorkspaceRootCapability,
  listWorkspaceRoots,
  resolveWorkspaceRoot,
} from "@/lib/workspace/types";

const MAX_WORKFLOW_BYTES = 100_000;

export type ProjectWorkflowDefinition = {
  name: string;
  description: string;
  source: "project" | "user";
  script: string;
  filePath: string;
  rootId?: string;
  rootDisplayName?: string;
  primary?: boolean;
  meta: AgentWorkflowMeta;
};

export async function listProjectWorkflows(projectId: string, dataDir: string, requestedRootId?: string) {
  return discoverProjectWorkflows(projectId, dataDir, requestedRootId);
}

export async function findProjectWorkflow(input: {
  projectId: string;
  dataDir: string;
  name: string;
  rootId?: string;
}) {
  const requested = input.name.trim();
  assertWorkflowName(requested);
  return (await discoverProjectWorkflows(input.projectId, input.dataDir, input.rootId))
    .find((workflow) => workflow.name === requested);
}

async function discoverProjectWorkflows(projectId: string, dataDir: string, requestedRootId?: string) {
  const locations: Array<{
    directory: string;
    source: ProjectWorkflowDefinition["source"];
    rootId?: string;
    rootDisplayName?: string;
    primary?: boolean;
    priority: number;
  }> = [];
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const roots = binding
    ? requestedRootId
      ? [resolveWorkspaceRoot(binding, requestedRootId)].filter((root) => root && canUseWorkspaceRootCapability(root, "read"))
      : listWorkspaceRoots(binding).filter((root) => canUseWorkspaceRootCapability(root, "read"))
    : [];
  if (requestedRootId && roots.length === 0) throw new Error("Workspace Root 不存在或未授权读取");

  // User definitions are the fallback. Project definitions win, and .zenme
  // intentionally wins over the cc-haha-compatible .claude directory.
  locations.push({ directory: resolveInside(dataDir, "workflows"), source: "user", priority: 0 });
  for (const root of roots) {
    if (!root) continue;
    locations.push(
      {
        directory: path.join(root.realPath, ".claude", "workflows"),
        source: "project",
        rootId: root.id,
        rootDisplayName: root.displayName,
        primary: root.primary,
        priority: root.primary ? 20 : 10,
      },
      {
        directory: path.join(root.realPath, ".zenme", "workflows"),
        source: "project",
        rootId: root.id,
        rootDisplayName: root.displayName,
        primary: root.primary,
        priority: root.primary ? 40 : 30,
      },
    );
  }

  const discovered: Array<ProjectWorkflowDefinition & { priority: number }> = [];
  for (const location of locations) {
    let entries: Dirent[];
    try { entries = await fs.readdir(location.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if ((!entry.isFile() && !entry.isSymbolicLink()) || path.extname(entry.name).toLowerCase() !== ".js") continue;
      try {
        const realDirectory = await fs.realpath(location.directory);
        const realFile = await fs.realpath(path.join(location.directory, entry.name));
        if (!isInside(realDirectory, realFile)) continue;
        const stats = await fs.stat(realFile);
        if (!stats.isFile() || stats.size > MAX_WORKFLOW_BYTES) continue;
        const script = await fs.readFile(realFile, "utf8");
        const prepared = prepareAgentWorkflow(script);
        if (!prepared.ok) continue;
        discovered.push({
          name: prepared.value.meta.name,
          description: prepared.value.meta.description,
          source: location.source,
          script,
          filePath: realFile,
          rootId: location.rootId,
          rootDisplayName: location.rootDisplayName,
          primary: location.primary,
          meta: prepared.value.meta,
          priority: location.priority,
        });
      } catch {
        // Invalid, oversized and escaping scripts are not discoverable.
      }
    }
  }

  const byName = new Map<string, ProjectWorkflowDefinition & { priority: number }>();
  for (const workflow of discovered.sort((left, right) => left.priority - right.priority)) {
    byName.set(workflow.name, workflow);
  }
  return [...byName.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ priority, ...workflow }) => {
      void priority;
      return workflow;
    });
}

function assertWorkflowName(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw new Error("Workflow 名称无效");
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
