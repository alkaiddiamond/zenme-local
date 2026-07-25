"use client";

import type { FormEventHandler, KeyboardEventHandler, ReactNode } from "react";
import { AlertCircle, Box, Check, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ZenmeCopyButton,
  ZenmeModelPicker,
} from "@/components/zenme/visual-components";
import type { AgentMessage } from "@/components/zenme/agent-types";
import type { AiModelOption } from "@/components/zenme/use-ai-model-options";

export function AgentPanelShell({ children }: { children: ReactNode }) {
  return (
    <aside
      className="zenme-shadow-overlay absolute inset-y-0 right-0 z-20 flex w-[420px] flex-col rounded-l-xl border-l border-zinc-200 bg-white text-zinc-950"
      data-thumbnail-hidden="true"
    >
      {children}
    </aside>
  );
}

export function AgentPanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex h-14 items-center justify-end px-5">
      <button
        className="flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
        onClick={onClose}
        type="button"
      >
        <X className="size-5" />
      </button>
    </header>
  );
}

export function AgentWelcomeState({ context }: { context?: string }) {
  return (
    <div className="flex h-full flex-col justify-end pb-8">
      <p className="mb-2 flex items-center gap-2 text-sm text-zinc-500">
        <Box className="size-5 text-zinc-600" />
        Hi alkaiddiamond!
      </p>
      <h2 className="text-base font-normal tracking-normal text-zinc-950">
        今天一起创作点什么？
      </h2>
      {context ? (
        <p className="mt-4 rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
          已带入节点上下文：{context}
        </p>
      ) : null}
    </div>
  );
}

export function AgentMessageList({
  messages,
  onCopyMessage,
}: {
  messages: AgentMessage[];
  onCopyMessage: (content: string) => void;
}) {
  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <div className="group" key={`${message.role}-${index}`}>
          <div
            className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-6 ${
              message.role === "user"
                ? "ml-10 bg-zinc-100 text-zinc-950"
                : "mr-8 bg-zinc-100 text-zinc-950"
            }`}
          >
            {message.content}
          </div>
          <div
            className={`mt-1 flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <ZenmeCopyButton onClick={() => onCopyMessage(message.content)} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentErrorNotice({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

export function AgentComposer({
  input,
  isSubmitting,
  model,
  models,
  onInputChange,
  onModelChange,
  onSubmit,
}: {
  input: string;
  isSubmitting: boolean;
  model: string;
  models: AiModelOption[];
  onInputChange: (input: string) => void;
  onModelChange: (model: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
      onSubmit={onSubmit}
    >
      <textarea
        className="min-h-20 w-full resize-none bg-transparent p-1 text-sm text-zinc-950 outline-none placeholder:text-zinc-500"
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="描述创意或需求 / 使用技能，添加画布内容，@ 引用参考"
        value={input}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <ZenmeModelPicker
          icon={<Box className="size-4" />}
          model={model}
          models={models}
          onChange={onModelChange}
        />
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Check className="size-3.5" />
          Enter 发送
        </div>
        <Button
          className="size-9 rounded-full bg-zinc-950 p-0 text-white hover:bg-zinc-800"
          disabled={
            isSubmitting || !models.some((option) => option.id === model)
          }
          size="icon"
          type="submit"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </form>
  );
}
