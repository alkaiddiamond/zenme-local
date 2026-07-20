"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import Link from "next/link";

import {
  CreateProjectCard,
  ProjectCard,
  ProjectGrid,
} from "@/components/zenme/project-card";
import {
  createModelOption,
  rememberAiModelPreference,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import {
  createProjectInApi,
  listProjectsFromApi,
} from "@/lib/zenme-api";
import {
  createProjectName,
  getProjectActivityTime,
  modelOptions,
  type ZenmeProject,
} from "@/lib/zenme";

export function DashboardClient() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(modelOptions[0]);
  const [projects, setProjects] = useState<ZenmeProject[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const configuredModels = useAiModelOptions();
  const preferredModel = configuredModels[0]?.id ?? modelOptions[0];
  const pickerModels = configuredModels.some((option) => option.id === model)
    ? configuredModels
    : [createModelOption(model), ...configuredModels];

  useEffect(() => {
    setModel(preferredModel);
  }, [preferredModel]);

  const createProject = useCallback(
    async (projectPrompt: string) => {
      if (isSubmitting) {
        return;
      }

      setIsSubmitting(true);

      try {
        const trimmedPrompt = projectPrompt.trim();

        const project = await createProjectInApi({
          name: createProjectName(trimmedPrompt),
          prompt: trimmedPrompt,
          model,
        });

        window.location.href = `/projects/${project.id}`;
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, model],
  );

  const createBlankProject = useCallback(() => {
    void createProject("");
  }, [createProject]);

  // 通过 sidebar「新建项目」入口直接创建项目。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      createBlankProject();
    }
  }, [createBlankProject]);

  useEffect(() => {
    window.addEventListener("zenme:create-new-project", createBlankProject);
    return () =>
      window.removeEventListener("zenme:create-new-project", createBlankProject);
  }, [createBlankProject]);

  useEffect(() => {
    async function loadProjects() {
      try {
        setProjects(await listProjectsFromApi());
      } catch {
        setProjects([]);
      }
    }

    loadProjects();
  }, []);

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort(
          (a, b) =>
            new Date(getProjectActivityTime(b)).getTime() -
            new Date(getProjectActivityTime(a)).getTime(),
        )
        .slice(0, 6),
    [projects],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createProject(prompt);
  }

  function handleModelChange(nextModel: string) {
    setModel(nextModel);
    void rememberAiModelPreference("text", nextModel);
  }

  return (
    <div className="zenme-dashboard-shell min-h-full bg-[var(--color-surface)] px-20 py-10">
      <section className="mx-auto flex min-h-[54vh] max-w-3xl flex-col items-center justify-center pt-6">
        <p className="mb-7 text-sm font-normal text-[var(--color-text-primary)]">
          输入提示词，开始一个项目
        </p>

        <form
          className="flex min-h-[180px] w-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4"
          onSubmit={handleSubmit}
        >
          <textarea
            aria-label="项目提示词"
            className="min-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-base leading-7 text-[var(--color-text-primary)] caret-zinc-950 outline-none"
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
            value={prompt}
          />
          <div className="mt-auto flex items-end justify-between gap-3 pt-3">
            <ZenmeModelPicker
              icon={<Sparkles className="size-4" />}
              model={model}
              models={pickerModels}
              onChange={handleModelChange}
            />
            <button
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={isSubmitting}
              title="创建本地项目"
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
      </section>

      <section className="mx-auto max-w-[1120px]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-normal text-[var(--color-text-primary)]">
            最近项目
          </h2>
          <Link
            className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)]"
            href="/projects"
          >
            查看全部
          </Link>
        </div>

        <ProjectGrid columns={4}>
          <CreateProjectCard
            disabled={isSubmitting}
            onClick={createBlankProject}
          />

          {recentProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ProjectGrid>
      </section>
    </div>
  );
}
