import { validateLocalRequest } from "@/lib/api/local-access";
import { musicServiceRequest } from "@/lib/music/service-client";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { jobId } = await context.params;
  const response = await musicServiceRequest(
    `/v1/jobs/${encodeURIComponent(jobId)}/suno-prompt`,
    { method: "POST" },
  );
  return Response.json(await response.json(), { status: response.status });
}
