import { validateLocalRequest } from "@/lib/api/local-access";
import { musicServiceRequest } from "@/lib/music/service-client";

export async function GET(
  request: Request,
  context: RouteContext<"/api/music/jobs/[jobId]/events">,
) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { jobId } = await context.params;
  const response = await musicServiceRequest(
    `/v1/jobs/${encodeURIComponent(jobId)}/events`,
    { headers: { accept: "text/event-stream" } },
  );
  if (!response.ok) {
    return Response.json(await response.json(), { status: response.status });
  }
  return new Response(response.body, {
    status: response.status,
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    },
  });
}
