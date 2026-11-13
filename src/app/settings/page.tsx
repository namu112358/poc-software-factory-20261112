import { formatPageTitle } from "@/lib/page-title";
import { SETTINGS_NAV_LINKS } from "@/lib/nav";
import { requireUser } from "@/lib/session";

export const metadata = { title: formatPageTitle("設定") };

export default async function SettingsPage() {
  await requireUser();
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>設定</h1>
      <ul>
        {SETTINGS_NAV_LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}
