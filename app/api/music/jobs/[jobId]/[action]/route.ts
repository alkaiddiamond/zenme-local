import { validateLocalRequest } from "@/lib/api/local-access";
import { musicServiceRequest } from "@/lib/music/service-client";

const ACTIONS = new Set(["cancel", "retry"]);
export async function POST(request: Request, context: RouteContext<"/api/music/jobs/[jobId]/[action]">) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { jobId, action } = await context.params;
  if (!ACTIONS.has(action)) return Response.json({ error: "无效操作" }, { status: 404 });
  const response = await musicServiceRequest(`/v1/jobs/${encodeURIComponent(jobId)}/${action}`, { method: "POST" });
  return Response.json(await response.json(), { status: response.status });
}
