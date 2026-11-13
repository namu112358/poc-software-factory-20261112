// POST /api/login の本文を読む。JSON とフォームのどちらでもない送り方や、読めないフォームは、
// ログインの判定の前に 4xx の理由を返す（#513。読めない送り方は誤りの回数に数えない）。
export const LOGIN_CONTENT_TYPES = [
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
] as const;

export type LoginRequest =
  | { ok: true; kind: "json" | "form"; userId: unknown; password: unknown; next: unknown }
  | { ok: false; status: 400 | 415; error: string; details: string[] };

/** Content-Type から本文の読み方を決める。JSON でもフォームでもなければ undefined。 */
export function loginBodyKind(contentType: string | null): "json" | "form" | undefined {
  const value = (contentType ?? "").toLowerCase();
  if (value.includes("application/json")) return "json";
  const essence = value.split(";")[0].trim();
  if (essence === "application/x-www-form-urlencoded" || essence === "multipart/form-data") return "form";
  return undefined;
}

export async function readLoginRequest(request: Request): Promise<LoginRequest> {
  const kind = loginBodyKind(request.headers.get("content-type"));
  if (!kind) {
    return {
      ok: false,
      status: 415,
      error: "JSON かフォームで送ってください",
      details: [`Content-Type に ${LOGIN_CONTENT_TYPES.join("・")} のどれかを指定してください`],
    };
  }
  if (kind === "json") {
    // 読めない JSON は今までどおり値なしとして扱う（login() が 401 を返し、回数は増えない）
    const body = (await request.json().catch(() => undefined)) as Record<string, unknown> | null | undefined;
    return { ok: true, kind, userId: body?.userId, password: body?.password, next: undefined };
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {
      ok: false,
      status: 400,
      error: "フォームの本文を読めませんでした",
      details: ["Content-Type と本文の形が合っているか確かめてください"],
    };
  }
  return { ok: true, kind, userId: form.get("userId"), password: form.get("password"), next: form.get("next") };
}
