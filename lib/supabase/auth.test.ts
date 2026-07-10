import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiAuthError,
  authErrorResponse,
  requireProjectAccess,
  requireReadingAssetAccess,
  requireReadingNoteAccess,
  requireUser,
} from "./auth";
import { createClient } from "./server";

vi.mock("./server", () => ({
  createClient: vi.fn(),
}));

const createClientMock = vi.mocked(createClient);

describe("authErrorResponse", () => {
  it("maps ApiAuthError to a JSON response", async () => {
    const response = authErrorResponse(new ApiAuthError("请先登录", 401));

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "请先登录" });
  });

  it("ignores non-auth errors", () => {
    expect(authErrorResponse(new Error("boom"))).toBeNull();
  });

  it("only exposes stable literal messages from ApiAuthError", () => {
    const source = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
    const constructions = Array.from(
      source.matchAll(/new ApiAuthError\((?<message>[^,\n)]+)/g),
    );

    expect(constructions.length).toBeGreaterThan(0);
    for (const construction of constructions) {
      expect(construction.groups?.message.trim()).toMatch(/^"[^"]+"$/);
    }
    expect(source).not.toMatch(/new ApiAuthError\(`/);
  });
});

describe("requireUser", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("throws 401 when Supabase has no authenticated user", async () => {
    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    } as never);

    await expect(requireUser()).rejects.toMatchObject({
      message: "请先登录",
      status: 401,
    });
  });

  it("returns the Supabase client and user when authenticated", async () => {
    const user = { id: "user-1" };
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user },
          error: null,
        }),
      },
    };
    createClientMock.mockResolvedValueOnce(supabase as never);

    await expect(requireUser()).resolves.toEqual({ supabase, user });
  });
});

describe("requireProjectAccess", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("throws 400 when projectId is empty", async () => {
    await expect(requireProjectAccess("")).rejects.toMatchObject({
      message: "缺少 projectId",
      status: 400,
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("throws 404 when the project is not visible to the user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    } as never);

    await expect(requireProjectAccess("project-1")).rejects.toMatchObject({
      message: "项目不存在或无权访问",
      status: 404,
    });
    expect(from).toHaveBeenCalledWith("projects");
    expect(eq).toHaveBeenCalledWith("id", "project-1");
  });

  it("throws 404 when the project row belongs to another user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "project-1", owner_id: "user-2" },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    } as never);

    await expect(requireProjectAccess("project-1")).rejects.toMatchObject({
      message: "项目不存在或无权访问",
      status: 404,
    });
  });
});

describe("requireReadingAssetAccess", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("throws 400 when assetId is empty", async () => {
    await expect(requireReadingAssetAccess("")).rejects.toMatchObject({
      message: "缺少 assetId",
      status: 400,
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("throws 404 when the asset is not visible to the user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    } as never);

    await expect(requireReadingAssetAccess("asset-1")).rejects.toMatchObject({
      message: "阅读资料不存在",
      status: 404,
    });
    expect(from).toHaveBeenCalledWith("reading_assets");
    expect(eq).toHaveBeenCalledWith("id", "asset-1");
  });

  it("throws 404 when the asset row belongs to another user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "asset-1",
        owner_id: "user-2",
        project_id: "project-1",
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await expect(requireReadingAssetAccess("asset-1")).rejects.toMatchObject({
      message: "阅读资料不存在",
      status: 404,
    });
  });

  it("throws 400 when the expected project does not match the asset", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "asset-1",
        owner_id: "user-1",
        project_id: "project-1",
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await expect(
      requireReadingAssetAccess("asset-1", "project-2"),
    ).rejects.toMatchObject({
      message: "项目与阅读资料不匹配",
      status: 400,
    });
  });
});

describe("requireReadingNoteAccess", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("throws 400 when noteId is empty", async () => {
    await expect(requireReadingNoteAccess("")).rejects.toMatchObject({
      message: "缺少 noteId",
      status: 400,
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("throws 404 when the note is not visible to the user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from,
    } as never);

    await expect(requireReadingNoteAccess("note-1")).rejects.toMatchObject({
      message: "笔记不存在",
      status: 404,
    });
    expect(from).toHaveBeenCalledWith("reading_notes");
    expect(eq).toHaveBeenCalledWith("id", "note-1");
  });

  it("throws 404 when the note row belongs to another user", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        asset_id: "asset-1",
        id: "note-1",
        owner_id: "user-2",
        project_id: "project-1",
      },
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });

    createClientMock.mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
          error: null,
        }),
      },
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    await expect(requireReadingNoteAccess("note-1")).rejects.toMatchObject({
      message: "笔记不存在",
      status: 404,
    });
  });
});
