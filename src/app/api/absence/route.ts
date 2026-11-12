// /api/absence — ログイン中の本人の休みの期間（1 つだけ）。
// GET: 登録を返す（無ければ absence: null）。PUT: { startDate, endDate } で登録する（前の登録は置き換える）。DELETE: 取り消す。
// 対象はいつも本人。本文やクエリの userId でほかのメンバーを指定すると 403 を返し、何も変えない。
import { NextResponse } from "next/server";
import { jsonError, readJson, requireApiUser } from "@/lib/api";
import { clearAbsence, getAbsence, isOwnAbsenceTarget, setAbsence, validateAbsenceInput } from "@/lib/absence";

const FORBIDDEN_MESSAGE = "ほかのメンバーの休みは変えられません";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ absence: getAbsence(user.id) });
}

export async function PUT(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const body = await readJson(request);
  const requested = typeof body === "object" && body !== null ? (body as Record<string, unknown>).userId : undefined;
  if (!isOwnAbsenceTarget(user.id, requested)) return jsonError(403, FORBIDDEN_MESSAGE);

  const input = validateAbsenceInput(body);
  if (!input.ok) return jsonError(400, "入力内容に誤りがあります", input.errors);
  setAbsence(user.id, input.value);
  return NextResponse.json({ absence: getAbsence(user.id) });
}

export async function DELETE(request: Request) {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  const requested = new URL(request.url).searchParams.get("userId") ?? undefined;
  if (!isOwnAbsenceTarget(user.id, requested)) return jsonError(403, FORBIDDEN_MESSAGE);
  clearAbsence(user.id);
  return NextResponse.json({ absence: null });
}
