import type {
  ReadingAnnotationColor,
  ReadingAnnotationType,
} from "@/lib/reading/types";

export function normalizeReadingColor(value: unknown): ReadingAnnotationColor {
  if (
    value === "yellow" ||
    value === "red" ||
    value === "blue" ||
    value === "green" ||
    value === "purple"
  ) {
    return value;
  }
  return "yellow";
}

export function normalizeReadingType(value: unknown): ReadingAnnotationType {
  if (
    value === "highlight" ||
    value === "underline" ||
    value === "note" ||
    value === "region"
  ) {
    return value;
  }
  return "highlight";
}
