import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), configure: vi.fn(), updateSuggestion: vi.fn(), append: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/global-agent/continuous-store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/global-agent/continuous-store")>("@/lib/global-agent/continuous-store");
  return { ...actual, reconcileContinuousAgentRuntime: mocks.reconcile, configureContinuousGlobalAgent: mocks.configure, updateContinuousAgentSuggestion: mocks.updateSuggestion, appendContinuousProjectEvent: mocks.append };
});
vi.mock("@/lib/global-agent/continuous-runtime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/global-agent/continuous-runtime")>("@/lib/global-agent/continuous-runtime");
  return { ...actual, runContinuousGlobalAgentOnce: mocks.run };
});

import { GET, PATCH, POST } from "@/app/api/projects/[projectId]/global-agent/continuous/route";

beforeEach(() => vi.clearAllMocks());
const context = { params: Promise.resolve({ projectId: "project-1" }) };

describe("Continuous Global Agent API", () => {
  it("loads and configures the recoverable runtime", async () => {
    mocks.reconcile.mockResolvedValue({ mode: "disabled" });
    mocks.configure.mockResolvedValue({ mode: "enabled" });
    const loaded = await GET(new Request("http://localhost/api"), context);
    const configured = await PATCH(new Request("http://localhost/api", { method: "PATCH", body: JSON.stringify({ action: "configure", mode: "enabled", modelId: "provider:model" }) }), context);
    expect(await loaded.json()).toEqual({ mode: "disabled" });
    expect(await configured.json()).toEqual({ mode: "enabled" });
    expect(mocks.reconcile).toHaveBeenCalledWith("project-1", expect.any(String));
    expect(mocks.configure).toHaveBeenCalledWith({ projectId: "project-1", mode: "enabled", modelId: "provider:model", budget: undefined });
  });

  it("queues a manual event and runs one bounded evaluation", async () => {
    mocks.append.mockResolvedValue({ id: "event-1" });
    mocks.run.mockResolvedValue({ ran: true, runId: "run-1" });
    const requested = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "request", requestId: "request-1", instruction: "检查状态" }) }), context);
    const run = await POST(new Request("http://localhost/api", { method: "POST", body: JSON.stringify({ action: "runOnce" }) }), context);
    expect(requested.status).toBe(201);
    expect(await run.json()).toEqual({ ran: true, runId: "run-1" });
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ type: "manual.requested", idempotencyKey: "manual:request-1" }));
  });

  it("rejects invalid modes before persistence", async () => {
    const result = await PATCH(new Request("http://localhost/api", { method: "PATCH", body: JSON.stringify({ action: "configure", mode: "always" }) }), context);
    expect(result.status).toBe(400);
    expect(mocks.configure).not.toHaveBeenCalled();
  });
});
