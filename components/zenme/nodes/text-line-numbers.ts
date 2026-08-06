export function getTextLines(value?: string) {
  return (value ?? "").replace(/\r\n?/g, "\n").split("\n");
}

export function getTextLineNumbers(value?: string) {
  return getTextLines(value).map((_, index) => index + 1).join("\n");
}

export function getVisibleTextOffsets(value: string) {
  const start = value.search(/\S/);
  if (start < 0) return null;
  return {
    end: value.length - (value.match(/\s*$/)?.[0].length ?? 0),
    start,
  };
}

export type VisualLineRect = { bottom: number; top: number };

export function normalizeVisualLineRects(values: VisualLineRect[]) {
  const lines: VisualLineRect[] = [];
  for (const rect of values
    .filter((value) =>
      Number.isFinite(value.top) &&
      Number.isFinite(value.bottom) &&
      value.bottom > value.top,
    )
    .sort((left, right) => left.top - right.top)) {
    const current = lines.at(-1);
    if (
      current &&
      rect.top < current.bottom - 1 &&
      rect.bottom > current.top + 1
    ) {
      current.top = Math.min(current.top, rect.top);
      current.bottom = Math.max(current.bottom, rect.bottom);
    } else {
      lines.push({ ...rect });
    }
  }
  return lines;
}
