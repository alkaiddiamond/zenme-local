import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isEditableClipboardEvent,
  isEditableTarget,
} from "./geometry";

class FakeNode {
  parentElement: FakeElement | null = null;
}

class FakeElement extends FakeNode {
  closestResult: FakeElement | null = null;
  isContentEditable = false;

  closest() {
    return this.closestResult;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function installDomStubs() {
  vi.stubGlobal("Node", FakeNode);
  vi.stubGlobal("Element", FakeElement);
}

describe("editable clipboard targets", () => {
  it("recognizes editable ancestors when the event target is nested content", () => {
    installDomStubs();
    const editor = new FakeElement();
    editor.closestResult = editor;
    const nestedText = new FakeNode();
    nestedText.parentElement = editor;

    expect(isEditableTarget(nestedText as unknown as EventTarget)).toBe(true);
  });

  it("uses focus and the composed path when the paste target is unreliable", () => {
    installDomStubs();
    const plainTarget = new FakeElement();
    const editor = new FakeElement();
    editor.isContentEditable = true;
    const event = {
      composedPath: () => [plainTarget],
      target: plainTarget,
    } as unknown as Pick<Event, "composedPath" | "target">;

    expect(isEditableClipboardEvent(event, editor as unknown as EventTarget)).toBe(true);
    expect(isEditableClipboardEvent(event, null)).toBe(false);

    const pathEvent = {
      composedPath: () => [editor],
      target: plainTarget,
    } as unknown as Pick<Event, "composedPath" | "target">;
    expect(isEditableClipboardEvent(pathEvent, null)).toBe(true);
  });
});
