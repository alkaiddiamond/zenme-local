export function shouldPreventNativeCanvasAuxClick(
  event: Pick<MouseEvent, "button">,
) {
  return event.button === 1;
}
