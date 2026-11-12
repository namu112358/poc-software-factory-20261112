// GET /api/version — 動いているアプリの版（package.json の version）を返す。未ログインなら 401。
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api";
import pkg from "../../../../package.json";

export async function GET() {
  const user = await requireApiUser();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ version: pkg.version });
}
