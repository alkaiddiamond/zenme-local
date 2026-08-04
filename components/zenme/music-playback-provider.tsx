"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  MusicLyricsOverlay,
  type MusicLyricsOverlayPosition,
} from "@/components/zenme/canvas/music-lyrics-overlay";
import {
  extractMusicLyrics,
  getMusicApiErrorMessage,
  getNextMusicSourceId,
  getPreviousMusicSourceId,
  normalizeMusicLoopMode,
} from "@/components/zenme/canvas/music-workflow";
import type { MusicLoopMode, MusicLyricLine } from "@/components/zenme/node-types";

export type MusicPlaybackSource = {
  fileId?: string;
  id: string;
  lyrics?: MusicLyricLine[];
  title: string;
  url?: string;
};

export type MusicPlaybackConfig = {
  currentSourceId?: string;
  loopMode?: MusicLoopMode;
  muted?: boolean;
  playbackRate?: number;
  playerNodeId: string;
  projectId: string;
  sources: MusicPlaybackSource[];
  volume?: number;
};

export type MusicPlaybackSession = {
  config: MusicPlaybackConfig;
  currentSourceId?: string;
  currentTime: number;
  duration: number;
  error?: string;
  isPlaying: boolean;
  lyrics: MusicLyricLine[];
  lyricsError?: string;
  lyricsSourceId?: string;
  lyricsStatus: "idle" | "loading" | "succeeded" | "failed";
  overlay?: {
    minimized: boolean;
    position: MusicLyricsOverlayPosition;
  };
};

type MusicPlaybackUpdates = {
  loop?: boolean;
  loopMode?: MusicLoopMode;
  muted?: boolean;
  playbackRate?: number;
  volume?: number;
};

type MusicPlaybackContextValue = {
  ensurePlayback: (config: MusicPlaybackConfig) => void;
  isOverlayOpen: (projectId: string, playerNodeId: string) => boolean;
  overlayDockLeft: number;
  seek: (config: MusicPlaybackConfig, seconds: number) => void;
  setOverlayDockLeft: (left: number) => void;
  selectAdjacent: (
    config: MusicPlaybackConfig,
    direction: "next" | "previous",
  ) => void;
  selectSource: (config: MusicPlaybackConfig, sourceNodeId: string) => void;
  session?: MusicPlaybackSession;
  toggleOverlay: (
    config: MusicPlaybackConfig,
    initialPosition: MusicLyricsOverlayPosition,
  ) => void;
  togglePlayback: (config: MusicPlaybackConfig, playing: boolean) => void;
  updateOverlay: (
    update: MusicPlaybackSession["overlay"] | ((current: NonNullable<MusicPlaybackSession["overlay"]>) => MusicPlaybackSession["overlay"]),
  ) => void;
  updatePlayback: (config: MusicPlaybackConfig, updates: MusicPlaybackUpdates) => void;
};

const MusicPlaybackContext = createContext<MusicPlaybackContextValue | null>(null);

