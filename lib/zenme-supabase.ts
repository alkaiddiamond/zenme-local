"use client";

import { createClient } from "@/lib/supabase/client";
import {
  createProjectOriginalStoragePath,
  createProjectPreviewStoragePath,
  createProjectThumbnailStoragePath,
} from "@/lib/project-storage-paths";
import {
  mapProjectRow,
  type CanvasSnapshotPayload,
  type ProjectRow,
} from "@/lib/zenme";

export const PROJECT_ASSETS_BUCKET = "project-assets";

export function getBrowserSupabase() {
  return createClient();
}

export async function getCurrentUserId() {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

export async function listProjectsFromSupabase() {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id,name,prompt,model,thumbnail_path,created_at,updated_at,last_saved_at",
    )
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data as ProjectRow[]).map(mapProjectRow);
}

export async function createProjectInSupabase(input: {
  name: string;
  prompt: string;
  model: string;
}) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("未登录，无法创建项目");
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({ ...input, owner_id: user.id })
    .select("id,name,prompt,model,thumbnail_path,created_at,updated_at,last_saved_at")
    .single();

  if (error) {
    throw error;
  }

  const project = mapProjectRow(data as ProjectRow);

  const { error: snapshotError } = await supabase.from("canvas_snapshots").insert({
    owner_id: user.id,
    project_id: project.id,
    snapshot: {
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date().toISOString(),
    },
  });

  if (snapshotError) {
    await deleteProjectBestEffort(supabase, project.id);
    throw snapshotError;
  }

  return project;
}

async function deleteProjectBestEffort(
  supabase: ReturnType<typeof getBrowserSupabase>,
  projectId: string,
) {
  try {
    await supabase.from("projects").delete().eq("id", projectId);
  } catch {
    // Preserve the original project creation failure.
  }
}

export async function getProjectFromSupabase(projectId: string) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("projects")
    .select("id,name,prompt,model,thumbnail_path,created_at,updated_at,last_saved_at")
    .eq("id", projectId)
    .single();

  if (error) {
    throw error;
  }

  return mapProjectRow(data as ProjectRow);
}

export async function updateProjectNameInSupabase(input: {
  name: string;
  projectId: string;
}) {
  const supabase = getBrowserSupabase();
  const updatedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("projects")
    .update({
      name: input.name,
      updated_at: updatedAt,
    })
    .eq("id", input.projectId)
    .select("id,name,prompt,model,thumbnail_path,created_at,updated_at,last_saved_at")
    .single();

  if (error) {
    throw error;
  }

  return mapProjectRow(data as ProjectRow);
}

export async function createSignedUrl(path: string, expiresIn = 60 * 60) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("未登录，无法签发文件链接");
  }

  if (!isOwnedStoragePath(path, user.id)) {
    throw new Error("无权访问该文件");
  }

  const { data, error } = await supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

function isOwnedStoragePath(path: string, userId: string) {
  const [ownerId] = path.split("/");
  return ownerId === userId;
}

export async function getCanvasSnapshotFromSupabase(projectId: string) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("canvas_snapshots")
    .select("snapshot,updated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as { snapshot: CanvasSnapshotPayload; updated_at: string } | null;
}

export async function saveCanvasSnapshotToSupabase(input: {
  projectId: string;
  snapshot: CanvasSnapshotPayload;
  thumbnailPath?: string;
}) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("未登录，无法保存到 Supabase");
  }

  if (input.thumbnailPath && !isOwnedStoragePath(input.thumbnailPath, user.id)) {
    throw new Error("无权使用该缩略图路径");
  }

  const { error } = await supabase.from("canvas_snapshots").upsert(
    {
      project_id: input.projectId,
      owner_id: user.id,
      snapshot: input.snapshot,
    },
    { onConflict: "project_id" },
  );

  if (error) {
    throw error;
  }

  const { error: projectUpdateError } = await supabase
    .from("projects")
    .update({
      last_saved_at: input.snapshot.updatedAt,
      updated_at: input.snapshot.updatedAt,
      ...(input.thumbnailPath ? { thumbnail_path: input.thumbnailPath } : {}),
    })
    .eq("id", input.projectId);

  if (projectUpdateError) {
    throw projectUpdateError;
  }
}

