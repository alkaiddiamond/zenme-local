import { describe, expect, it } from "vitest";

import { validateLocalRequest } from "./local-access";

describe("validateLocalRequest", () => {
  it("accepts same-origin loopback requests", () => {
    expect(
      validateLocalRequest(
        new Request("http://127.0.0.1:3210/api/settings", {
          headers: {
            origin: "http://127.0.0.1:3210",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).toBeNull();
    expect(
      validateLocalRequest(
        new Request("http://127.0.0.1:3210/api/ai/openai-oauth/start", {
          method: "POST",
          headers: { origin: "http://localhost:3210" },
        }),
      ),
    ).toBeNull();
  });

  it("rejects non-loopback and cross-origin requests", () => {
    expect(validateLocalRequest(new Request("http://192.168.1.5/api/settings"))).toBeTruthy();
    expect(
      validateLocalRequest(
        new Request("http://localhost:3000/api/settings", {
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBeTruthy();
    expect(
      validateLocalRequest(
        new Request("http://127.0.0.1:3000/api/settings", {
          headers: { origin: "http://localhost:3001" },
        }),
      ),
    ).toBeTruthy();
  });
});