export function MusicPlaybackProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<MusicPlaybackSession>();
  const [overlayDockLeft, setOverlayDockLeft] = useState(224);
  const sessionRef = useRef<MusicPlaybackSession | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);

  const commitSession = useCallback((
    update: MusicPlaybackSession | undefined | ((current?: MusicPlaybackSession) => MusicPlaybackSession | undefined),
  ) => {
    setSession((current) => {
      const next = typeof update === "function" ? update(current) : update;
      sessionRef.current = next;
      return next;
    });
  }, []);

  const updateSession = useCallback((
    updater: (current: MusicPlaybackSession) => MusicPlaybackSession,
  ) => {
    commitSession((current) => current ? updater(current) : current);
  }, [commitSession]);

  const releaseAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audioRef.current = undefined;
  }, []);

  const activate = useCallback((config: MusicPlaybackConfig) => {
    const current = sessionRef.current;
    if (!isSameMusicPlayer(current, config)) {
      releaseAudio();
      const next = reconcileMusicPlaybackSession(current, config);
      commitSession(next);
      return next;
    }
    const next = reconcileMusicPlaybackSession(current, config);
    if (next === current) return current;
    if (next.currentSourceId !== current?.currentSourceId) releaseAudio();
    commitSession(next);
    return next;
  }, [commitSession, releaseAudio]);

  const ensureAudio = useCallback((activeSession: MusicPlaybackSession) => {
    const source = activeSession.config.sources.find(
      (candidate) => candidate.id === activeSession.currentSourceId,
    );
    if (!source?.url) return undefined;
    const absoluteUrl = new URL(source.url, window.location.href).href;
    let audio = audioRef.current;
    if (audio?.src === absoluteUrl) return audio;

    releaseAudio();
    audio = new Audio(source.url);
    audio.preload = "metadata";
    audio.loop = normalizeMusicLoopMode(activeSession.config.loopMode) === "one";
    audio.muted = Boolean(activeSession.config.muted);
    audio.playbackRate = activeSession.config.playbackRate ?? 1;
    audio.volume = activeSession.config.volume ?? 1;
    audio.addEventListener("loadedmetadata", () => {
      updateSession((current) => ({
        ...current,
        currentTime: Math.min(audio?.currentTime ?? 0, audio?.duration ?? 0),
        duration: Number.isFinite(audio?.duration) ? Math.max(0, audio?.duration ?? 0) : 0,
      }));
    });
    audio.addEventListener("timeupdate", () => {
      updateSession((current) => ({ ...current, currentTime: audio?.currentTime ?? 0 }));
    });
    audioRef.current = audio;
    return audio;
  }, [releaseAudio, updateSession]);

  const playCurrent = useCallback((activeSession: MusicPlaybackSession) => {
    const audio = ensureAudio(activeSession);
    if (!audio) return;
    updateSession((current) => ({ ...current, error: undefined, isPlaying: true }));
    void audio.play().catch((error) => {
      updateSession((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "无法播放音乐",
        isPlaying: false,
      }));
    });
  }, [ensureAudio, updateSession]);

  const chooseSource = useCallback((
    activeSession: MusicPlaybackSession,
    sourceNodeId: string,
    keepPlaying: boolean,
  ) => {
    if (!activeSession.config.sources.some((source) => source.id === sourceNodeId)) return;
    releaseAudio();
    const next = {
      ...activeSession,
      currentSourceId: sourceNodeId,
      currentTime: 0,
      duration: 0,
      error: undefined,
      isPlaying: false,
      lyrics: [],
      lyricsError: undefined,
      lyricsSourceId: undefined,
      lyricsStatus: "idle" as const,
    };
    commitSession(next);
    if (keepPlaying) playCurrent(next);
  }, [commitSession, playCurrent, releaseAudio]);

  const selectAdjacentFromSession = useCallback((
    activeSession: MusicPlaybackSession,
    direction: "next" | "previous",
    keepPlaying: boolean,
  ) => {
    const sourceIds = activeSession.config.sources.map((source) => source.id);
    const nextSourceId = direction === "next"
      ? getNextMusicSourceId(sourceIds, activeSession.currentSourceId)
      : getPreviousMusicSourceId(sourceIds, activeSession.currentSourceId);
    if (nextSourceId) chooseSource(activeSession, nextSourceId, keepPlaying);
  }, [chooseSource]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleEnded = () => {
      const current = sessionRef.current;
      if (!current) return;
      const loopMode = normalizeMusicLoopMode(current.config.loopMode);
      if (loopMode === "one") {
        audio.currentTime = 0;
        playCurrent(current);
      } else if (loopMode === "all") {
        selectAdjacentFromSession(current, "next", true);
      } else {
        updateSession((value) => ({ ...value, currentTime: audio.currentTime, isPlaying: false }));
      }
    };
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [playCurrent, selectAdjacentFromSession, session?.currentSourceId, updateSession]);

  useEffect(() => {
    if (!session?.overlay || !session.currentSourceId) return;
    const source = session.config.sources.find((item) => item.id === session.currentSourceId);
    if (!source || session.lyricsSourceId === source.id) return;
    if (source.lyrics?.length) {
      updateSession((current) => ({
        ...current,
        lyrics: source.lyrics ?? [],
        lyricsSourceId: source.id,
        lyricsStatus: "succeeded",
      }));
      return;
    }
    if (!source.fileId) {
      updateSession((current) => ({
        ...current,
        lyrics: [],
        lyricsError: "当前播放器没有可获取歌词的音乐文件",
        lyricsSourceId: source.id,
        lyricsStatus: "failed",
      }));
      return;
    }

    const controller = new AbortController();
    updateSession((current) => ({
      ...current,
      lyrics: [],
      lyricsError: undefined,
      lyricsSourceId: source.id,
      lyricsStatus: "loading",
    }));
    void fetch("/api/music/lyrics", {
      body: JSON.stringify({ fileId: source.fileId, projectId: session.config.projectId }),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: controller.signal,
    }).then(async (response) => {
      const result = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (!response.ok) throw new Error(getMusicApiErrorMessage(result));
      updateSession((current) => current.currentSourceId === source.id ? {
        ...current,
        lyrics: extractMusicLyrics(result ?? undefined),
        lyricsError: undefined,
        lyricsSourceId: source.id,
        lyricsStatus: "succeeded",
      } : current);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      updateSession((current) => current.currentSourceId === source.id ? {
        ...current,
        lyrics: [],
        lyricsError: error instanceof Error ? error.message : "歌词获取失败",
        lyricsSourceId: source.id,
        lyricsStatus: "failed",
      } : current);
    });
    return () => controller.abort();
  }, [
    session?.config.projectId,
    session?.config.sources,
    session?.currentSourceId,
    session?.lyricsSourceId,
    session?.overlay,
    updateSession,
  ]);

  useEffect(() => () => releaseAudio(), [releaseAudio]);

  const value = useMemo<MusicPlaybackContextValue>(() => ({
    ensurePlayback(config) {
      ensureAudio(activate(config));
    },
    isOverlayOpen(projectId, playerNodeId) {
      return Boolean(session?.overlay && session.config.projectId === projectId &&
        session.config.playerNodeId === playerNodeId);
    },
    overlayDockLeft,
    seek(config, seconds) {
      const active = activate(config);
      const audio = ensureAudio(active);
      if (audio) audio.currentTime = seconds;
      updateSession((current) => ({ ...current, currentTime: seconds }));
    },
    setOverlayDockLeft,
    selectAdjacent(config, direction) {
      const active = activate(config);
      selectAdjacentFromSession(active, direction, active.isPlaying);
    },
    selectSource(config, sourceNodeId) {
      const active = activate(config);
      chooseSource(active, sourceNodeId, active.isPlaying);
    },
    session,
    toggleOverlay(config, initialPosition) {
      const active = activate(config);
      commitSession(active.overlay
        ? { ...active, overlay: undefined }
        : { ...active, overlay: { minimized: false, position: initialPosition } });
    },
    togglePlayback(config, playing) {
      const active = activate(config);
      if (playing) playCurrent(active);
      else {
        audioRef.current?.pause();
        updateSession((current) => ({ ...current, isPlaying: false }));
      }
    },
    updateOverlay(update) {
      updateSession((current) => {
        if (!current.overlay) return current;
        return {
          ...current,
          overlay: typeof update === "function" ? update(current.overlay) : update,
        };
      });
    },
    updatePlayback(config, updates) {
      const active = activate(config);
      const nextLoopMode = updates.loopMode ?? (
        updates.loop === undefined ? undefined : updates.loop ? "one" : "off"
      );
      const nextConfig = {
        ...active.config,
        ...(nextLoopMode === undefined ? {} : { loopMode: nextLoopMode }),
        ...(updates.muted === undefined ? {} : { muted: updates.muted }),
        ...(updates.playbackRate === undefined ? {} : { playbackRate: updates.playbackRate }),
        ...(updates.volume === undefined ? {} : { volume: updates.volume }),
      };
      const audio = audioRef.current;
      if (audio) {
        if (nextLoopMode !== undefined) audio.loop = nextLoopMode === "one";
        if (updates.muted !== undefined) audio.muted = updates.muted;
        if (updates.playbackRate !== undefined) audio.playbackRate = updates.playbackRate;
        if (updates.volume !== undefined) audio.volume = updates.volume;
      }
      commitSession({ ...active, config: nextConfig });
    },
  }), [
    activate,
    chooseSource,
    commitSession,
    ensureAudio,
    overlayDockLeft,
    playCurrent,
    selectAdjacentFromSession,
    session,
    updateSession,
  ]);

  return (
    <MusicPlaybackContext.Provider value={value}>
      {children}
    </MusicPlaybackContext.Provider>
  );
}

