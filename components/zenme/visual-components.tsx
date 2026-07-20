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
import type { AiModelOption } from "@/components/zenme/use-ai-model-options";

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
      {...props}
    >
      {children}
    </Button>
  );
}

type ZenmeModelPickerProps = {
  icon: ReactNode;
  model: string;
  models: AiModelOption[];
  onChange: (model: string) => void;
  onOpenChange?: (open: boolean) => void;
};

export function ZenmeModelPicker({
  icon,
  model,
  models,
  onChange,
  onOpenChange,
}: ZenmeModelPickerProps) {
  const activeModel = models.find((option) => option.id === model);
  const activeLabel = activeModel?.label ?? model;

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="选择模型"
          className="inline-flex h-9 min-w-0 max-w-[220px] flex-1 items-center rounded-full border border-zinc-200 bg-white px-3 text-sm text-zinc-800 shadow-sm transition hover:bg-zinc-50"
          type="button"
        >
          <span className="mr-2 shrink-0 text-zinc-500">{icon}</span>
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {activeLabel}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 text-zinc-500" />
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
        {models.map((option) => (
          <DropdownMenuItem
            className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-zinc-700 focus:bg-zinc-100 focus:text-zinc-950"
            key={option.id}
            onSelect={() => onChange(option.id)}
          >
            <span className="truncate" title={option.id}>
              {option.label}
            </span>
            {option.id === model ? (
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
