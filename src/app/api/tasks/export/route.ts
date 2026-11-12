// GET /api/tasks/export — タスクの一覧を CSV（UTF-8・BOM 付き）でダウンロードする。ログインが必要。
// 一覧画面と同じ ?status=&assignee=&tag=&sort= で絞り込める（不正な値は指定なし）。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import { exportFilename, exportTasksCsv, parseTaskFilter } from "@/lib/export";

export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const csv = exportTasksCsv(parseTaskFilter(new URL(request.url).searchParams));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename()}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
