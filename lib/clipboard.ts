type DesktopClipboardApi = {
  writeClipboardImage?: (input: {
    bytes: ArrayBuffer;
    fallbackText: string;
  }) => Promise<boolean>;
  writeClipboardText?: (text: string) => Promise<boolean>;
};

export async function writeImageToClipboard(
  image: Blob,
  fallbackText: string,
) {
  if (typeof window === "undefined") return false;
  const clipboardImage = await normalizeClipboardImage(image);

  const desktopApi = (
    window as Window & { zenmeDesktop?: DesktopClipboardApi }
  ).zenmeDesktop;
  if (desktopApi?.writeClipboardImage) {
    try {
      if (await desktopApi.writeClipboardImage({
        bytes: await clipboardImage.arrayBuffer(),
        fallbackText,
      })) return true;
    } catch {
      // Fall through to the browser clipboard during development reloads.
    }
  }

  try {
    if (typeof ClipboardItem === "undefined") return false;
    await navigator.clipboard.write([
      new ClipboardItem({
        [clipboardImage.type || "image/png"]: clipboardImage,
        "text/plain": new Blob([fallbackText], { type: "text/plain" }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function normalizeClipboardImage(image: Blob) {
  if (
    image.type === "image/png" ||
    typeof createImageBitmap === "undefined" ||
    typeof document === "undefined"
  ) {
    return image;
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(image);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return image;
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob ?? image), "image/png"),
    );
  } catch {
    return image;
  } finally {
    bitmap?.close();
  }
}

export async function writeTextToClipboard(text: string) {
  if (typeof window === "undefined") {
    return false;
  }

  const desktopApi = (
    window as Window & { zenmeDesktop?: DesktopClipboardApi }
  ).zenmeDesktop;
  if (desktopApi?.writeClipboardText) {
    try {
      if (await desktopApi.writeClipboardText(text)) return true;
    } catch {
      // Fall through to the browser clipboard when the desktop bridge is stale
      // or temporarily unavailable during development reloads.
    }
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
