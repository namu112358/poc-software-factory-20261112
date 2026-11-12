// GET /api/app-name — 動いているアプリの名前（package.json の name）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import pkg from "../../../../package.json";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ name: pkg.name });
}
