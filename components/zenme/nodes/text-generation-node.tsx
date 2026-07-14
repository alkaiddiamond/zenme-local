"use client";

import { type FormEvent, useEffect, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Loader2, Send, Sparkles } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  createModelOption,
  rememberAiModelPreference,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import {
  NodeActionHandle,
  NodeContextHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import { modelOptions } from "@/lib/zenme";

export function TextGenerationNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const [prompt, setPrompt] = useState(nodeData.textGenerationPrompt ?? "");
  const [model, setModel] = useState(
    nodeData.textGenerationModel ?? modelOptions[0],
  );
  const configuredModels = useAiModelOptions();
  const preferredModel = configuredModels[0]?.id ?? modelOptions[0];
  const pickerModels = configuredModels.some((option) => option.id === model)
    ? configuredModels
    : [createModelOption(model), ...configuredModels];
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isGenerating = isSubmitting || Boolean(nodeData.hasRunningGenerationChild);

  useEffect(() => {
    setPrompt(nodeData.textGenerationPrompt ?? "");
  }, [nodeData.textGenerationPrompt]);

  useEffect(() => {
    setModel(nodeData.textGenerationModel ?? preferredModel);
  }, [nodeData.textGenerationModel, preferredModel]);

  function syncPrompt() {
    nodeData.onUpdateTextGenerationNode?.(id, {
      textGenerationModel: model,
      textGenerationPrompt: prompt,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPrompt = prompt.trim();
    if (!nextPrompt || isGenerating) {
      return;
    }

    setError(null);
    setIsSubmitting(true);
    nodeData.onUpdateTextGenerationNode?.(id, {
      textGenerationModel: model,
      textGenerationPrompt: nextPrompt,
    });

    try {
      await nodeData.onSubmitTextGenerationNode?.(id, {
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
    <div className="zenme-text-generation-node group relative h-full w-full">
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextHandle selected={Boolean(selected)} />
      <div className="absolute -top-8 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <Sparkles className="size-4" />
        </span>
        文本生成
      </div>
      <form
        className={`zenme-shadow-node nodrag nowheel flex h-full min-h-[160px] w-full min-w-[360px] flex-col rounded-xl border bg-white p-3 text-zinc-950 ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
        onSubmit={submit}
      >
        <textarea
          className="zenme-text-ai-input min-h-16 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400"
          onBlur={syncPrompt}
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
          placeholder="描述任何你想要生成的内容"
          value={prompt}
        />
        {error ? (
          <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-600">
            {error}
          </p>
        ) : null}
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <div className="min-w-0 max-w-[260px]">
            <ZenmeModelPicker
              icon={<Sparkles className="size-4" />}
              model={model}
              models={pickerModels}
              onChange={(nextModel) => {
                setModel(nextModel);
                void rememberAiModelPreference("text", nextModel);
                nodeData.onUpdateTextGenerationNode?.(id, {
                  textGenerationModel: nextModel,
                  textGenerationPrompt: prompt,
                });
              }}
            />
          </div>
          <button
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={isGenerating || !prompt.trim()}
            title="提交"
            type="submit"
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </button>
        </div>
      </form>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected)}
        lineClassName="zenme-text-resize-line"
        minHeight={160}
        minWidth={360}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
}
