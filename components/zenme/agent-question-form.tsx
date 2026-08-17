"use client";

import { Check } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";

export type AgentQuestion = {
  question: string;
  header: string;
  options: Array<{ label: string; description?: string; preview?: string }>;
  multiSelect: boolean;
};

export type AgentQuestionSubmission = {
  answers: Record<string, string>;
  annotations?: Record<string, { notes?: string; preview?: string }>;
};

export function agentQuestionsFromOutput(output: unknown): AgentQuestion[] {
  if (!isObject(output)) return [];
  if (Array.isArray(output.questions)) {
    const questions = output.questions.flatMap((item) => normalizeQuestion(item));
    if (questions.length) return questions;
  }
  if (typeof output.question !== "string" || !output.question.trim()) return [];
  return [{
    question: output.question,
    header: "问题",
    options: normalizeOptions(output.options),
    multiSelect: false,
  }];
}

export function AgentQuestionForm({
  disabled,
  questions,
  onSubmit,
}: {
  disabled?: boolean;
  questions: AgentQuestion[];
  onSubmit: (submission: AgentQuestionSubmission) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const submission = useMemo(() => buildAgentQuestionSubmission(questions, selected, notes), [notes, questions, selected]);
  const complete = questions.length > 0 && questions.every((question) => Boolean(submission.answers[question.question]?.trim()));

  function toggle(question: AgentQuestion, label: string) {
    setSelected((current) => {
      const existing = current[question.question] ?? [];
      const next = question.multiSelect
        ? existing.includes(label) ? existing.filter((item) => item !== label) : [...existing, label]
        : [label];
      return { ...current, [question.question]: next };
    });
  }

  return (
    <div className="space-y-4">
      {questions.map((question, index) => (
        <section className="space-y-2" key={question.question}>
          <div className="flex items-start gap-2">
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">{question.header || `问题 ${index + 1}`}</span>
            <p className="min-w-0 flex-1 font-medium text-zinc-800">{question.question}</p>
          </div>
          {question.options.length ? <div className="grid gap-2">{question.options.map((option) => {
            const active = (selected[question.question] ?? []).includes(option.label);
            return (
              <div className={`rounded-lg border transition ${active ? "border-zinc-900 bg-zinc-100" : "border-zinc-200 bg-zinc-50 hover:border-zinc-400"}`} key={option.label}>
                <button className="w-full px-3 py-2 text-left" disabled={disabled} onClick={() => toggle(question, option.label)} type="button">
                  <span className="flex items-center gap-2 font-medium text-zinc-800">{question.multiSelect ? <span className={`flex size-4 items-center justify-center rounded border ${active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>{active ? <Check className="size-3" /> : null}</span> : null}{option.label}</span>
                  {option.description ? <span className="mt-0.5 block text-zinc-500">{option.description}</span> : null}
                </button>
                {active && option.preview ? (
                  <OverlayScrollArea className="mx-3 mb-3 max-h-52 rounded bg-white" contentKey={option.preview} viewportClassName="max-h-52 overflow-auto p-2">
                    <pre className="whitespace-pre-wrap text-[11px] text-zinc-600">{option.preview}</pre>
                  </OverlayScrollArea>
                ) : null}
              </div>
            );
          })}</div> : null}
          <textarea aria-label={`其他回答：${question.question}`} className="min-h-16 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-5 outline-none focus:border-zinc-500" disabled={disabled} onChange={(event) => setNotes((current) => ({ ...current, [question.question]: event.target.value }))} placeholder="输入其他回答或补充说明…" value={notes[question.question] ?? ""} />
        </section>
      ))}
      <Button className="h-8 bg-zinc-950 px-3 text-white hover:bg-zinc-800" disabled={!complete || disabled} onClick={() => onSubmit(submission)} type="button"><Check className="mr-1 size-3.5" />提交回答并继续</Button>
    </div>
  );
}

export function buildAgentQuestionSubmission(
  questions: AgentQuestion[],
  selected: Record<string, string[]>,
  notes: Record<string, string>,
): AgentQuestionSubmission {
  const answers = Object.fromEntries(questions.flatMap((question) => {
      const optionAnswer = (selected[question.question] ?? []).join(", ");
      const note = notes[question.question]?.trim() ?? "";
      const value = optionAnswer || note;
      return value ? [[question.question, value]] : [];
  }));
  const annotations = Object.fromEntries(questions.flatMap((question) => {
    const selectedOptions = question.options.filter((option) => (selected[question.question] ?? []).includes(option.label));
    const preview = selectedOptions.map((option) => option.preview?.trim()).filter(Boolean).join("\n\n");
    const note = notes[question.question]?.trim() ?? "";
    if (!selectedOptions.length || (!preview && !note)) return [];
    return [[question.question, { ...(preview ? { preview } : {}), ...(note ? { notes: note } : {}) }]];
  }));
  return { answers, ...(Object.keys(annotations).length ? { annotations } : {}) };
}

function normalizeQuestion(value: unknown): AgentQuestion[] {
  if (!isObject(value) || typeof value.question !== "string" || !value.question.trim()) return [];
  return [{
    question: value.question,
    header: typeof value.header === "string" ? value.header : "问题",
    options: normalizeOptions(value.options),
    multiSelect: value.multiSelect === true,
  }];
}

function normalizeOptions(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => isObject(item) && typeof item.label === "string"
    ? [{ label: item.label, ...(typeof item.description === "string" ? { description: item.description } : {}), ...(typeof item.preview === "string" ? { preview: item.preview } : {}) }]
    : []) : [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
