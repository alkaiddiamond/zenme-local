import type { Connection } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { isCanvasConnectionValid } from "@/components/zenme/canvas/connections";
import {
  NODE_ACTION_HANDLE_ID,
  NODE_CONTEXT_HANDLE_ID,
  NODE_CONTEXT_TARGET_HANDLE_ID,
  NODE_LEFT_HANDLE_ID,
} from "@/components/zenme/node-types";

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    source: "source",
    sourceHandle: NODE_ACTION_HANDLE_ID,
    target: "target",
    targetHandle: NODE_LEFT_HANDLE_ID,
    ...overrides,
  };
}

describe("canvas connection validation", () => {
  it("allows normal node handles to connect freely", () => {
    expect(isCanvasConnectionValid(connection())).toBe(true);
    expect(
      isCanvasConnectionValid(
        connection({ sourceHandle: null, targetHandle: null }),
      ),
    ).toBe(true);
  });

  it("only allows context source handles to pair with context targets", () => {
    expect(
      isCanvasConnectionValid(
        connection({
          sourceHandle: NODE_CONTEXT_HANDLE_ID,
          targetHandle: NODE_CONTEXT_TARGET_HANDLE_ID,
        }),
      ),
    ).toBe(true);
    expect(
      isCanvasConnectionValid(
        connection({ sourceHandle: NODE_CONTEXT_HANDLE_ID }),
      ),
    ).toBe(false);
    expect(
      isCanvasConnectionValid(
        connection({ targetHandle: NODE_CONTEXT_TARGET_HANDLE_ID }),
      ),
    ).toBe(false);
  });
});
