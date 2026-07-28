import { validateLocalRequest } from "@/lib/api/local-access";
import { getLocalProjectFileSource } from "@/lib/local/project-files-repository";
import {
  LyricsLookupError,
  lookupLyrics,
  lookupLyricsByQuery,
  readTrackIdentity,
} from "@/lib/music/lyrics";

export async function POST(request: Request) {
  const denied = validateLocalRequest(request);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    if (typeof body?.projectId === "string" && typeof body.fileId === "string") {
      const source = await getLocalProjectFileSource({
        fileId: body.fileId,
        projectId: body.projectId,
        variant: "original",
      });
      if (!source) return Response.json({ error: "音乐文件不存在" }, { status: 404 });
      const identity = await readTrackIdentity(source.absolutePath);
      return Response.json(await lookupLyrics(identity));
    }
    if (typeof body?.title === "string" && typeof body.artist === "string") {
      if (!body.title.trim() || !body.artist.trim()) {
        return Response.json({ error: "请输入歌名和歌手" }, { status: 400 });
      }
      return Response.json(await lookupLyricsByQuery({
        artist: body.artist,
        title: body.title,
      }));
    }
    return Response.json({ error: "请输入歌名和歌手，或选择当前项目中的音乐文件" }, { status: 400 });
  } catch (error) {
    return Response.json({
      error: error instanceof LyricsLookupError ? error.publicMessage : "无法读取音乐信息或连接歌词来源",
    }, { status: 502 });
  }
}
