import { formatPageTitle } from "@/lib/page-title";
import { requireUser } from "@/lib/session";
import { listAssigneeOptions } from "@/lib/members";
import { TaskForm } from "./form";

export const metadata = { title: formatPageTitle("新しいタスク") };

export default async function NewTaskPage() {
  const user = await requireUser();
  const users = listAssigneeOptions();
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>新しいタスク</h1>
      <TaskForm users={users} defaultAssignee={user.id} />
    </main>
  );
}
