import { afterEach, describe, expect, it } from "vitest";

import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";

const originalEnv = {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
};

afterEach(() => {
  process.env.HTTPS_PROXY = originalEnv.HTTPS_PROXY;
  process.env.NO_PROXY = originalEnv.NO_PROXY;
});

describe("getProxyFetchOptions", () => {
  it("uses the configured proxy for external requests and bypasses loopback", () => {
    process.env.HTTPS_PROXY = "http://127.0.0.1:10809";
    process.env.NO_PROXY = "localhost,127.0.0.1,::1";

    expect(getProxyFetchOptions("https://auth.openai.com/oauth/token")).toHaveProperty("dispatcher");
    expect(getProxyFetchOptions("http://127.0.0.1:1455/auth/callback")).toEqual({});
  });
});
