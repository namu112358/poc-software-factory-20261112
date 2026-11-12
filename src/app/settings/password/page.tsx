import { requireUser } from "@/lib/session";
import { passwordOwnerMessage } from "@/lib/password-owner";
import { passwordRuleMessage } from "@/lib/password-rule";
import { PasswordForm } from "./form";

export default async function PasswordPage() {
  const user = await requireUser();
  return (
    <main>
      <h1>パスワード変更</h1>
      <p data-testid="password-owner">{passwordOwnerMessage(user.name)}</p>
      <p data-testid="password-rule">{passwordRuleMessage()}</p>
      <PasswordForm />
    </main>
  );
}
