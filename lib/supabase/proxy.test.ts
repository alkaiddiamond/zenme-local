import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createServerClient } from "@supabase/ssr";

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

const createServerClientMock = vi.mocked(createServerClient);
const ORIGINAL_ENV = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  ZENME_STORAGE_DRIVER: process.env.ZENME_STORAGE_DRIVER,
};

function requestFor(pathname: string) {
  return new NextRequest(`https://zenme.test${pathname}`);
}

async function importUpdateSession() {
  const proxyModule = await import("./proxy");

  return proxyModule.updateSession;
}

function setSupabaseEnv() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-ref.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
}

function clearSupabaseEnv() {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
}

function setSupabaseStorageDriver() {
  process.env.ZENME_STORAGE_DRIVER = "supabase";
}

function setProductionEnv() {
  process.env.VERCEL_ENV = "production";
}

function setPreviewEnv() {
  process.env.VERCEL_ENV = "preview";
}

describe("Supabase proxy session guard", () => {
  beforeEach(() => {
    vi.resetModules();
    createServerClientMock.mockReset();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_ENV.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      ORIGINAL_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
    process.env.VERCEL_ENV = ORIGINAL_ENV.VERCEL_ENV;
    process.env.ZENME_STORAGE_DRIVER = ORIGINAL_ENV.ZENME_STORAGE_DRIVER;
  });

  it("skips auth checks in non-production when Supabase env vars are missing", async () => {
    clearSupabaseEnv();
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/projects"));

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("fails closed for production API requests when Supabase env vars are missing", async () => {
    clearSupabaseEnv();
    setSupabaseStorageDriver();
    setProductionEnv();
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/api/reading/assets"));

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase 环境变量未配置",
    });
  });

  it("fails closed for preview API requests when Supabase env vars are missing", async () => {
    clearSupabaseEnv();
    setSupabaseStorageDriver();
    setPreviewEnv();
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/api/reading/assets"));

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Supabase 环境变量未配置",
    });
  });

  it("redirects production page requests to auth error when Supabase env vars are missing", async () => {
    clearSupabaseEnv();
    setSupabaseStorageDriver();
    setProductionEnv();
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/projects"));

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://zenme.test/auth/error?error=supabase_config_missing",
    );
  });

  it("allows the auth error page when production Supabase env vars are missing", async () => {
    clearSupabaseEnv();
    setSupabaseStorageDriver();
    setProductionEnv();
    const updateSession = await importUpdateSession();
    const response = await updateSession(
      requestFor("/auth/error?error=supabase_config_missing"),
    );

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("allows local mode in production without Supabase env vars", async () => {
    clearSupabaseEnv();
    process.env.ZENME_STORAGE_DRIVER = "local";
    setProductionEnv();
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/projects"));

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("returns 401 JSON for unauthenticated API requests", async () => {
    setSupabaseEnv();
    createServerClientMock.mockReturnValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: { claims: null } }),
      },
    } as never);
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/api/reading/assets"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录" });
  });

  it("redirects unauthenticated page requests to login", async () => {
    setSupabaseEnv();
    createServerClientMock.mockReturnValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: { claims: null } }),
      },
    } as never);
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/projects/project-1"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://zenme.test/auth/login");
  });

  it("allows unauthenticated auth pages", async () => {
    setSupabaseEnv();
    createServerClientMock.mockReturnValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: { claims: null } }),
      },
    } as never);
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/auth/login"));

    expect(response.status).toBe(200);
  });

  it("allows authenticated protected requests", async () => {
    setSupabaseEnv();
    createServerClientMock.mockReturnValueOnce({
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: { claims: { sub: "user-1" } },
        }),
      },
    } as never);
    const updateSession = await importUpdateSession();
    const response = await updateSession(requestFor("/projects"));

    expect(response.status).toBe(200);
  });
});
