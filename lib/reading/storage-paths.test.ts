import { describe, expect, it } from "vitest";

import {
  createReadingCoverStoragePath,
  createReadingOriginalStoragePath,
} from "@/lib/reading/storage-paths";

const ids = {
  assetId: "46420b32-dd19-4801-ad06-44b2c0c3eb0c",
  ownerId: "e42f7dfb-72cc-4042-aa20-731adc4263ba",
  projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
};

describe("reading storage paths", () => {
  it("keeps non-ascii original file names out of storage object keys", () => {
    const storagePath = createReadingOriginalStoragePath({
      ...ids,
      fileName: "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_.epub",
      format: "epub",
    });

    expect(storagePath).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
    );
    expect(storagePath).not.toContain("地师");
  });

  it("ignores unsafe path fragments from file names", () => {
    const storagePath = createReadingOriginalStoragePath({
      ...ids,
      fileName: "../nested/book name.final.PDF",
      format: "pdf",
    });

    expect(storagePath).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.pdf",
    );
  });

  it("falls back to the detected reading format when extension is not storage-safe", () => {
    const storagePath = createReadingOriginalStoragePath({
      ...ids,
      fileName: "untitled.",
      format: "txt",
    });

    expect(storagePath).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.txt",
    );
  });

  it("creates cover paths without user-controlled file name segments", () => {
    expect(
      createReadingCoverStoragePath({
        assetId: ids.assetId,
        extension: ".webp",
        ownerId: ids.ownerId,
        projectId: ids.projectId,
      }),
    ).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/covers/46420b32-dd19-4801-ad06-44b2c0c3eb0c.webp",
    );
  });
});
