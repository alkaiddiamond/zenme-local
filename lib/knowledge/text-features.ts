const CJK_SEQUENCE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const CJK_ONLY = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
const WORD = /[\p{L}\p{N}_-]+/gu;

export function isCjkKnowledgeFeature(value: string) {
  return CJK_ONLY.test(value);
}

export function knowledgeTextFeatures(value: string, maxFeatures = 20_000) {
  const canonical = value.normalize("NFKC");
  const normalized = canonical.toLocaleLowerCase();
  const features: string[] = [];
  const seen = new Set<string>();
  const append = (feature: string) => {
    if (!feature || seen.has(feature) || features.length >= maxFeatures) return;
    seen.add(feature);
    features.push(feature);
  };

  const originalWords = canonical.match(WORD) ?? [];
  const words = originalWords.map((word) => word.toLocaleLowerCase());
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!CJK_ONLY.test(word)) append(word);
    for (const part of splitIdentifier(originalWords[index])) append(part.toLocaleLowerCase());
  }
  const nonCjkWords = words.filter((word) => !CJK_ONLY.test(word));
  for (let index = 0; index + 1 < nonCjkWords.length; index += 1) append(`${nonCjkWords[index]}:${nonCjkWords[index + 1]}`);

  for (const sequence of normalized.match(CJK_SEQUENCE) ?? []) {
    const characters = Array.from(sequence);
    for (const size of [1, 2, 3]) {
      for (let index = 0; index + size <= characters.length; index += 1) {
        append(characters.slice(index, index + size).join(""));
      }
    }
  }
  return features;
}

function splitIdentifier(value: string) {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part && part !== value);
}
