const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);

export function decodeCommandOutput(
  chunks: readonly Buffer[],
  options: { final?: boolean; platform?: NodeJS.Platform } = {},
) {
  const { final = true, platform = process.platform } = options;
  const bytes = Buffer.concat(chunks);
  if (bytes.length === 0) return "";

  if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    return decode(bytes.subarray(UTF8_BOM.length), "utf-8", final);
  }
  if (bytes.subarray(0, UTF16_LE_BOM.length).equals(UTF16_LE_BOM)) {
    return decode(bytes.subarray(UTF16_LE_BOM.length), "utf-16le", final);
  }
  if (bytes.subarray(0, UTF16_BE_BOM.length).equals(UTF16_BE_BOM)) {
    return decode(bytes.subarray(UTF16_BE_BOM.length), "utf-16be", final);
  }
  if (looksLikeUtf16Le(bytes)) {
    return decode(bytes, "utf-16le", final);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (!final) {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
      } catch {
        // The byte stream is not UTF-8; continue with the Windows code page.
      }
    }
    // Windows console programs commonly inherit the active ANSI code page and
    // emit GBK/GB18030 instead of UTF-8. GB18030 is a superset of GBK.
    if (platform === "win32") return decode(bytes, "gb18030", final);
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function decode(bytes: Buffer, encoding: string, final: boolean) {
  return new TextDecoder(encoding).decode(bytes, { stream: !final });
}

function looksLikeUtf16Le(bytes: Buffer) {
  if (bytes.length < 4) return false;
  let oddNulls = 0;
  let oddBytes = 0;
  for (let index = 1; index < bytes.length; index += 2) {
    oddBytes += 1;
    if (bytes[index] === 0) oddNulls += 1;
  }
  return oddBytes > 0 && oddNulls / oddBytes >= 0.6;
}
