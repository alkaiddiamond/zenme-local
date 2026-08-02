export type ImagePromptMention = {
  nodeId: string;
  offset: number;
};

type ImagePromptReference = {
  kind: "image" | "text";
  nodeId: string;
  title: string;
};

export function normalizeImagePromptContent(
  prompt: string,
  mentions: ImagePromptMention[],
) {
  const normalizedMentions: ImagePromptMention[] = [];
  let normalizedPrompt = "";
  let cursor = 0;

  for (const mention of [...mentions].sort(
    (left, right) => left.offset - right.offset,
  )) {
    const offset = Math.max(cursor, Math.min(mention.offset, prompt.length));
    const segment = prompt
      .slice(cursor, offset)
      .replace(/[ \t]*\r?\n[ \t]*$/, "");
    normalizedPrompt += segment;
    normalizedMentions.push({
      nodeId: mention.nodeId,
      offset: normalizedPrompt.length,
    });
    cursor = offset;
  }

  normalizedPrompt += prompt.slice(cursor);
  return { mentions: normalizedMentions, prompt: normalizedPrompt };
}

export function expandImagePromptMentions(input: {
  imageReferenceNodeIds?: string[];
  mentions: ImagePromptMention[];
  prompt: string;
  references: ImagePromptReference[];
}) {
  const normalized = normalizeImagePromptContent(input.prompt, input.mentions);
  const referenceById = new Map(
    input.references.map((reference) => [reference.nodeId, reference]),
  );
  const imageNodeIds = input.imageReferenceNodeIds ?? input.references
    .filter((reference) => reference.kind === "image")
    .map((reference) => reference.nodeId);
  const imageIndexById = new Map(
    imageNodeIds.map((nodeId, index) => [nodeId, index + 1]),
  );
  let expandedPrompt = "";
  let cursor = 0;
  let previousMentionExpanded = false;

  for (const mention of normalized.mentions) {
    const offset = Math.max(cursor, Math.min(mention.offset, normalized.prompt.length));
    const segment = normalized.prompt.slice(cursor, offset);
    expandedPrompt += previousMentionExpanded
      ? removeAutomaticChipSpacer(segment)
      : segment;
    const reference = referenceById.get(mention.nodeId);
    if (reference?.kind === "image") {
      const imageIndex = imageIndexById.get(reference.nodeId) ?? 1;
      expandedPrompt += `【参考图片${imageIndex}：${reference.title || "图片"}】`;
      previousMentionExpanded = true;
    } else if (reference?.kind === "text") {
      expandedPrompt += `【引用文本：${reference.title || "文本"}】`;
      previousMentionExpanded = true;
    } else {
      previousMentionExpanded = false;
    }
    cursor = offset;
  }

  const trailingText = normalized.prompt.slice(cursor);
  return `${expandedPrompt}${
    previousMentionExpanded
      ? removeAutomaticChipSpacer(trailingText)
      : trailingText
  }`.trim();
}

function removeAutomaticChipSpacer(value: string) {
  return value.replace(/^ (?=[^\x00-\x7f])/, "");
}

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
