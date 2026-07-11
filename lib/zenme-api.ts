"use client";

import type { CanvasSnapshotPayload, ZenmeProject } from "@/lib/zenme";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "请求失败");
  }

  return response.json() as Promise<T>;
}

export async function listProjectsFromApi() {
  const projects = await readJson<ZenmeProject[]>(await fetch("/api/projects", {
    cache: "no-store",
  }));

  return projects.map(withProjectThumbnailUrl);
}

export async function createProjectInApi(input: {
  name: string;
  prompt: string;
  model: string;
}) {
  return readJson<ZenmeProject>(await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function getProjectFromApi(projectId: string) {
  const project = await readJson<ZenmeProject>(await fetch(`/api/projects/${projectId}`, {
    cache: "no-store",
  }));
  return withProjectThumbnailUrl(project);
}

export async function updateProjectNameInApi(input: {
  name: string;
  projectId: string;
}) {
  return readJson<ZenmeProject>(await fetch(`/api/projects/${input.projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: input.name }),
  }));
}

export async function deleteProjectInApi(projectId: string) {
  return readJson<{ ok: true }>(await fetch(`/api/projects/${projectId}`, {
    method: "DELETE",
  }));
}

export async function getCanvasSnapshotFromApi(projectId: string) {
  return readJson<{ snapshot: CanvasSnapshotPayload; updated_at: string } | null>(
    await fetch(`/api/projects/${projectId}/canvas`, {
      cache: "no-store",
    }),
  );
}

export async function saveCanvasSnapshotToApi(input: {
  projectId: string;
  snapshot: CanvasSnapshotPayload;
  thumbnail?: Blob | null;
}) {
  const formData = new FormData();
  formData.set("snapshot", JSON.stringify(input.snapshot));
  if (input.thumbnail) {
    formData.set("thumbnail", input.thumbnail, "thumbnail.webp");
  }

  await readJson<{ ok: true }>(await fetch(`/api/projects/${input.projectId}/canvas`, {
    method: "PUT",
    body: formData,
  }));
}

export async function uploadProjectFileToApi(input: {
  projectId: string;
  file: File;
  preview?: Blob;
}) {
  const formData = new FormData();
  formData.set("file", input.file, input.file.name);
  if (input.preview) {
    formData.set("preview", input.preview, "preview.webp");
  }

  return readJson<{
    fileId: string;
    originalPath: string;
    previewPath: string | null;
    originalUrl: string;
    previewUrl?: string;
  }>(await fetch(`/api/projects/${input.projectId}/files`, {
    method: "POST",
    body: formData,
  }));
}

export async function refreshFileSignedUrlsFromApi(_fileId: string) {
  void _fileId;
  return null;
}

export async function generateOrEditImage(input: {
  aspectRatio?: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  model: string;
  operation?: "edit" | "generate";
  prompt: string;
  quality?: string;
}) {
  return readJson<{
    b64Json: string;
    mediaType: string;
    model: string;
    revisedPrompt?: string;
    usage?: unknown;
  }>(await fetch("/api/ai/image-edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }));
}

function withProjectThumbnailUrl(project: ZenmeProject): ZenmeProject {
  if (!project.thumbnailPath) {
    return project;
  }

  return {
    ...project,
    thumbnail: `/api/projects/${project.id}/thumbnail?v=${encodeURIComponent(
      project.updatedAt,
    )}`,
  };
}
