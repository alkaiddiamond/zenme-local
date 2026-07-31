import { describe, expect, it } from "vitest";

import {
  mergeReferenceNodeIds,
} from "./image-prompt-mentions";

describe("image prompt mentions", () => {
  it("combines explicitly selected references with prompt mentions", () => {
    expect(mergeReferenceNodeIds(
      ["image-1"],
      [
        { nodeId: "text-1", offset: 0 },
        { nodeId: "unrelated", offset: 0 },
      ],
      [{ nodeId: "text-1" }],
    )).toEqual(["image-1", "text-1"]);
  });

  it("shows every connected candidate by default until selection is customized", () => {
    expect(mergeReferenceNodeIds(
      undefined,
      [],
      [{ nodeId: "image-1" }, { nodeId: "image-2" }],
    )).toEqual(["image-1", "image-2"]);
  });
});
