import { describe, expect, it, vi } from "vitest";

import { lookupLyrics, parseSyncedLyrics, type TrackIdentity } from "./lyrics";

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
});
