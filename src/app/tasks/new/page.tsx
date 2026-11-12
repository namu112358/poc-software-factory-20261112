import { requireUser } from "@/lib/session";
import { listUserOptions } from "@/lib/users";
import { TaskForm } from "./form";

export default async function NewTaskPage() {
  const user = await requireUser();
  const users = listUserOptions();
  return (
    <main>
      <h1>新しいタスク</h1>
      <TaskForm users={users} defaultAssignee={user.id} />
    </main>
  );
}
