import { formatPageTitle } from "@/lib/page-title";
import { requireUser } from "@/lib/session";
import { latestPendingReissue, mustChangePassword } from "@/lib/users";
import { passwordOwnerMessage } from "@/lib/password-owner";
import { passwordRuleMessage } from "@/lib/password-rule";
import { PasswordForm } from "./form";
import { TEMPORARY_PASSWORD_NOTICE } from "@/lib/member-create";
import { reissueNoticeFor } from "@/lib/member-temporary-password";

export const metadata = { title: formatPageTitle("パスワード変更") };

export default async function PasswordPage() {
  // 仮のパスワードの間（#523）も、この画面だけは開ける。
  const user = await requireUser({ allowPasswordChangePending: true });
  const pending = mustChangePassword(user.id);
  // 取りまとめる人が出し直した仮のパスワードなら、だれが・いつ出し直したかを知らせる（#566）。
  const reissue = latestPendingReissue(user.id);
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>パスワード変更</h1>
      {pending && (
        <p role="status" data-testid="password-change-required">
          {TEMPORARY_PASSWORD_NOTICE}
        </p>
      )}
      {reissue && (
        <p data-testid="password-reissued-by">{reissueNoticeFor(reissue.issuedBy.name, reissue.issuedAt)}</p>
      )}
      <p data-testid="password-owner">{passwordOwnerMessage(user.name)}</p>
      <p data-testid="password-rule">{passwordRuleMessage()}</p>
      <PasswordForm afterChangeHref={pending ? "/tasks" : undefined} />
    </main>
  );
}
