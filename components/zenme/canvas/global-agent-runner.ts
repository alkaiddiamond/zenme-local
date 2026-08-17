import {
  planGlobalAgentTasksFromApi,
  runGlobalOrchestrationFromApi,
} from "@/lib/zenme-api";

export async function planGlobalAgentTasks(input: {
  canvasContext: string;
  goal: string;
  model: string;
  projectId: string;
  signal?: AbortSignal;
}) {
  const result = await planGlobalAgentTasksFromApi(input);
  return result.tasks;
}

export function runGlobalOrchestration(input: {
  model: string;
  orchestrationId: string;
  projectId: string;
  signal?: AbortSignal;
}) {
  return runGlobalOrchestrationFromApi(input);
}
