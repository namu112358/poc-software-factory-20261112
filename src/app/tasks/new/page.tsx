import { requireUser } from "@/lib/session";
import { listAssigneeOptions } from "@/lib/members";
import { TaskForm } from "./form";

export default async function NewTaskPage() {
  const user = await requireUser();
  const users = listAssigneeOptions();
  return (
    <main>
      <h1>新しいタスク</h1>
      <TaskForm users={users} defaultAssignee={user.id} />
    </main>
  );
}
