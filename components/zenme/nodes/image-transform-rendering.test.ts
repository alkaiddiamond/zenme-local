import { describe, expect, it, vi } from "vitest";
import { commitImageEditStroke, composeImageEdit, drawImageEditStroke } from "./image-transform-rendering";

function canvas() {
  const context = {
    save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
    globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1,
    strokeStyle: "", fillStyle: "", lineCap: "", lineJoin: "",
  };
  const element = { width: 400, height: 300, getContext: () => context } as unknown as HTMLCanvasElement;
  return { element, context };
}

describe("flattened image editing", () => {
  it.each([0, 50, 100, -10, 120])("bakes transparency %s into each new stroke", (transparency) => {
    const paint = canvas(), stroke = canvas();
    commitImageEditStroke(paint.element, stroke.element, transparency);
    expect(paint.context.globalAlpha).toBe(1 - Math.max(0, Math.min(100, transparency)) / 100);
    expect(paint.context.globalCompositeOperation).toBe("source-over");
    expect(paint.context.drawImage).toHaveBeenCalledExactlyOnceWith(stroke.element, 0, 0);
    expect(paint.context.save).toHaveBeenCalledOnce();
    expect(paint.context.restore).toHaveBeenCalledOnce();
  });

  it("erases only the painting layer", () => {
    const paint = canvas();
    commitImageEditStroke(paint.element, canvas().element, 0, true);
    expect(paint.context.globalCompositeOperation).toBe("destination-out");
  });

  it("renders a click with the captured brush size and color", () => {
    const stroke = canvas();
    drawImageEditStroke(stroke.element, { x: 40, y: 50 }, { x: 40, y: 50 }, 80, "#ffffff");
    expect(stroke.context.lineWidth).toBe(80);
    expect(stroke.context.strokeStyle).toBe("#ffffff");
    expect(stroke.context.arc).toHaveBeenCalledWith(40, 50, 40, 0, Math.PI * 2);
  });

  it("crops original and baked painting together without exporting guides", () => {
    const output = canvas(), source = canvas(), paint = canvas();
    composeImageEdit(output.element, source.element, paint.element, { x: 40, y: 30, width: 100, height: 80 });
    expect([output.element.width, output.element.height]).toEqual([100, 80]);
    expect(output.context.drawImage.mock.calls).toEqual([
      [source.element, 40, 30, 100, 80, 0, 0, 100, 80],
      [paint.element, 40, 30, 100, 80, 0, 0, 100, 80],
    ]);
    expect(source.context.drawImage).not.toHaveBeenCalled();
    expect(paint.context.drawImage).not.toHaveBeenCalled();
  });
});
