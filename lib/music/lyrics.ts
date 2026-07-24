import path from "node:path";

import { parseFile } from "music-metadata";

export type TrackIdentity = {
  album: string;
  artist: string;
  duration: number;
  title: string;
};

export type LyricLine = {
  end: number;
  id: string;
  source: "netease-unofficial" | "lrclib";
  start: number;
  text: string;
};

export type LyricsLookupResult = {
  identity: TrackIdentity;
  lyrics: LyricLine[];
  match: {
    albumName?: string;
    artistName: string;
    duration: number;
    id: number | string;
    trackName: string;
  };
  source: "netease-unofficial" | "lrclib";
  warnings: string[];
};

export class LyricsLookupError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = "LyricsLookupError";
  }
}

type FetchLike = typeof fetch;

const NETEASE_BASE_URL = "https://music.163.com/api";
const LRCLIB_BASE_URL = "https://lrclib.net";
const VERSION_MARKERS = ["live", "现场", "現場", "伴奏", "instrumental", "翻唱", "cover", "remix", "混音版"];
const LRC_TIMESTAMP = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;

export async function readTrackIdentity(inputPath: string): Promise<TrackIdentity> {
  const metadata = await parseFile(inputPath, { duration: true });
  const fileStem = path.parse(inputPath).name;
  const fallback = parseFileNameIdentity(fileStem);
  return {
    album: metadata.common.album?.trim() ?? "",
    artist: metadata.common.artist?.trim() || fallback.artist,
    duration: Number.isFinite(metadata.format.duration)
      ? Math.max(0, metadata.format.duration ?? 0)
      : 0,
    title: metadata.common.title?.trim() || fallback.title,
  };
}

export async function lookupLyrics(
  identity: TrackIdentity,
  fetchImpl: FetchLike = fetch,
): Promise<LyricsLookupResult> {
  validateIdentity(identity);
  const warnings: string[] = [];
  const netease = await lookupNeteaseLyrics(identity, fetchImpl);
  if (netease) return { ...netease, identity, warnings };
  warnings.push("网易云未找到可靠的同步歌词，已尝试 LRCLIB");
  const lrclib = await lookupLrclibLyrics(identity, fetchImpl);
  if (lrclib) return { ...lrclib, identity, warnings };
  throw new LyricsLookupError("网易云和 LRCLIB 均未找到与当前歌曲可靠匹配的同步歌词");
}

export function parseSyncedLyrics(
  value: string,
  duration: number,
  source: LyricLine["source"],
) {
  const pending: Array<{ start: number; text: string }> = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(LRC_TIMESTAMP)];
    const text = rawLine.replace(LRC_TIMESTAMP, "").trim();
    if (!matches.length || !text) continue;
    for (const match of matches) {
      const start = Number(match[1]) * 60 + Number(match[2]);
      if (Number.isFinite(start) && start >= 0 && start < duration) {
        pending.push({ start, text });
      }
    }
  }
  pending.sort((left, right) => left.start - right.start);
  return pending.flatMap((line, index) => {
    const next = pending.slice(index + 1).find((candidate) => candidate.start > line.start);
    const end = Math.min(duration, next?.start ?? duration);
    if (end <= line.start) return [];
    return [{
      end,
      id: `lyric-${index}-${line.start}`,
      source,
      start: line.start,
      text: line.text,
    } satisfies LyricLine];
  });
}

async function lookupNeteaseLyrics(identity: TrackIdentity, fetchImpl: FetchLike) {
  const search = new URL(`${NETEASE_BASE_URL}/search/get`);
  search.search = new URLSearchParams({
    limit: "5",
    offset: "0",
    s: `${identity.artist} ${identity.title}`,
    sub: "false",
    type: "1",
  }).toString();
  try {
    const payload = await fetchJson(search, fetchImpl, true) as {
      result?: { songs?: unknown[] };
    };
    const candidates = (payload.result?.songs ?? []).flatMap((value) => {
      if (!isObject(value)) return [];
      const artists = Array.isArray(value.artists) ? value.artists : [];
      const firstArtist = isObject(artists[0]) ? stringValue(artists[0].name) : "";
      const album = isObject(value.album) ? stringValue(value.album.name) : "";
      const duration = numberValue(value.duration) / 1_000;
      return [{
        album,
        artist: firstArtist,
        duration,
        id: value.id,
        score: identityScore(identity, stringValue(value.name), firstArtist, duration),
        title: stringValue(value.name),
      }];
    });
    const best = candidates.sort(compareCandidates)[0];
    if (!best || !isReliableMatch(identity, best)) return null;
    const lyricUrl = new URL(`${NETEASE_BASE_URL}/song/lyric`);
    lyricUrl.search = new URLSearchParams({
      id: String(best.id), kv: "-1", lv: "-1", os: "pc", tv: "-1",
    }).toString();
    const lyricPayload = await fetchJson(lyricUrl, fetchImpl, true);
    const lyricText = isObject(lyricPayload) && isObject(lyricPayload.lrc)
      ? stringValue(lyricPayload.lrc.lyric)
      : "";
    const lyrics = parseSyncedLyrics(lyricText, identity.duration, "netease-unofficial");
    if (!lyrics.length) return null;
    return {
      lyrics,
      match: {
        albumName: best.album,
        artistName: best.artist,
        duration: best.duration,
        id: typeof best.id === "number" || typeof best.id === "string" ? best.id : "",
        trackName: best.title,
      },
      source: "netease-unofficial" as const,
    };
  } catch {
    return null;
  }
}

