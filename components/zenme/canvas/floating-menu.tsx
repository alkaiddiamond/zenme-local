"use client";

import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FloatingMenuProps = {
  children: ReactNode;
  className?: string;
  left: number;
  top: number;
};

export function FloatingMenu({
  children,
  className,
  left,
  top,
}: FloatingMenuProps) {
  return (
    <div
      className={cn(
        "zenme-shadow-dropdown fixed z-30 w-72 rounded-lg border border-zinc-200 bg-white/95 p-2 text-zinc-950 backdrop-blur",
        className,
      )}
      data-thumbnail-hidden="true"
      style={{ left, top }}
    >
      {children}
    </div>
  );
}

type FloatingMenuHeaderProps = {
  onClose: () => void;
  title: string;
};

export function FloatingMenuHeader({
  onClose,
  title,
}: FloatingMenuHeaderProps) {
  return (
    <div className="mb-1 flex items-center justify-between px-2 py-1.5">
      <p className="truncate text-sm font-medium text-zinc-500">{title}</p>
      <Button
        className="size-7 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
        onClick={onClose}
        size="icon"
        type="button"
        variant="ghost"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

type FloatingMenuItemProps = {
  children?: ReactNode;
  description?: string;
  disabled?: boolean;
  icon: LucideIcon;
  onClick?: () => void;
  primary?: boolean;
  title: string;
};

export function FloatingMenuItem({
  children,
  description,
  disabled,
  icon: Icon,
  onClick,
  primary,
  title,
}: FloatingMenuItemProps) {
  return (
    <button
      className={cn(
        "mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition hover:bg-zinc-100",
        primary && "mt-0 bg-zinc-100 hover:bg-zinc-200",
        disabled &&
          "cursor-not-allowed text-zinc-400 opacity-70 hover:bg-transparent",
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700",
          primary && "bg-white shadow-sm",
          disabled && "text-zinc-400",
        )}
      >
        <Icon className="size-5" />
      </span>
      {children ?? (
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          {description ? (
            <span className="block truncate text-xs text-zinc-500">
              {description}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}

export function FloatingMenuSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-2 text-xs font-medium text-zinc-400">
      {children}
    </p>
  );
}
