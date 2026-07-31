export type ImagePromptMention = {
  nodeId: string;
  offset: number;
};

export function mergeReferenceNodeIds(
  selectedNodeIds: string[] | undefined,
  mentions: ImagePromptMention[],
  candidates: Array<{ nodeId: string }>,
) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.nodeId));
  return Array.from(new Set([
    ...(selectedNodeIds ?? candidates.map((candidate) => candidate.nodeId)),
    ...mentions
      .map((mention) => mention.nodeId)
      .filter((nodeId) => candidateIds.has(nodeId)),
  ]));
}
