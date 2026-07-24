"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  resolveAiModelOptionId,
  type AiModelOption,
} from "@/components/zenme/use-ai-model-options";

type ZenmeIconButtonProps = ComponentPropsWithoutRef<"button"> & {
  active?: boolean;
  children: ReactNode;
  size?: "sm" | "md";
};

export function ZenmeIconButton({
  active,
  children,
  className,
  size = "md",
  type = "button",
  ...props
}: ZenmeIconButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-full transition",
        size === "md" ? "size-10" : "size-9",
        active
          ? "bg-zinc-950 text-white hover:bg-zinc-800"
          : "text-zinc-600 hover:bg-zinc-100",
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}

type ZenmeControlButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  children: ReactNode;
};

export function ZenmeControlButton({
  children,
  className,
  size = "icon",
  variant = "outline",
  type = "button",
  ...props
}: ZenmeControlButtonProps) {
  return (
    <Button
      className={cn(
        "size-9 rounded-md border border-zinc-200 bg-white p-0 text-zinc-700 shadow-sm hover:bg-zinc-100",
        className,
      )}
      size={size}
      type={type}
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );
}

type ZenmeModelPickerProps = {
  compact?: boolean;
  icon: ReactNode;
  model: string;
  models: AiModelOption[];
  onChange: (model: string) => void;
  onOpenChange?: (open: boolean) => void;
};

export function ZenmeModelPicker({
  compact = false,
  icon,
  model,
  models,
  onChange,
  onOpenChange,
}: ZenmeModelPickerProps) {
  const resolvedModel = resolveAiModelOptionId(models, model);
  const visibleModels = models.filter(
    (option) => option.id !== model || resolvedModel === model,
  );
  const activeModel = visibleModels.find(
    (option) => option.id === resolvedModel,
  );
  const activeLabel = activeModel?.label ?? model;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="选择模型"
          className={cn(
            "inline-flex min-w-0 flex-1 items-center rounded-full border border-zinc-200 bg-white px-3 text-zinc-800 shadow-sm transition hover:bg-zinc-50",
            compact
              ? "h-[30px] max-w-[180px] text-xs"
              : "h-9 max-w-[220px] text-sm",
          )}
          type="button"
        >
          <span
            className={cn(
              "shrink-0 text-zinc-500",
              compact ? "mr-1.5" : "mr-2",
            )}
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {activeLabel}
          </span>
          <ChevronDown
            className={cn(
              "shrink-0 text-zinc-500",
              compact ? "ml-1.5 size-3.5" : "ml-2 size-4",
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="nodrag nopan nowheel zenme-shadow-dropdown w-[var(--radix-dropdown-menu-trigger-width)] rounded-lg border-zinc-200 bg-white p-1.5"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        side="top"
        sideOffset={8}
      >
        {visibleModels.map((option) => (
          <DropdownMenuItem
            className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-zinc-700 focus:bg-zinc-100 focus:text-zinc-950"
            key={option.id}
            onSelect={() => onChange(option.id)}
          >
            <span className="truncate" title={option.id}>
              {option.label}
            </span>
            {option.id === resolvedModel ? (
              <Check className="ml-3 size-4 text-zinc-900" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ZenmeCopyButtonProps = ComponentPropsWithoutRef<"button"> & {
  label?: string;
};

export function ZenmeCopyButton({
  className,
  label = "复制",
  type = "button",
  ...props
}: ZenmeCopyButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-zinc-500 opacity-0 transition hover:bg-zinc-100 hover:text-zinc-900 group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
      type={type}
      {...props}
    >
      <Copy className="size-3.5" />
      {label}
    </button>
  );
}
