import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import {
  deleteLocalProjectFile,
  getLocalProjectFileSource,
} from "@/lib/local/project-files-repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string; projectId: string }> },
) {
  try {
    const { fileId, projectId } = await params;
    const file = await getLocalProjectFileSource({
      fileId,
      projectId,
      variant: "original",
    });
    if (!file) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const fileSize = file.record.sizeBytes;
    const range = parseByteRange(request.headers.get("range"), fileSize);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          "accept-ranges": "bytes",
          "content-range": `bytes */${fileSize}`,
        },
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, fileSize - 1);
    const contentLength = fileSize === 0 ? 0 : end - start + 1;
    const stream = fs.createReadStream(file.absolutePath, { start, end });
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "cache-control": "no-store",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(
        file.fileName,
      )}`,
      "content-length": String(contentLength),
      "content-type": file.mimeType,
    };

    if (range) {
      headers["content-range"] = `bytes ${start}-${end}/${fileSize}`;
    }

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch {
    return NextResponse.json({ error: "文件读取失败" }, { status: 500 });
  }
}

type ByteRange = { end: number; start: number };

function parseByteRange(value: string | null, fileSize: number): ByteRange | "invalid" | null {
  if (!value) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || fileSize <= 0) {
    return "invalid";
  }

  const [, startText, endText] = match;
  if (!startText && !endText) {
    return "invalid";
  }

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : fileSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= fileSize ||
    requestedEnd < start
  ) {
    return "invalid";
  }

  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ fileId: string; projectId: string }> },
) {
  try {
    const { fileId, projectId } = await params;
    await deleteLocalProjectFile({ fileId, projectId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "文件删除失败" }, { status: 500 });
  }
}
