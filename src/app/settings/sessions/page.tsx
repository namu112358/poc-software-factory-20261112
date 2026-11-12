import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth";
import { formatLastUsedAt, formatLoggedInAt, listDeviceSessions } from "@/lib/device-sessions";
import { requireUser } from "@/lib/session";
import { RevokeDeviceButton } from "./revoke";

export default async function SessionsPage() {
  await requireUser();
  const store = await cookies();
  const sessions = listDeviceSessions(store.get(SESSION_COOKIE)?.value);
  if (!sessions) redirect("/login");
  return (
    <main>
      <h1>ログイン中の端末</h1>
      <p>身に覚えのない端末があれば、その端末だけを切れます。切った端末では、もう一度ログインが必要になります。</p>
      <table data-testid="device-sessions">
        <thead>
          <tr>
            <th>ログインした日時（日本時間）</th>
            <th>最後に使った日時（日本時間）</th>
            <th>端末の種類</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} data-testid="device-session">
              <td>{formatLoggedInAt(s.loggedInAt)}</td>
              <td>{formatLastUsedAt(s.lastUsedAt)}</td>
              <td>{s.device}</td>
              <td>{s.current ? <strong>この端末</strong> : <RevokeDeviceButton deviceId={s.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