async function lookupLrclibLyrics(identity: TrackIdentity, fetchImpl: FetchLike) {
  const search = new URL(`${LRCLIB_BASE_URL}/api/search`);
  search.searchParams.set("q", identity.title);
  try {
    const payload = await fetchJson(search, fetchImpl, false);
    const candidates = (Array.isArray(payload) ? payload : []).flatMap((value) => {
      if (!isObject(value)) return [];
      const duration = numberValue(value.duration);
      const artist = stringValue(value.artistName);
      const title = stringValue(value.trackName);
      return [{
        album: stringValue(value.albumName),
        artist,
        duration,
        id: value.id,
        score: identityScore(identity, title, artist, duration),
        syncedLyrics: stringValue(value.syncedLyrics),
        title,
      }];
    });
    const best = candidates.sort(compareCandidates)[0];
    if (!best || !best.syncedLyrics || !isReliableMatch(identity, best)) return null;
    const lyrics = parseSyncedLyrics(best.syncedLyrics, identity.duration, "lrclib");
    if (!lyrics.length) return null;
    return {
      lyrics,
      match: {
        albumName: best.album,
        artistName: best.artist,
        duration: best.duration,
        id: typeof best.id === "number" || typeof best.id === "string" ? best.id : "",
        trackName: best.title,
      },
      source: "lrclib" as const,
    };
  } catch {
    return null;
  }
}

async function fetchJson(url: URL, fetchImpl: FetchLike, post: boolean) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(post ? {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "appver=2.0.2",
        referer: "https://music.163.com",
      } : {}),
      "user-agent": "ZenmeLocal/0.1 (+local lyrics resolver)",
    },
    method: post ? "POST" : "GET",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`歌词服务请求失败 (${response.status})`);
  return response.json() as Promise<unknown>;
}

function parseFileNameIdentity(fileStem: string) {
  const parts = fileStem.split(" - ", 2).map((part) => part.trim());
  return parts.length === 2
    ? { artist: parts[0], title: parts[1] }
    : { artist: "", title: fileStem.trim() };
}

function validateIdentity(identity: TrackIdentity) {
  if (!identity.title || !identity.artist || identity.duration <= 0) {
    throw new LyricsLookupError("无法从音乐文件识别完整的标题、歌手和时长，不能可靠匹配歌词");
  }
}

function identityScore(
  identity: TrackIdentity,
  candidateTitle: string,
  candidateArtist: string,
  candidateDuration: number,
) {
  const titleScore = similarity(identity.title, candidateTitle);
  const artistScore = similarity(identity.artist, candidateArtist);
  const durationError = Math.abs(identity.duration - candidateDuration);
  const durationScore = Math.max(0, 1 - durationError / 5);
  const expected = normalized(identity.title);
  const candidate = normalized(candidateTitle);
  const mismatchedMarkers = VERSION_MARKERS.filter((marker) =>
    candidate.includes(normalized(marker)) && !expected.includes(normalized(marker))
  );
  return Math.max(0, 0.45 * titleScore + 0.35 * artistScore + 0.2 * durationScore - Math.min(0.24, mismatchedMarkers.length * 0.08));
}

function isReliableMatch(
  identity: TrackIdentity,
  candidate: { artist: string; duration: number; score: number; title: string },
) {
  const durationError = Math.abs(identity.duration - candidate.duration);
  const exactEnough = similarity(identity.title, candidate.title) >= 0.95 &&
    containsIdentity(identity.artist, candidate.artist);
  return (candidate.score >= 0.9 || exactEnough) && durationError <= 3;
}

function compareCandidates(
  left: { duration: number; score: number },
  right: { duration: number; score: number },
) {
  return right.score - left.score || left.duration - right.duration;
}

function similarity(left: string, right: string) {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function containsIdentity(left: string, right: string) {
  const a = normalized(left);
  const b = normalized(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}
