import { runAgentExecutionFromApi } from "@/lib/zenme-api";

/**
 * Starts or resumes an Agent Execution through the server-owned native tool
 * loop. The canvas intentionally does not parse model decisions or execute
 * tools itself; every entry point therefore shares the same permission,
 * command, background-task and ChangeSet runtime.
 */
export async function runWorkspaceAgent(input: {
  executionId: string;
  model: string;
  projectId: string;
  signal?: AbortSignal;
}) {
  return runAgentExecutionFromApi(input);
}
