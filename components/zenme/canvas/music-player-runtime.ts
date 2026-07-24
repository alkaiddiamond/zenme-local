export function releaseRemovedMusicPlayers(
  players: Map<string, HTMLAudioElement>,
  activePlayerNodeIds: ReadonlySet<string>,
) {
  for (const [nodeId, audio] of players) {
    if (activePlayerNodeIds.has(nodeId)) {
      continue;
    }

    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    players.delete(nodeId);
  }
}
