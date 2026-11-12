import { requireUser } from "@/lib/session";
import { PasswordForm } from "./form";

export default async function PasswordPage() {
  await requireUser();
  return (
    <main>
      <h1>パスワード変更</h1>
      <PasswordForm />
    </main>
  );
}