export function MusicPlaybackOverlay() {
  const musicPlayback = useMusicPlayback();
  const session = musicPlayback.session;
  if (!session?.overlay) return null;
  const source = session.config.sources.find((item) => item.id === session.currentSourceId);

  return (
    <MusicLyricsOverlay
      currentTime={session.currentTime}
      duration={session.duration}
      error={session.lyricsError}
      hasPlayableSource={Boolean(source?.url)}
      isPlaying={session.isPlaying}
      lines={session.lyrics}
      minimized={session.overlay.minimized}
      minimizedLeft={musicPlayback.overlayDockLeft}
      onClose={() => musicPlayback.updateOverlay(undefined)}
      onExpand={() => musicPlayback.updateOverlay((current) => ({
        ...current,
        minimized: false,
      }))}
      onMinimize={() => musicPlayback.updateOverlay((current) => ({
        ...current,
        minimized: true,
      }))}
      onMove={(position) => musicPlayback.updateOverlay((current) => ({
        ...current,
        position,
      }))}
      onNext={() => musicPlayback.selectAdjacent(session.config, "next")}
      onPrevious={() => musicPlayback.selectAdjacent(session.config, "previous")}
      onTogglePlayback={() => musicPlayback.togglePlayback(
        session.config,
        !session.isPlaying,
      )}
      position={session.overlay.position}
      songTitle={source?.title || "当前歌曲歌词"}
      status={session.lyricsStatus}
    />
  );
}

