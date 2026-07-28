export const TEXT_EDITOR_TAB_SPACES = "    ";

export function insertTabSpaces(
  value: string,
  selectionStart: number,
  selectionEnd: number,
) {
  return {
    cursor: selectionStart + TEXT_EDITOR_TAB_SPACES.length,
    value:
      value.slice(0, selectionStart) +
      TEXT_EDITOR_TAB_SPACES +
      value.slice(selectionEnd),
  };
}
