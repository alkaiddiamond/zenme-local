import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { saveReadingProgress } from "./progress";

describe("reading progress repository", () => {
  it("normalizes progress values before upserting them", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        asset_id: "asset-1",
        content_scale: 1.8,
        owner_id: "user-1",
        project_id: "project-1",
        scroll_ratio: 1,
        section_index: 0,
        updated_at: "2026-06-28T02:00:00.000Z",
      },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const supabase = {
      from: vi.fn().mockReturnValue({ upsert }),
    } as unknown as SupabaseClient;

    await expect(
      saveReadingProgress(supabase, {
        assetId: "asset-1",
        contentScale: 8,
        ownerId: "user-1",
        projectId: "project-1",
        scrollRatio: 1.5,
        sectionIndex: -3,
      }),
    ).resolves.toMatchObject({
      contentScale: 1.8,
      scrollRatio: 1,
      sectionIndex: 0,
    });

    expect(upsert).toHaveBeenCalledWith(
      {
        asset_id: "asset-1",
        content_scale: 1.8,
        owner_id: "user-1",
        project_id: "project-1",
        scroll_ratio: 1,
        section_index: 0,
      },
      { onConflict: "asset_id" },
    );
  });
});
