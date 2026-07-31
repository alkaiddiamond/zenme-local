export function isEventInsideTarget(
  event: Pick<Event, "composedPath">,
  target: EventTarget | null,
) {
  return target !== null && event.composedPath().includes(target);
}

export function createOutsidePointerHandler(
  getTarget: () => EventTarget | null,
  onOutside: () => void,
) {
  return (event: PointerEvent) => {
    if (!isEventInsideTarget(event, getTarget())) onOutside();
  };
}
