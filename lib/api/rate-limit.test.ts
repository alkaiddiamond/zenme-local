import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkRateLimit,
  getClientIp,
  resetRateLimitBuckets,
} from "./rate-limit";

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetRateLimitBuckets();
  });

  it("allows requests while the bucket is under the limit", () => {
    expect(
      checkRateLimit({ key: "user:1", limit: 2, windowMs: 60_000 }),
    ).toBeNull();
    expect(
      checkRateLimit({ key: "user:1", limit: 2, windowMs: 60_000 }),
    ).toBeNull();
  });

  it("returns 429 with Retry-After after the limit is exceeded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));

    expect(
      checkRateLimit({ key: "user:1", limit: 1, windowMs: 60_000 }),
    ).toBeNull();

    const response = checkRateLimit({
      key: "user:1",
      limit: 1,
      windowMs: 60_000,
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    await expect(response?.json()).resolves.toEqual({
      error: "请求过于频繁，请稍后再试",
    });
  });

  it("starts a new bucket after the window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T00:00:00.000Z"));

    expect(
      checkRateLimit({ key: "user:1", limit: 1, windowMs: 60_000 }),
    ).toBeNull();

    vi.setSystemTime(new Date("2026-06-28T00:01:01.000Z"));

    expect(
      checkRateLimit({ key: "user:1", limit: 1, windowMs: 60_000 }),
    ).toBeNull();
  });
});

describe("getClientIp", () => {
  it("uses the first x-forwarded-for address", () => {
    const request = new Request("https://example.test", {
      headers: {
        "x-forwarded-for": "203.0.113.1, 203.0.113.2",
      },
    });

    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip and unknown", () => {
    expect(
      getClientIp(
        new Request("https://example.test", {
          headers: { "x-real-ip": "198.51.100.10" },
        }),
      ),
    ).toBe("198.51.100.10");
    expect(getClientIp(new Request("https://example.test"))).toBe("unknown");
  });
});
