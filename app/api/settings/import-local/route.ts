import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { getZenmeDataDir } from "@/lib/local/data-dir";
import { importZenmeExport } from "@/scripts/import-local-data.mjs";

export async function POST(request: Request) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-import-upload-"));

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (
      !file ||
      typeof file !== "object" ||
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function"
    ) {
      return NextResponse.json({ error: "缺少导入文件" }, { status: 400 });
    }

    const uploadedFile = file as File;
    if (!uploadedFile.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "仅支持 zenme-export.zip" }, { status: 400 });
    }

    const zipPath = path.join(tmpDir, "zenme-export.zip");
    await fs.writeFile(zipPath, Buffer.from(await uploadedFile.arrayBuffer()));
    const summary = await importZenmeExport({
      dataDir: getZenmeDataDir(),
      source: zipPath,
    });

    return NextResponse.json({ ok: true, summary });
  } catch {
    return NextResponse.json(
      {
        error: "数据导入失败",
      },
      { status: 500 },
    );
  } finally {
    await fs.rm(tmpDir, { force: true, recursive: true }).catch(() => undefined);
  }
}
