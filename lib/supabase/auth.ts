import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export class ApiAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
  }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof ApiAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  return null;
}

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new ApiAuthError("请先登录", 401);
  }

  return { supabase, user };
}

export async function requireProjectAccess(projectId: string) {
  if (!projectId) {
    throw new ApiAuthError("缺少 projectId", 400);
  }

  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("projects")
    .select("id,owner_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.owner_id !== user.id) {
    throw new ApiAuthError("项目不存在或无权访问", 404);
  }

  return { project: data, supabase, user };
}

export async function requireReadingAssetAccess(
  assetId: string,
  expectedProjectId?: string,
) {
  if (!assetId) {
    throw new ApiAuthError("缺少 assetId", 400);
  }

  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("reading_assets")
    .select("id,project_id,owner_id")
    .eq("id", assetId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.owner_id !== user.id) {
    throw new ApiAuthError("阅读资料不存在", 404);
  }

  if (expectedProjectId && data.project_id !== expectedProjectId) {
    throw new ApiAuthError("项目与阅读资料不匹配", 400);
  }

  return { asset: data, supabase, user };
}

export async function requireReadingNoteAccess(noteId: string) {
  if (!noteId) {
    throw new ApiAuthError("缺少 noteId", 400);
  }

  const { supabase, user } = await requireUser();
  const { data, error } = await supabase
    .from("reading_notes")
    .select("id,asset_id,project_id,owner_id")
    .eq("id", noteId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.owner_id !== user.id) {
    throw new ApiAuthError("笔记不存在", 404);
  }

  return { note: data, supabase, user };
}
