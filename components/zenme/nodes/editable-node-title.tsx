"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

type EditableNodeTitleProps = {
  displayFallback?: string;
  fallbackTitle: string;
  icon: ReactNode;
  iconClassName?: string;
  onCommit: (title: string) => void;
  onEditingChange?: (editing: boolean) => void;
  title?: string | null;
};

export function EditableNodeTitle({
  displayFallback,
  fallbackTitle,
  icon,
  iconClassName,
  onCommit,
  onEditingChange,
  title,
}: EditableNodeTitleProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title || fallbackTitle);

  useEffect(() => {
    if (!isEditing) {
      setDraftTitle(title || fallbackTitle);
    }
  }, [fallbackTitle, isEditing, title]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      const length = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(length, length);
    }
  }, [isEditing]);

  function changeEditing(nextEditing: boolean) {
    setIsEditing(nextEditing);
    onEditingChange?.(nextEditing);
  }

  function commitTitle() {
    const nextTitle = draftTitle.trim();
    changeEditing(false);

    if (!nextTitle || nextTitle === title) {
      setDraftTitle(title || fallbackTitle);
      return;
    }

    onCommit(nextTitle);
  }

  return (
    <div className="absolute -top-8 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
      <span
        className={`zenme-node-title-icon-hitbox${iconClassName ? ` ${iconClassName}` : ""}`}
      >
        {icon}
      </span>
      {isEditing ? (
        <input
          className="zenme-node-title-input nodrag nowheel h-6 w-44 cursor-text rounded-sm border border-zinc-200 bg-white/95 px-1.5 text-xs font-medium text-zinc-900 outline-none focus:border-zinc-400"
          onBlur={commitTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitTitle();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraftTitle(title || fallbackTitle);
              changeEditing(false);
            }
          }}
          placeholder="请输入标题"
          ref={inputRef}
          value={draftTitle}
        />
      ) : (
        <button
          className="nodrag max-w-52 truncate rounded-sm text-left hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-zinc-300"
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            changeEditing(true);
          }}
          title="双击修改标题"
          type="button"
        >
          {title || displayFallback || fallbackTitle}
        </button>
      )}
    </div>
  );
}
