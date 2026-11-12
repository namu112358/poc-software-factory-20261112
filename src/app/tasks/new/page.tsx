import { requireUser } from "@/lib/session";
import { listAssignees } from "@/lib/tasks";
import { TaskForm } from "./form";

export default async function NewTaskPage() {
  const user = await requireUser();
  const users = listAssignees();
  return (
    <main>
      <h1>新しいタスク</h1>
      <TaskForm users={users.map((u) => ({ id: u.id, name: u.name }))} defaultAssignee={user.id} />
    </main>
  );
}
