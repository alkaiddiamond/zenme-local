export function getUpwardExpansionScrollDelta(input: {
  afterBottom: number;
  beforeBottom: number;
  beforeTop: number;
  containerTop: number;
}) {
  const addedHeight = Math.max(0, input.afterBottom - input.beforeBottom);
  const availableSpaceAbove = Math.max(0, input.beforeTop - input.containerTop);
  return Math.min(addedHeight, availableSpaceAbove);
}
