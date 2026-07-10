"use client";

import { Clock3, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { ZenmeProject } from "@/lib/zenme";

type ProjectGridProps = {
  children: ReactNode;
  columns?: 4 | 5;
};

export function ProjectGrid({ children, columns = 4 }: ProjectGridProps) {
  const gridClass =
    columns === 5
      ? "grid grid-cols-5 items-start gap-x-4 gap-y-9"
      : "grid grid-cols-4 items-start gap-4";

  return <div className={gridClass}>{children}</div>;
}

export function ProjectCard({ project }: { project: ZenmeProject }) {
  return (
    <Link
      className="group flex w-full flex-col"
      href={`/projects/${project.id}`}
    >
      <ProjectCardMedia thumbnail={project.thumbnail} />
      <p className="mt-3 truncate text-sm font-normal text-[var(--color-text-primary)]">
        {project.name}
      </p>
      <ProjectUpdatedAt updatedAt={project.updatedAt} />
    </Link>
  );
}

type CreateProjectCardProps = {
  disabled?: boolean;
  href?: string;
  onClick?: () => void;
};

export function CreateProjectCard({
  disabled,
  href,
  onClick,
}: CreateProjectCardProps) {
  const content = (
    <>
      <div className="zenme-project-card-media flex items-center justify-center border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)] transition group-hover:border-[var(--color-brand)] group-hover:text-[var(--color-brand)]">
        <Plus className="size-7" />
      </div>
      <p className="mt-3 text-sm font-normal text-[var(--color-text-primary)]">新建项目</p>
    </>
  );

  if (href) {
    return (
      <Link className="group flex w-full flex-col" href={href}>
        {content}
      </Link>
    );
  }

  return (
    <button
      className="group flex w-full appearance-none flex-col bg-transparent p-0 text-left disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  );
}

function ProjectCardMedia({ thumbnail }: { thumbnail?: string }) {
  return (
    <div className="zenme-project-card-media border-[var(--color-border)] transition group-hover:border-[var(--color-brand)]">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="block h-full w-full object-contain"
          src={thumbnail}
        />
      ) : null}
    </div>
  );
}

function ProjectUpdatedAt({ updatedAt }: { updatedAt: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
      <Clock3 className="size-3" />
      更新于{" "}
      {new Date(updatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
    </p>
  );
}
