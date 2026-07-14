import { validateLocalRequest } from "@/lib/api/local-access";
import { musicServiceRequest } from "@/lib/music/service-client";

export async function GET(request: Request) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const response = await musicServiceRequest("/v1/capabilities");
  return Response.json(await response.json(), { status: response.status });
}
