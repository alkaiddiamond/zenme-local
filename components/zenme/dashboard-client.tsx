"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUp, Box } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CreateProjectCard,
  ProjectCard,
  ProjectGrid,
} from "@/components/zenme/project-card";
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

  return (
    <div className="zenme-dashboard-shell min-h-full bg-[var(--color-surface)] px-20 py-10">
      <section className="mx-auto flex min-h-[54vh] max-w-3xl flex-col items-center justify-center pt-6">
        <p className="mb-7 text-sm font-normal text-[var(--color-text-primary)]">
          输入提示词，开始一个项目
        </p>

        <form
          className="relative h-[104px] w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-6 py-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)]"
          onSubmit={handleSubmit}
        >
          <Input
            className="h-10 w-[calc(100%-96px)] border-0 bg-transparent px-0 text-base text-[var(--color-text-primary)] shadow-none placeholder:text-[var(--color-text-tertiary)] focus-visible:ring-0"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="placeholder"
            value={prompt}
          />
          <select
            aria-label="选择模型"
            className="absolute bottom-5 right-16 h-9 w-9 cursor-pointer appearance-none rounded-full bg-transparent text-[0px] outline-none"
            onChange={(event) => setModel(event.target.value)}
            title={model}
            value={model}
          >
            {modelOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <Box className="absolute bottom-[30px] right-[70px] size-5 text-[var(--color-text-secondary)]" />
          <Button
            className="absolute bottom-4 right-4 size-10 rounded-full bg-[var(--color-run)] p-0 text-white shadow-none hover:bg-[var(--color-run-hover)]"
            disabled={isSubmitting}
            size="icon"
            title="创建本地项目"
            type="submit"
          >
            <ArrowUp className="size-5" />
          </Button>
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
