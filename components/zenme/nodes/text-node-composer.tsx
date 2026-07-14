"use client";

import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { useViewport } from "@xyflow/react";
import { Loader2, Send, Sparkles } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  createModelOption,
  rememberAiModelPreference,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import { modelOptions } from "@/lib/zenme";

export function TextNodeComposer({
  nodeData,
  nodeId,
}: {
  nodeData: CanvasNodeData;
  nodeId: string;
}) {
  const { zoom } = useViewport();
  const [prompt, setPrompt] = useState(nodeData.textGenerationPrompt ?? "");
  const [model, setModel] = useState(
    nodeData.textGenerationModel ?? modelOptions[0],
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const configuredModels = useAiModelOptions();
  const preferredModel = configuredModels[0]?.id ?? modelOptions[0];
  const pickerModels = configuredModels.some((option) => option.id === model)
    ? configuredModels
    : [createModelOption(model), ...configuredModels];
  const composerScale = 1 / Math.max(zoom, 0.2);
  const composerStyle: CSSProperties = {
    top: `calc(100% + ${12 / Math.max(zoom, 0.2)}px)`,
    transform: `translateX(-50%) scale(${composerScale})`,
    transformOrigin: "top center",
  };

  useEffect(() => {
    setPrompt(nodeData.textGenerationPrompt ?? "");
  }, [nodeData.textGenerationPrompt]);

  useEffect(() => {
    setModel(nodeData.textGenerationModel ?? preferredModel);
  }, [nodeData.textGenerationModel, preferredModel]);

  function syncComposerState(nextState?: {
    model?: string;
    prompt?: string;
  }) {
    nodeData.onUpdateTextGenerationNode?.(nodeId, {
      textGenerationModel: nextState?.model ?? model,
      textGenerationPrompt: nextState?.prompt ?? prompt,
    });
  }

  function handleModelChange(nextModel: string) {
    setModel(nextModel);
    syncComposerState({ model: nextModel });
    void rememberAiModelPreference("text", nextModel);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isSubmitting) {
      return;
    }

    setError(null);
    setIsSubmitting(true);
    syncComposerState({ prompt: nextPrompt });
    try {
      await nodeData.onSubmitTextGenerationNode?.(nodeId, {
        model,
        prompt: nextPrompt,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "文本生成失败",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="zenme-node-floating-control zenme-shadow-canvas nodrag nowheel absolute left-1/2 z-50 flex min-h-[220px] w-[640px] max-w-[calc(100vw-48px)] flex-col rounded-xl border border-zinc-200 bg-white p-3 text-zinc-950"
      onSubmit={submit}
      style={composerStyle}
    >
      <textarea
        className="zenme-text-ai-input min-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-6 text-zinc-900 caret-zinc-950 outline-none placeholder:text-zinc-400 focus:placeholder:text-transparent"
        onBlur={() => syncComposerState()}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          ) {
            return;
          }

          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="基于这个节点继续提问或生成内容..."
        value={prompt}
      />
      {error ? (
        <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-600">
          {error}
        </p>
      ) : null}
      {isSubmitting ? (
        <div className="mt-2 flex items-center gap-2 px-1 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" />
          AI 正在生成回复...
        </div>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <ZenmeModelPicker
          icon={<Sparkles className="size-4" />}
          model={model}
          models={pickerModels}
          onChange={handleModelChange}
        />
        <button
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={isSubmitting || !prompt.trim()}
          title="提交"
          type="submit"
        >
          {isSubmitting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </div>
    </form>
  );
}
