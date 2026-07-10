"use client";

import { useEffect, useState } from "react";
import {
  CreateProjectCard,
  ProjectCard,
  ProjectGrid,
} from "@/components/zenme/project-card";
import {
  getProjectActivityTime,
  type ZenmeProject,
} from "@/lib/zenme";
import {
  listProjectsFromApi,
} from "@/lib/zenme-api";

export function ProjectsClient() {
  const [projects, setProjects] = useState<ZenmeProject[]>([]);

  useEffect(() => {
    async function loadProjects() {
      try {
        const localProjects = await listProjectsFromApi();
        setProjects(sortProjectsByActivity(localProjects));
      } catch {
        setProjects([]);
      }
    }

    loadProjects();
  }, []);

  return (
    <div className="min-h-full bg-[var(--color-surface)] px-20 py-8">
      <div className="mb-8 flex items-center gap-4">
        <h1 className="text-base font-normal tracking-normal text-[var(--color-text-primary)]">
          项目
        </h1>
      </div>

      <ProjectGrid columns={5}>
        <CreateProjectCard href="/?new=1" />

        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </ProjectGrid>
    </div>
  );
}

function sortProjectsByActivity(projects: ZenmeProject[]) {
  return [...projects].sort(
    (a, b) =>
      new Date(getProjectActivityTime(b)).getTime() -
      new Date(getProjectActivityTime(a)).getTime(),
  );
}
