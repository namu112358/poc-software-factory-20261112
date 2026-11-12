import { formatExtensionRequestedAt, listPendingExtensions } from "@/lib/extensions";
import { requireUser } from "@/lib/session";
import { PendingExtensionsTable } from "./extension-actions";

export default async function ExtensionsPage() {
  const user = await requireUser();
  const rows = listPendingExtensions().map((r) => ({
    id: r.id,
    taskId: r.taskId,
    taskTitle: r.taskTitle,
    requester: r.requester,
    requesterName: r.requesterName,
    currentDueDate: r.currentDueDate,
    newDueDate: r.newDueDate,
    reason: r.reason,
    requestedAt: formatExtensionRequestedAt(r.createdAt),
  }));

  return (
    <main>
      <h1>承認待ちの期限延長</h1>
      <PendingExtensionsTable rows={rows} userId={user.id} />
    </main>
  );
}