export function useMusicPlayback() {
  const value = useContext(MusicPlaybackContext);
  if (!value) throw new Error("useMusicPlayback must be used inside MusicPlaybackProvider");
  return value;
}

export function isSameMusicPlayer(
  session: MusicPlaybackSession | undefined,
  config: MusicPlaybackConfig,
) {
  return session?.config.projectId === config.projectId &&
    session.config.playerNodeId === config.playerNodeId;
}

export function reconcileMusicPlaybackSession(
  current: MusicPlaybackSession | undefined,
  config: MusicPlaybackConfig,
): MusicPlaybackSession {
  if (!current || !isSameMusicPlayer(current, config)) {
    return {
      config,
      currentSourceId: config.currentSourceId ?? config.sources[0]?.id,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      lyrics: [],
      lyricsStatus: "idle",
    };
  }
  if (areMusicPlaybackConfigsEqual(current.config, config)) return current;
  const sourceStillExists = config.sources.some(
    (source) => source.id === current.currentSourceId,
  );
  return {
    ...current,
    config,
    currentSourceId: sourceStillExists
      ? current.currentSourceId
      : config.currentSourceId ?? config.sources[0]?.id,
  };
}

export function areMusicPlaybackConfigsEqual(
  left: MusicPlaybackConfig,
  right: MusicPlaybackConfig,
) {
  if (
    left.currentSourceId !== right.currentSourceId ||
    left.loopMode !== right.loopMode ||
    left.muted !== right.muted ||
    left.playbackRate !== right.playbackRate ||
    left.playerNodeId !== right.playerNodeId ||
    left.projectId !== right.projectId ||
    left.volume !== right.volume ||
    left.sources.length !== right.sources.length
  ) return false;
  return left.sources.every((source, index) => {
    const candidate = right.sources[index];
    return source.fileId === candidate?.fileId &&
      source.id === candidate.id &&
      source.lyrics === candidate.lyrics &&
      source.title === candidate.title &&
      source.url === candidate.url;
  });
}
