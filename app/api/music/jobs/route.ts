import { validateLocalRequest } from "@/lib/api/local-access";
import { musicServiceRequest } from "@/lib/music/service-client";
import { listLocalProjectFiles } from "@/lib/local/project-files-repository";
import { getProjectDir } from "@/lib/local/data-dir";
import { resolveInside } from "@/lib/local/path-safety";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function POST(request: Request) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  if (typeof body.projectId === "string" && typeof body.fileId === "string") {
    const record = (await listLocalProjectFiles(body.projectId)).find((item) => item.id === body.fileId);
    if (!record) return Response.json({ error: "音乐文件不存在" }, { status: 404 });
    const inputPath = resolveInside(getProjectDir(body.projectId), record.originalPath);
    body.inputPath = inputPath;
    body.inputSha256 = await sha256File(inputPath);
    delete body.fileId;
  } else {
    return Response.json({ error: "必须选择当前项目中的音乐文件" }, { status: 400 });
  }
  const response = await musicServiceRequest("/v1/jobs", {
    method: "POST", body: JSON.stringify(body),
  });
  return Response.json(await response.json(), { status: response.status });
}

async function sha256File(inputPath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(inputPath)) hash.update(chunk);
  return hash.digest("hex");
}
