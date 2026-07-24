type DesktopClipboardApi = {
  writeClipboardText?: (text: string) => Promise<boolean>;
};

export async function writeTextToClipboard(text: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const desktopApi = (
    window as Window & { zenmeDesktop?: DesktopClipboardApi }
  ).zenmeDesktop;
  if (desktopApi?.writeClipboardText) {
    await desktopApi.writeClipboardText(text);
    return true;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyTextWithSelectionFallback(text);
  }
}

function copyTextWithSelectionFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}
