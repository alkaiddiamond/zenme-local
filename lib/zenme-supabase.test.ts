import { beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@/lib/supabase/client";
import {
  createSignedUrl,
  createProjectInSupabase,
  getCurrentUserId,
  getProjectFromSupabase,
  listProjectsFromSupabase,
  PROJECT_ASSETS_BUCKET,
  refreshFileSignedUrls,
  saveCanvasSnapshotToSupabase,
  updateProjectNameInSupabase,
  uploadProjectThumbnailToSupabase,
  uploadProjectFileToSupabase,
} from "@/lib/zenme-supabase";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

const createClientMock = vi.mocked(createClient);

function projectRow(overrides: Partial<{
  id: string;
  last_saved_at: string | null;
  name: string;
  thumbnail_path: string | null;
  updated_at: string;
}> = {}) {
  return {
    id: overrides.id ?? "project-1",
    name: overrides.name ?? "项目",
    prompt: "prompt",
    model: "glm-4-flash",
    thumbnail_path: overrides.thumbnail_path ?? null,
    created_at: "2026-06-28T01:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-06-28T02:00:00.000Z",
    last_saved_at: overrides.last_saved_at ?? null,
  };
}

function createVisibleProjectQuery(data: { id: string } | null = { id: "project-1" }) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data,
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { eq, maybeSingle, select };
}

