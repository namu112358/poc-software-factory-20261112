// ログインの接続元の見分け方（#526）。ログインの失敗を「ID と接続元の組」で数えるのに使う。
// 接続元は X-Forwarded-For のいちばん右の値（手前のサーバーが付けた値）の IP アドレスにする。
// Next.js は、この見出しが無いときだけ、接続元のソケットのアドレスを入れる。プロキシの後ろでは、プロキシが足した値（いちばん右）を使う。
// 見分けられない（無い・空・IP アドレスでない）ときは null を返し、今までどおり ID ごとに数える。
import { isIP } from "node:net";

/** 接続元として受け付ける長さの上限（文字数）。IPv6 の最長の表記（45 文字）に余裕を持たせる。 */
const MAX_SOURCE_LENGTH = 64;

/** X-Forwarded-For の値から接続元の IP アドレスを取り出す。見分けられなければ null。 */
export function loginSourceFromForwardedFor(value: string | null | undefined): string | null {
  if (!value) return null;
  const last = value.split(",").at(-1)?.trim() ?? "";
  if (last === "" || last.length > MAX_SOURCE_LENGTH) return null;
  // IPv4 を IPv6 の形で表した値（::ffff:192.0.2.1）は IPv4 にそろえる（同じ接続元を 2 つに数えないため）
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(last);
  const address = mapped ? mapped[1] : last;
  const version = isIP(address);
  if (version === 0) return null;
  return version === 6 ? address.toLowerCase() : address;
}

/** リクエストの見出しから接続元を取り出す。 */
export function loginSourceFromHeaders(headers: Headers): string | null {
  return loginSourceFromForwardedFor(headers.get("x-forwarded-for"));
}
