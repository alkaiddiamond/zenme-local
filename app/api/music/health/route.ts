import { validateLocalRequest } from "@/lib/api/local-access";
import { musicServiceRequest } from "@/lib/music/service-client";

export async function GET(request: Request) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  try {
    const response = await musicServiceRequest("/v1/health");
    return Response.json(await response.json(), { status: response.status });
  } catch {
    return Response.json({ status: "unavailable", protocolVersion: 1 }, { status: 503 });
  }
}
