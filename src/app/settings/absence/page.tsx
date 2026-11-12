import { getAbsence, isOnLeave } from "@/lib/absence";
import { requireUser } from "@/lib/session";
import { AbsenceForm } from "./form";

export default async function AbsencePage() {
  const user = await requireUser();
  const absence = getAbsence(user.id);
  return (
    <main>
      <h1>休みの登録</h1>
      <p>休みの期間を登録すると、担当者を選ぶ画面とメンバーの一覧に、休み中であることが出ます。登録できる期間は 1 つだけで、登録し直すと前の期間を置き換えます。</p>
      <AbsenceForm absence={absence} onLeave={isOnLeave(absence)} />
    </main>
  );
}
