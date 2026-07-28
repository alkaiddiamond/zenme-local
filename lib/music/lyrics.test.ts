import { describe, expect, it, vi } from "vitest";

import {
  lookupLyrics,
  lookupLyricsByQuery,
  parseSyncedLyrics,
  type TrackIdentity,
} from "./lyrics";

const identity: TrackIdentity = {
  album: "测试专辑",
  artist: "测试歌手",
  duration: 180,
  title: "测试歌曲",
};

describe("local lyrics resolver", () => {
  it("parses synchronized LRC lines and clips them to the track duration", () => {
    expect(parseSyncedLyrics(
      "[00:01.50]第一句\n[00:03.00][00:05.00]重复句\n[03:01.00]越界",
      180,
      "netease-unofficial",
    )).toEqual([
      expect.objectContaining({ start: 1.5, end: 3, text: "第一句" }),
      expect.objectContaining({ start: 3, end: 5, text: "重复句" }),
      expect.objectContaining({ start: 5, end: 180, text: "重复句" }),
    ]);
  });

  it("prefers a reliable NetEase match and does not call LRCLIB", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/get")) return Response.json({ result: { songs: [{
        album: { name: "测试专辑" }, artists: [{ name: "测试歌手" }],
        duration: 180_000, id: 42, name: "测试歌曲",
      }] } });
      if (url.includes("/song/lyric")) return Response.json({ lrc: { lyric: "[00:01.00]网易云歌词" } });
      throw new Error("LRCLIB must not be called");
    });

    const result = await lookupLyrics(identity, fetchImpl as typeof fetch);

    expect(result.source).toBe("netease-unofficial");
    expect(result.lyrics[0].text).toBe("网易云歌词");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to LRCLIB without invoking any speech transcription", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("music.163.com")) return Response.json({ result: { songs: [] } });
      return Response.json([{
        albumName: "测试专辑", artistName: "测试歌手", duration: 180,
        id: 9, syncedLyrics: "[00:02.00]后备歌词", trackName: "测试歌曲",
      }]);
    });

    const result = await lookupLyrics(identity, fetchImpl as typeof fetch);

    expect(result.source).toBe("lrclib");
    expect(result.warnings[0]).toContain("网易云");
    expect(result.lyrics[0].text).toBe("后备歌词");
  });

  it("resolves title and artist through NetEase before reusing lyrics lookup", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/get")) return Response.json({ result: { songs: [{
        album: { name: "城市" }, artists: [{ name: "张悬" }],
        duration: 292_000, id: 42, name: "关于我爱你",
      }] } });
      if (url.includes("/song/lyric")) {
        return Response.json({ lrc: { lyric: "[00:01.00]第一句\n[00:04.00]第二句" } });
      }
      throw new Error("LRCLIB must not be called");
    });

    const result = await lookupLyricsByQuery(
      { artist: "张悬", title: "关于我爱你" },
      fetchImpl as typeof fetch,
    );

    expect(result.identity).toMatchObject({
      artist: "张悬",
      duration: 292,
      title: "关于我爱你",
    });
    expect(result.lyrics.map((line) => line.text)).toEqual(["第一句", "第二句"]);
  });

  it("rejects title-only manual lookup and mismatched versions", async () => {
    await expect(lookupLyricsByQuery({ artist: "", title: "关于我爱你" }))
      .rejects.toThrow("请输入歌名和歌手");

    const fetchImpl = vi.fn(async () => Response.json({ result: { songs: [{
      album: { name: "现场" }, artists: [{ name: "张悬" }],
      duration: 292_000, id: 42, name: "关于我爱你 Live",
    }] } }));
    await expect(lookupLyricsByQuery(
      { artist: "张悬", title: "关于我爱你" },
      fetchImpl as typeof fetch,
    )).rejects.toThrow("可靠匹配");
  });
});
