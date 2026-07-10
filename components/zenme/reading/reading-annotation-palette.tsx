import { X } from "lucide-react";

import type { ReadingAnnotationColor } from "@/lib/reading/types";

import { HIGHLIGHT_OPTIONS, HIGHLIGHT_STYLES } from "./constants";

type ReadingAnnotationPaletteProps = {
  disabled: boolean;
  labelSuffix: string;
  onClose: () => void;
  onSelectColor: (color: ReadingAnnotationColor) => void;
  selectedColor: ReadingAnnotationColor;
  x: number;
  y: number;
};

export function ReadingAnnotationPalette({
  disabled,
  labelSuffix,
  onClose,
  onSelectColor,
  selectedColor,
  x,
  y,
}: ReadingAnnotationPaletteProps) {
  return (
    <div
      className="absolute z-20 flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-xl"
      style={{ left: x, top: y }}
    >
      {HIGHLIGHT_OPTIONS.map((option) => (
        <button
          aria-label={`${option.label}色${labelSuffix}`}
          className={`size-6 rounded-full border ${
            selectedColor === option.color
              ? "border-zinc-950"
              : "border-zinc-200"
          }`}
          disabled={disabled}
          key={option.color}
          onClick={() => onSelectColor(option.color)}
          style={{ background: HIGHLIGHT_STYLES[option.color] }}
          title={`${option.label}色${labelSuffix}`}
          type="button"
        />
      ))}
      <button
        className="flex size-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950"
        onClick={onClose}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
