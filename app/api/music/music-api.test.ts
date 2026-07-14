import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getHealth } from "@/app/api/music/health/route";
import { GET as getCapabilities } from "@/app/api/music/capabilities/route";
import { GET as getJob } from "@/app/api/music/jobs/[jobId]/route";
import { GET as getJobEvents } from "@/app/api/music/jobs/[jobId]/events/route";
import { POST as performJobAction } from "@/app/api/music/jobs/[jobId]/[action]/route";
import { POST as createJob } from "@/app/api/music/jobs/route";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZENME_MUSIC_SERVICE_URL;
  delete process.env.ZENME_MUSIC_SERVICE_TOKEN;
});

describe("music service proxy", () => {
  it("keeps the bearer token on the server", async () => {
    process.env.ZENME_MUSIC_SERVICE_URL = "http://127.0.0.1:43127";
    process.env.ZENME_MUSIC_SERVICE_TOKEN = "private-session-token";
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization"))
        .toBe("Bearer private-session-token");
      return Response.json({ status: "ok", protocolVersion: 1 });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await getHealth(new Request("http://127.0.0.1:3000/api/music/health"));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("private-session-token");
  });

  it("rejects non-loopback access before contacting the service", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await getHealth(new Request("http://192.168.1.5/api/music/health"));
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns a controlled unavailable response", async () => {
    const response = await getHealth(new Request("http://localhost/api/music/health"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "unavailable" });
  });

  it("keeps old capability responses usable when profiles are absent", async () => {
    process.env.ZENME_MUSIC_SERVICE_URL = "http://127.0.0.1:43127";
    process.env.ZENME_MUSIC_SERVICE_TOKEN = "private-session-token";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      analyzers: [{ capabilities: ["metadata", "waveform"] }],
      protocolVersion: 1,
    })));

    const response = await getCapabilities(
      new Request("http://localhost/api/music/capabilities"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      analyzers: [{ capabilities: ["metadata", "waveform"] }],
      protocolVersion: 1,
    });
  });

  it("refuses a non-loopback upstream service address", async () => {
    process.env.ZENME_MUSIC_SERVICE_URL = "https://example.com";
    process.env.ZENME_MUSIC_SERVICE_TOKEN = "private-session-token";
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const response = await getHealth(new Request("http://localhost/api/music/health"));
    expect(response.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("streams SSE events while keeping authentication in the local proxy", async () => {
    process.env.ZENME_MUSIC_SERVICE_URL = "http://127.0.0.1:43127";
    process.env.ZENME_MUSIC_SERVICE_TOKEN = "private-session-token";
    const upstream = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer private-session-token");
      expect(headers.get("accept")).toBe("text/event-stream");
      return new Response("event: snapshot\ndata: {\"id\":\"job-1\"}\n\n", {
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", upstream);
    const context = {
      params: Promise.resolve({ jobId: "job-1" }),
    } as Parameters<typeof getJobEvents>[1];
    const response = await getJobEvents(
      new Request("http://localhost/api/music/jobs/job-1/events"),
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toContain("event: snapshot");
  });

  it("preserves authoritative timing and recovery stage fields", async () => {
    process.env.ZENME_MUSIC_SERVICE_URL = "http://127.0.0.1:43127";
    process.env.ZENME_MUSIC_SERVICE_TOKEN = "private-session-token";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      completedStages: ["audio-foundation"],
      durationMs: 12_345,
      elapsedMs: 12_345,
      id: "job-1",
      plannedStages: [{ stageId: "audio-foundation" }],
      status: "succeeded",
    })));
    const context = ({ params: Promise.resolve({ jobId: "job-1" }) } as Parameters<typeof getJob>[1]);

    const response = await getJob(
      new Request("http://localhost/api/music/jobs/job-1"),
      context,
    );

    await expect(response.json()).resolves.toMatchObject({
      completedStages: ["audio-foundation"],
      durationMs: 12_345,
      plannedStages: [{ stageId: "audio-foundation" }],
    });
  });

  it.each(["cancel", "retry"])("forwards the %s action to the existing job", async (action) => {
    process.env.ZENME_MUSIC_SERVICE_URL = "http://127.0.0.1:43127";
    process.env.ZENME_MUSIC_SERVICE_TOKEN = "private-session-token";
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain(`/v1/jobs/job-1/${action}`);
      expect(init?.method).toBe("POST");
      return Response.json({ id: "job-1", status: action === "retry" ? "queued" : "cancelled" });
    });
    vi.stubGlobal("fetch", upstream);
    const context = ({ params: Promise.resolve({ jobId: "job-1", action }) } as Parameters<typeof performJobAction>[1]);

    const response = await performJobAction(
      new Request(`http://localhost/api/music/jobs/job-1/${action}`, { method: "POST" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("does not accept arbitrary client input paths through the project-file proxy", async () => {
    const response = await createJob(new Request("http://localhost/api/music/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "p", fileId: "missing", inputPath: "C:/secret" }),
    }));
    expect(response.status).toBe(404);
  });
});