describe("zenme Supabase browser helpers", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns the current browser user id when signed in", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
    } as never);

    await expect(getCurrentUserId()).resolves.toBe("user-1");
  });

  it("returns null when no browser user is signed in", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as never);

    await expect(getCurrentUserId()).resolves.toBeNull();
  });

  it("lists projects ordered by update time and maps database rows", async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        projectRow({
          id: "project-2",
          last_saved_at: "2026-06-28T03:00:00.000Z",
          name: "第二个项目",
          thumbnail_path: "user/project-2/thumbnail/latest.webp",
          updated_at: "2026-06-28T04:00:00.000Z",
        }),
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    const tableFrom = vi.fn().mockReturnValue({ select });
    createClientMock.mockReturnValue({ from: tableFrom } as never);

    await expect(listProjectsFromSupabase()).resolves.toEqual([
      {
        id: "project-2",
        name: "第二个项目",
        prompt: "prompt",
        model: "glm-4-flash",
        thumbnailPath: "user/project-2/thumbnail/latest.webp",
        createdAt: "2026-06-28T01:00:00.000Z",
        updatedAt: "2026-06-28T04:00:00.000Z",
        lastSavedAt: "2026-06-28T03:00:00.000Z",
      },
    ]);
    expect(tableFrom).toHaveBeenCalledWith("projects");
    expect(select).toHaveBeenCalledWith(
      "id,name,prompt,model,thumbnail_path,created_at,updated_at,last_saved_at",
    );
    expect(order).toHaveBeenCalledWith("updated_at", { ascending: false });
  });

  it("throws Supabase errors from project listing", async () => {
    const error = new Error("list failed");
    const order = vi.fn().mockResolvedValue({ data: null, error });
    const select = vi.fn().mockReturnValue({ order });
    createClientMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await expect(listProjectsFromSupabase()).rejects.toThrow("list failed");
  });

  it("creates projects and initializes an empty canvas snapshot", async () => {
    const single = vi.fn().mockResolvedValue({
      data: projectRow({ id: "project-created", name: "新项目" }),
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const projectInsert = vi.fn().mockReturnValue({ select });
    const snapshotInsert = vi.fn().mockResolvedValue({ error: null });
    const tableFrom = vi.fn((table: string) => {
      if (table === "projects") {
        return { insert: projectInsert };
      }
      if (table === "canvas_snapshots") {
        return { insert: snapshotInsert };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: tableFrom,
    } as never);

    await expect(
      createProjectInSupabase({
        name: "新项目",
        prompt: "prompt",
        model: "glm-4-flash",
      }),
    ).resolves.toMatchObject({
      id: "project-created",
      name: "新项目",
      prompt: "prompt",
      model: "glm-4-flash",
    });

    expect(projectInsert).toHaveBeenCalledWith({
      name: "新项目",
      owner_id: "user-1",
      prompt: "prompt",
      model: "glm-4-flash",
    });
    expect(snapshotInsert).toHaveBeenCalledWith({
      owner_id: "user-1",
      project_id: "project-created",
      snapshot: {
        version: 1,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: expect.any(String),
      },
    });
  });

  it("rejects project creation before table writes when signed out", async () => {
    const projectInsert = vi.fn();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn().mockReturnValue({ insert: projectInsert }),
    } as never);

    await expect(
      createProjectInSupabase({
        name: "新项目",
        prompt: "prompt",
        model: "glm-4-flash",
      }),
    ).rejects.toThrow("未登录，无法创建项目");
    expect(projectInsert).not.toHaveBeenCalled();
  });

  it("throws when project creation succeeds but initial snapshot creation fails", async () => {
    const snapshotError = new Error("snapshot insert failed");
    const single = vi.fn().mockResolvedValue({
      data: projectRow({ id: "project-created", name: "新项目" }),
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const projectInsert = vi.fn().mockReturnValue({ select });
    const snapshotInsert = vi.fn().mockResolvedValue({ error: snapshotError });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const projectDelete = vi.fn().mockReturnValue({ eq: deleteEq });
    const tableFrom = vi.fn((table: string) => {
      if (table === "projects") {
        return { delete: projectDelete, insert: projectInsert };
      }
      if (table === "canvas_snapshots") {
        return { insert: snapshotInsert };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: tableFrom,
    } as never);

    await expect(
      createProjectInSupabase({
        name: "新项目",
        prompt: "prompt",
        model: "glm-4-flash",
      }),
    ).rejects.toThrow("snapshot insert failed");
    expect(projectDelete).toHaveBeenCalled();
    expect(deleteEq).toHaveBeenCalledWith("id", "project-created");
  });

  it("gets and renames projects through mapped Supabase rows", async () => {
    const getSingle = vi.fn().mockResolvedValue({
      data: projectRow({ id: "project-1", name: "旧名称" }),
      error: null,
    });
    const getEq = vi.fn().mockReturnValue({ single: getSingle });
    const getSelect = vi.fn().mockReturnValue({ eq: getEq });
    const updateSingle = vi.fn().mockResolvedValue({
      data: projectRow({ id: "project-1", name: "新名称" }),
      error: null,
    });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const tableFrom = vi
      .fn()
      .mockReturnValueOnce({ select: getSelect })
      .mockReturnValueOnce({ update });
    createClientMock.mockReturnValue({ from: tableFrom } as never);

    await expect(getProjectFromSupabase("project-1")).resolves.toMatchObject({
      id: "project-1",
      name: "旧名称",
    });
    await expect(
      updateProjectNameInSupabase({ projectId: "project-1", name: "新名称" }),
    ).resolves.toMatchObject({
      id: "project-1",
      name: "新名称",
    });

    expect(getEq).toHaveBeenCalledWith("id", "project-1");
    expect(update).toHaveBeenCalledWith({
      name: "新名称",
      updated_at: expect.any(String),
    });
    expect(updateEq).toHaveBeenCalledWith("id", "project-1");
  });

  it("uploads project files with storage-safe paths while preserving display names", async () => {
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("46420b32-dd19-4801-ad06-44b2c0c3eb0c");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.example.test/original" },
      error: null,
    });
    const storageFrom = vi.fn().mockReturnValue({ createSignedUrl, upload });
    const single = vi.fn().mockResolvedValue({
      data: { id: "file-1" },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const visibleProject = createVisibleProjectQuery();
    const tableFrom = vi.fn((table: string) => {
      if (table === "projects") return { select: visibleProject.select };
      if (table === "project_files") return { insert };
      throw new Error(`Unexpected table ${table}`);
    });

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "e42f7dfb-72cc-4042-aa20-731adc4263ba" } },
        }),
      },
      from: tableFrom,
      storage: { from: storageFrom },
    } as never);

    const file = new File(
      ["book"],
      "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_.epub",
      { type: "application/epub+zip" },
    );

    try {
      await expect(
        uploadProjectFileToSupabase({
          file,
          projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
        }),
      ).resolves.toEqual({
        fileId: "file-1",
        originalPath:
          "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
        originalUrl: "https://signed.example.test/original",
        previewPath: null,
        previewUrl: undefined,
      });
    } finally {
      randomUUID.mockRestore();
    }

    expect(storageFrom).toHaveBeenCalledWith(PROJECT_ASSETS_BUCKET);
    expect(visibleProject.eq).toHaveBeenCalledWith(
      "id",
      "bebae9e5-24db-45a9-88aa-43dc79816c5a",
    );
    expect(upload).toHaveBeenCalledWith(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
      file,
      { contentType: "application/epub+zip", upsert: false },
    );
    expect(upload.mock.calls[0][0]).not.toContain("地师");
    expect(insert).toHaveBeenCalledWith({
      file_name: "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_.epub",
      mime_type: "application/epub+zip",
      original_path:
        "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
      preview_path: null,
      project_id: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
      size_bytes: 4,
    });
  });

  it("throws storage errors from original project file uploads before metadata writes", async () => {
    const uploadError = new Error("storage upload failed");
    const upload = vi.fn().mockResolvedValue({ error: uploadError });
    const insert = vi.fn();
    const visibleProject = createVisibleProjectQuery();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "projects") return { select: visibleProject.select };
        if (table === "project_files") return { insert };
        throw new Error(`Unexpected table ${table}`);
      }),
      storage: { from: vi.fn().mockReturnValue({ upload }) },
    } as never);

    await expect(
      uploadProjectFileToSupabase({
        file: new File(["book"], "book.epub", { type: "application/epub+zip" }),
        projectId: "project-1",
      }),
    ).rejects.toThrow("storage upload failed");
    expect(insert).not.toHaveBeenCalled();
  });

  it("removes original project files when preview uploads fail", async () => {
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("46420b32-dd19-4801-ad06-44b2c0c3eb0c");
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: new Error("preview upload failed") });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const insert = vi.fn();
    const visibleProject = createVisibleProjectQuery();
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "e42f7dfb-72cc-4042-aa20-731adc4263ba" } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "projects") return { select: visibleProject.select };
        if (table === "project_files") return { insert };
        throw new Error(`Unexpected table ${table}`);
      }),
      storage: { from: vi.fn().mockReturnValue({ remove, upload }) },
    };
    createClientMock.mockReturnValue(supabase as never);

    try {
      await expect(
        uploadProjectFileToSupabase({
          file: new File(["png"], "照片.png", { type: "image/png" }),
          preview: new Blob(["webp"], { type: "image/webp" }),
          projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
        }),
      ).rejects.toThrow("preview upload failed");
    } finally {
      randomUUID.mockRestore();
    }

    expect(insert).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith([
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.png",
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/preview/46420b32-dd19-4801-ad06-44b2c0c3eb0c.webp",
    ]);
  });

  it("removes uploaded project files when metadata writes fail", async () => {
    const randomUUID = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("46420b32-dd19-4801-ad06-44b2c0c3eb0c");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("metadata insert failed"),
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    const visibleProject = createVisibleProjectQuery();
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "e42f7dfb-72cc-4042-aa20-731adc4263ba" } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "projects") return { select: visibleProject.select };
        if (table === "project_files") return { insert };
        throw new Error(`Unexpected table ${table}`);
      }),
      storage: { from: vi.fn().mockReturnValue({ remove, upload }) },
    };
    createClientMock.mockReturnValue(supabase as never);

    try {
      await expect(
        uploadProjectFileToSupabase({
          file: new File(["png"], "照片.png", { type: "image/png" }),
          preview: new Blob(["webp"], { type: "image/webp" }),
          projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
        }),
      ).rejects.toThrow("metadata insert failed");
    } finally {
      randomUUID.mockRestore();
    }

    expect(remove).toHaveBeenCalledWith([
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.png",
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/preview/46420b32-dd19-4801-ad06-44b2c0c3eb0c.webp",
    ]);
  });

  it("creates signed URLs only for the current user's storage prefix", async () => {
    const createSignedUrlMock = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.example.test/file" },
      error: null,
    });
    const storageFrom = vi.fn().mockReturnValue({
      createSignedUrl: createSignedUrlMock,
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      storage: { from: storageFrom },
    } as never);

    await expect(
      createSignedUrl("user-1/project-1/original/file.webp", 120),
    ).resolves.toBe("https://signed.example.test/file");

    expect(storageFrom).toHaveBeenCalledWith(PROJECT_ASSETS_BUCKET);
    expect(createSignedUrlMock).toHaveBeenCalledWith(
      "user-1/project-1/original/file.webp",
      120,
    );
  });

  it("rejects signed URL creation for missing users or other users' paths", async () => {
    createClientMock.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      storage: { from: vi.fn() },
    } as never);

    await expect(createSignedUrl("user-1/project-1/file.webp")).rejects.toThrow(
      "未登录，无法签发文件链接",
    );

    const createSignedUrlMock = vi.fn();
    createClientMock.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      storage: {
        from: vi.fn().mockReturnValue({ createSignedUrl: createSignedUrlMock }),
      },
    } as never);

    await expect(createSignedUrl("user-2/project-1/file.webp")).rejects.toThrow(
      "无权访问该文件",
    );
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("uploads project thumbnails into the current user's private storage prefix", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const storageFrom = vi.fn().mockReturnValue({ upload });
    const visibleProject = createVisibleProjectQuery();

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "e42f7dfb-72cc-4042-aa20-731adc4263ba" } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "projects") return { select: visibleProject.select };
        throw new Error(`Unexpected table ${table}`);
      }),
      storage: { from: storageFrom },
    } as never);

    const thumbnail = new Blob(["webp"], { type: "image/webp" });

    await expect(
      uploadProjectThumbnailToSupabase({
        projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
        thumbnail,
      }),
    ).resolves.toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/thumbnail/latest.webp",
    );

    expect(storageFrom).toHaveBeenCalledWith(PROJECT_ASSETS_BUCKET);
    expect(upload).toHaveBeenCalledWith(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/thumbnail/latest.webp",
      thumbnail,
      { contentType: "image/webp", upsert: true },
    );
  });

  it("rejects project file and thumbnail uploads before storage writes when the project is not visible", async () => {
    const upload = vi.fn();
    const invisibleProject = createVisibleProjectQuery(null);
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "projects") return { select: invisibleProject.select };
        throw new Error(`Unexpected table ${table}`);
      }),
      storage: { from: vi.fn().mockReturnValue({ upload }) },
    } as never);

    await expect(
      uploadProjectFileToSupabase({
        file: new File(["book"], "book.epub", { type: "application/epub+zip" }),
        projectId: "project-missing",
      }),
    ).rejects.toThrow("项目不存在或无权访问");
    expect(upload).not.toHaveBeenCalled();

    await expect(
      uploadProjectThumbnailToSupabase({
        projectId: "project-missing",
        thumbnail: new Blob(["webp"], { type: "image/webp" }),
      }),
    ).rejects.toThrow("项目不存在或无权访问");
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects project thumbnail uploads before storage writes when signed out", async () => {
    const upload = vi.fn();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      storage: { from: vi.fn().mockReturnValue({ upload }) },
    } as never);

    await expect(
      uploadProjectThumbnailToSupabase({
        projectId: "project-1",
        thumbnail: new Blob(["webp"], { type: "image/webp" }),
      }),
    ).rejects.toThrow("未登录，无法上传画布缩略图");
    expect(upload).not.toHaveBeenCalled();
  });

  it("refreshes signed URLs for stored project file paths", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        original_path: "user/project/original/file.webp",
        preview_path: "user/project/preview/file.webp",
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const tableFrom = vi.fn().mockReturnValue({ select });
    const createSignedUrl = vi
      .fn()
      .mockResolvedValueOnce({
        data: { signedUrl: "https://signed.example.test/original" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: "https://signed.example.test/preview" },
        error: null,
      });
    const storageFrom = vi.fn().mockReturnValue({ createSignedUrl });

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user" } },
        }),
      },
      from: tableFrom,
      storage: { from: storageFrom },
    } as never);

    await expect(refreshFileSignedUrls("file-1")).resolves.toEqual({
      originalUrl: "https://signed.example.test/original",
      previewUrl: "https://signed.example.test/preview",
    });

    expect(tableFrom).toHaveBeenCalledWith("project_files");
    expect(select).toHaveBeenCalledWith("original_path,preview_path");
    expect(eq).toHaveBeenCalledWith("id", "file-1");
    expect(storageFrom).toHaveBeenCalledWith(PROJECT_ASSETS_BUCKET);
    expect(createSignedUrl).toHaveBeenNthCalledWith(
      1,
      "user/project/original/file.webp",
      60 * 60,
    );
    expect(createSignedUrl).toHaveBeenNthCalledWith(
      2,
      "user/project/preview/file.webp",
      60 * 60,
    );
  });

  it("returns null when refreshing URLs for a missing project file row", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const storageFrom = vi.fn();

    createClientMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
      storage: { from: storageFrom },
    } as never);

    await expect(refreshFileSignedUrls("missing-file")).resolves.toBeNull();
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("saves canvas snapshots for the current user and updates project timestamps", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    const tableFrom = vi.fn((table: string) => {
      if (table === "canvas_snapshots") {
        return { upsert };
      }
      if (table === "projects") {
        return { update };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const snapshot = {
      edges: [],
      nodes: [],
      updatedAt: "2026-06-28T12:00:00.000Z",
      version: 1,
      viewport: { x: 1, y: 2, zoom: 1.25 },
    } as const;

    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "e42f7dfb-72cc-4042-aa20-731adc4263ba" } },
        }),
      },
      from: tableFrom,
    } as never);

    await expect(
      saveCanvasSnapshotToSupabase({
        projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
        snapshot,
        thumbnailPath:
          "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/thumbnail/latest.webp",
      }),
    ).resolves.toBeUndefined();

    expect(tableFrom).toHaveBeenCalledWith("canvas_snapshots");
    expect(upsert).toHaveBeenCalledWith(
      {
        owner_id: "e42f7dfb-72cc-4042-aa20-731adc4263ba",
        project_id: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
        snapshot,
      },
      { onConflict: "project_id" },
    );
    expect(tableFrom).toHaveBeenCalledWith("projects");
    expect(update).toHaveBeenCalledWith({
      last_saved_at: "2026-06-28T12:00:00.000Z",
      thumbnail_path:
        "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/thumbnail/latest.webp",
      updated_at: "2026-06-28T12:00:00.000Z",
    });
    expect(eq).toHaveBeenCalledWith(
      "id",
      "bebae9e5-24db-45a9-88aa-43dc79816c5a",
    );
  });

  it("throws when canvas snapshot saves fail while updating the project row", async () => {
    const projectUpdateError = new Error("project update failed");
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: projectUpdateError });
    const update = vi.fn().mockReturnValue({ eq });
    const tableFrom = vi.fn((table: string) => {
      if (table === "canvas_snapshots") {
        return { upsert };
      }
      if (table === "projects") {
        return { update };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: tableFrom,
    } as never);

    await expect(
      saveCanvasSnapshotToSupabase({
        projectId: "project-1",
        snapshot: {
          edges: [],
          nodes: [],
          updatedAt: "2026-06-28T12:00:00.000Z",
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
    ).rejects.toThrow("project update failed");
  });

  it("rejects canvas snapshot saves with thumbnail paths outside the current user prefix", async () => {
    const upsert = vi.fn();
    const update = vi.fn();
    const tableFrom = vi.fn((table: string) => {
      if (table === "canvas_snapshots") {
        return { upsert };
      }
      if (table === "projects") {
        return { update };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: tableFrom,
    } as never);

    await expect(
      saveCanvasSnapshotToSupabase({
        projectId: "project-1",
        snapshot: {
          edges: [],
          nodes: [],
          updatedAt: "2026-06-28T12:00:00.000Z",
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        thumbnailPath: "user-2/project-1/thumbnail/latest.webp",
      }),
    ).rejects.toThrow("无权使用该缩略图路径");

    expect(upsert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects canvas snapshot saves before table writes when signed out", async () => {
    const upsert = vi.fn();
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: vi.fn().mockReturnValue({ upsert }),
    } as never);

    await expect(
      saveCanvasSnapshotToSupabase({
        projectId: "project-1",
        snapshot: {
          edges: [],
          nodes: [],
          updatedAt: "2026-06-28T12:00:00.000Z",
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      }),
    ).rejects.toThrow("未登录，无法保存到 Supabase");
    expect(upsert).not.toHaveBeenCalled();
  });
});
