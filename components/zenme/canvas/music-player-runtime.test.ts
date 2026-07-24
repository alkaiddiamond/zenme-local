import { describe, expect, it, vi } from "vitest";

import { releaseRemovedMusicPlayers } from "./music-player-runtime";

function createAudioMock() {
  return {
    load: vi.fn(),
    pause: vi.fn(),
    removeAttribute: vi.fn(),
  } as unknown as HTMLAudioElement;
}

describe("music player runtime", () => {
  it("stops and releases audio when its player node disappears", () => {
    const activeAudio = createAudioMock();
    const removedAudio = createAudioMock();
    const players = new Map([
      ["active-player", activeAudio],
      ["removed-player", removedAudio],
    ]);

    releaseRemovedMusicPlayers(players, new Set(["active-player"]));

    expect(players).toEqual(new Map([["active-player", activeAudio]]));
    expect(removedAudio.pause).toHaveBeenCalledOnce();
    expect(removedAudio.removeAttribute).toHaveBeenCalledWith("src");
    expect(removedAudio.load).toHaveBeenCalledOnce();
    expect(activeAudio.pause).not.toHaveBeenCalled();
  });
});
