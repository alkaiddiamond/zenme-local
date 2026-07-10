import { describe, expect, it } from "vitest";

import {
  createProjectOriginalStoragePath,
  createProjectPreviewStoragePath,
  createProjectThumbnailStoragePath,
} from "@/lib/project-storage-paths";

const ids = {
  fileId: "46420b32-dd19-4801-ad06-44b2c0c3eb0c",
  ownerId: "e42f7dfb-72cc-4042-aa20-731adc4263ba",
  projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
};

describe("project storage paths", () => {
  it("keeps original file names out of storage object keys", () => {
    const storagePath = createProjectOriginalStoragePath({
      ...ids,
      fileName: "地师_徐公子胜治_z-library.sk_1lib.sk_z-lib.sk_.epub",
    });

    expect(storagePath).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
    );
    expect(storagePath).not.toContain("地师");
  });

  it("drops unsafe or missing extensions instead of appending file names", () => {
    expect(
      createProjectOriginalStoragePath({
        ...ids,
        fileName: "untitled.",
      }),
    ).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c",
    );
  });

  it("creates deterministic preview and thumbnail paths", () => {
    expect(createProjectPreviewStoragePath(ids)).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/preview/46420b32-dd19-4801-ad06-44b2c0c3eb0c.webp",
    );
    expect(createProjectThumbnailStoragePath(ids)).toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/thumbnail/latest.webp",
    );
  });
});
