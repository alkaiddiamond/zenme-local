import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadingAsset } from "./assets";

describe("reading asset storage path integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps uploaded Chinese file names out of Supabase Storage object keys", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "46420b32-dd19-4801-ad06-44b2c0c3eb0c",
    );
    const upload = vi.fn().mockResolvedValue({ error: null });
    const supabase = createReadingAssetSupabaseMock(upload);

    await createReadingAsset({
      bytes: Buffer.from("book"),
      fileName: "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_.epub",
      mimeType: "application/epub+zip",
      ownerId: "e42f7dfb-72cc-4042-aa20-731adc4263ba",
      projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
      supabase,
    });

    expect(upload).toHaveBeenCalledWith(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
      Buffer.from("book"),
      { contentType: "application/epub+zip", upsert: false },
    );
    expect(upload.mock.calls[0][0]).not.toContain("地师");
  });
});

function createReadingAssetSupabaseMock(upload: ReturnType<typeof vi.fn>) {
  const row = {
    author: null,
    cover_path: null,
    created_at: "2026-06-28T00:00:00.000Z",
    file_name: "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_.epub",
    format: "epub",
    id: "46420b32-dd19-4801-ad06-44b2c0c3eb0c",
    mime_type: "application/epub+zip",
    node_id: null,
    owner_id: "e42f7dfb-72cc-4042-aa20-731adc4263ba",
    project_id: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
    size_bytes: 4,
    storage_path:
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
    title: "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_",
    updated_at: "2026-06-28T00:00:00.000Z",
  };
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const fromTable = vi.fn().mockReturnValue({ insert });
  const fromBucket = vi.fn().mockReturnValue({ upload });

  return {
    from: fromTable,
    storage: {
      from: fromBucket,
    },
  } as unknown as SupabaseClient;
}