export async function uploadProjectFileToSupabase(input: {
  projectId: string;
  file: File;
  preview?: Blob;
}) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("未登录，无法上传文件");
  }

  await assertProjectVisible(supabase, input.projectId);

  const fileId = crypto.randomUUID();
  const originalPath = createProjectOriginalStoragePath({
    fileId,
    fileName: input.file.name,
    ownerId: user.id,
    projectId: input.projectId,
  });
  const { error: originalError } = await supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .upload(originalPath, input.file, {
      contentType: input.file.type || "application/octet-stream",
      upsert: false,
    });

  if (originalError) {
    throw originalError;
  }

  let previewPath: string | null = null;

  try {
    if (input.preview) {
      previewPath = createProjectPreviewStoragePath({
        fileId,
        ownerId: user.id,
        projectId: input.projectId,
      });
      const { error: previewError } = await supabase.storage
        .from(PROJECT_ASSETS_BUCKET)
        .upload(previewPath, input.preview, {
          contentType: "image/webp",
          upsert: false,
        });

      if (previewError) {
        throw previewError;
      }
    }

    const { data, error } = await supabase
      .from("project_files")
      .insert({
        project_id: input.projectId,
        original_path: originalPath,
        preview_path: previewPath,
        file_name: input.file.name,
        mime_type: input.file.type,
        size_bytes: input.file.size,
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    return {
      fileId: (data as { id: string }).id,
      originalPath,
      previewPath,
      originalUrl: await createSignedUrl(originalPath),
      previewUrl: previewPath ? await createSignedUrl(previewPath) : undefined,
    };
  } catch (error) {
    await removeProjectStorageObjects([originalPath, previewPath]);
    throw error;
  }
}

export async function uploadProjectThumbnailToSupabase(input: {
  projectId: string;
  thumbnail: Blob;
}) {
  const supabase = getBrowserSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("未登录，无法上传画布缩略图");
  }

  await assertProjectVisible(supabase, input.projectId);

  const path = createProjectThumbnailStoragePath({
    ownerId: user.id,
    projectId: input.projectId,
  });
  const { error } = await supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .upload(path, input.thumbnail, {
      contentType: "image/webp",
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return path;
}

export type ProjectFileRow = {
  id: string;
  project_id: string;
  original_path: string;
  preview_path: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

// 列出项目下已上传的文件元数据（用于资料库侧栏）。
export async function listProjectFilesFromSupabase(projectId: string) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("project_files")
    .select(
      "id,project_id,original_path,preview_path,file_name,mime_type,size_bytes,created_at",
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data as ProjectFileRow[];
}

// 按 fileId 重新签发原图与压缩预览的签名 URL，解决签名 URL 1 小时过期问题。
export async function refreshFileSignedUrls(fileId: string) {
  const supabase = getBrowserSupabase();
  const { data, error } = await supabase
    .from("project_files")
    .select("original_path,preview_path")
    .eq("id", fileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const originalUrl = await createSignedUrl(data.original_path);
  const previewUrl = data.preview_path
    ? await createSignedUrl(data.preview_path)
    : undefined;

  return { originalUrl, previewUrl };
}

async function removeProjectStorageObjects(paths: Array<string | null | undefined>) {
  const removablePaths = paths.filter((path): path is string => Boolean(path));
  if (removablePaths.length === 0) return;

  try {
    const supabase = getBrowserSupabase();
    await supabase.storage.from(PROJECT_ASSETS_BUCKET).remove(removablePaths);
  } catch {
    // Preserve the original upload or metadata error.
  }
}

async function assertProjectVisible(
  supabase: ReturnType<typeof getBrowserSupabase>,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("项目不存在或无权访问");
  }
}
