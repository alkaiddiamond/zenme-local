import { validateLocalRequest } from "@/lib/api/local-access";
import { getLocalProjectFileSource } from "@/lib/local/project-files-repository";
import { LyricsLookupError, lookupLyrics, readTrackIdentity } from "@/lib/music/lyrics";

export async function POST(request: Request) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (typeof body?.projectId !== "string" || typeof body.fileId !== "string") {
    return Response.json({ error: "必须选择当前项目中的音乐文件" }, { status: 400 });
  }
  const source = await getLocalProjectFileSource({
    fileId: body.fileId,
    projectId: body.projectId,
    variant: "original",
  });
  if (!source) return Response.json({ error: "音乐文件不存在" }, { status: 404 });
  try {
    const identity = await readTrackIdentity(source.absolutePath);
    return Response.json(await lookupLyrics(identity));
  } catch (error) {
    return Response.json({
      error: error instanceof LyricsLookupError ? error.publicMessage : "无法读取音乐信息或连接歌词来源",
    }, { status: 502 });
  }
}
