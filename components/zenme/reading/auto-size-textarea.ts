export function resizeTextareaToContent(
  textarea: HTMLTextAreaElement,
  minHeight: number,
  maxHeight: number,
) {
  const previousHeight = textarea.getBoundingClientRect().height;
  const borderHeight = textarea.offsetHeight - textarea.clientHeight;
  textarea.style.height = "auto";
  const contentHeight = textarea.scrollHeight + borderHeight;
  const nextHeight = Math.min(
    Math.max(minHeight, contentHeight),
    Math.max(minHeight, maxHeight),
  );
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = contentHeight > nextHeight ? "auto" : "hidden";
  return nextHeight - previousHeight;
}

export function getReadingNoteEditorMaxHeight(viewportHeight: number) {
  return Math.max(160, Math.floor(viewportHeight * 0.55));
}
