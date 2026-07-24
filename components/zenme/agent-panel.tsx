"use client";

import { FormEvent, useEffect, useRef } from "react";

import {
  AgentComposer,
  AgentErrorNotice,
  AgentMessageList,
  AgentPanelHeader,
  AgentPanelShell,
  AgentWelcomeState,
} from "@/components/zenme/agent-panel-parts";
import {
  appendAgentUserMessage,
  appendEmptyAssistantMessage,
  applyAssistantMessageContent,
} from "@/components/zenme/agent-message-state";
import type { AgentMessage } from "@/components/zenme/agent-types";
import { requestAgentChat } from "@/components/zenme/agent-chat-request";
import { readAiChatStreamDeltas } from "@/components/zenme/canvas/ai-stream";
import {
  createModelOption,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { writeTextToClipboard } from "@/lib/clipboard";

export type { AgentMessage } from "@/components/zenme/agent-types";

type AgentPanelProps = {
  onClose: () => void;
  context?: string;
  error: string | null;
  input: string;
  isSubmitting: boolean;
  messages: Message[];
  model: string;
  setError: (error: string | null) => void;
  setInput: (input: string) => void;
  setIsSubmitting: (isSubmitting: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setModel: (model: string) => void;
};

type Message = AgentMessage;

export function AgentPanel({
  context,
  error,
  input,
  isSubmitting,
  messages,
  model,
  onClose,
  setError,
  setInput,
  setIsSubmitting,
  setMessages,
  setModel,
}: AgentPanelProps) {
  const abortRef = useRef<AbortController | null>(null);
  const configuredModels = useAiModelOptions();
  const pickerModels = configuredModels.some((option) => option.id === model)
    ? configuredModels
    : [createModelOption(model), ...configuredModels];

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  async function copyMessage(content: string) {
    try {
      const copied = await writeTextToClipboard(content);
      if (!copied) {
        throw new Error("Clipboard write failed");
      }
    } catch {
      setError("复制失败，请检查浏览器权限");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isSubmitting) {
      return;
    }

    const nextMessages = appendAgentUserMessage(messages, content);
    setMessages(nextMessages);
    setInput("");
    setIsSubmitting(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await requestAgentChat({
        context,
        messages: nextMessages,
        model,
        signal: controller.signal,
      });

      if (!response.ok) {
        // 错误以独立状态展示，不写入对话历史，避免污染后续多轮上下文。
        setError(response.error);
        return;
      }

      setMessages(appendEmptyAssistantMessage(nextMessages));

      let acc = "";

      await readAiChatStreamDeltas(response.body, (delta) => {
        acc += delta;
        setMessages((prev) => applyAssistantMessageContent(prev, acc));
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "调用失败");
      }
    } finally {
      setIsSubmitting(false);
      abortRef.current = null;
    }
  }

  return (
    <AgentPanelShell>
      <AgentPanelHeader onClose={onClose} />
      <div className="flex flex-1 flex-col justify-end overflow-hidden px-6 pb-5">
        <div className="min-h-0 flex-1 overflow-auto pb-8">
          {messages.length === 0 ? (
            <AgentWelcomeState context={context} />
          ) : (
            <AgentMessageList messages={messages} onCopyMessage={copyMessage} />
          )}
        </div>

        <AgentErrorNotice error={error} />
        <AgentComposer
          input={input}
          isSubmitting={isSubmitting}
          model={model}
          models={pickerModels}
          onInputChange={setInput}
          onModelChange={setModel}
          onSubmit={handleSubmit}
        />
      </div>
    </AgentPanelShell>
  );
}
