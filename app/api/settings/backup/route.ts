import { NextResponse } from "next/server";

import {
  createLocalDataBackup,
  MAX_BACKUP_ARCHIVE_BYTES,
  restoreLocalDataBackup,
} from "@/lib/local/backup";

export async function GET() {
  try {
    const backup = await createLocalDataBackup();
    return new Response(backup, {
      headers: {
        "content-disposition": `attachment; filename="zenme-backup-${new Date()
          .toISOString()
          .slice(0, 10)}.zip"`,
        "content-type": "application/zip",
      },
    });
  } catch {
    return NextResponse.json({ error: "备份创建失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (
      !file ||
      typeof file !== "object" ||
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function"
    ) {
      return NextResponse.json({ error: "缺少备份文件" }, { status: 400 });
    }
    if ((file as File).size > MAX_BACKUP_ARCHIVE_BYTES) {
      return NextResponse.json({ error: "备份包超过 200 MB 限制" }, { status: 413 });
    }

    const result = await restoreLocalDataBackup({
      backup: Buffer.from(await (file as File).arrayBuffer()),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { error: "备份恢复失败" },
      { status: 500 },
    );
  }
}
