"use client";
// タスクの「編集」ボタンとフォーム。保存はフォームを開いたときの更新日時を付けて送り、
// ほかの人が先に更新していたら（409）上書きせずに知らせ、最新の内容でフォームを入れ直す。
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { newerTask, saveTaskEdit, taskToEditValues, type TaskEditValues } from "@/lib/task-edit";
import { MEMO_MAX_LENGTH, PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, isTaskPriority, isTaskStatus, type Task } from "@/lib/task-types";

type Props = { task: Task; users: { id: string; name: string }[] };

export function EditTaskForm({ task, users }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<TaskEditValues>(() => taskToEditValues(task));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(task.updatedAt);
  const [received, setReceived] = useState<Task>();
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState(false);

  function startEditing() {
    const base = newerTask(task, received);
    setValues(taskToEditValues(base));
    setExpectedUpdatedAt(base.updatedAt);
    setErrors([]);
    setNotice(undefined);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setErrors([]);
    setNotice(undefined);
  }

  function set<K extends keyof TaskEditValues>(key: K, value: TaskEditValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setErrors([]);
    setNotice(undefined);
    const result = await saveTaskEdit(task.id, values, expectedUpdatedAt, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    switch (result.status) {
      case "saved":
        setReceived(result.task);
        setOpen(false);
        router.refresh();
        return;
      case "conflict":
        setReceived(result.task);
        setValues(taskToEditValues(result.task));
        setExpectedUpdatedAt(result.task.updatedAt);
        setNotice(result.message);
        router.refresh();
        return;
      case "invalid":
        setErrors(result.messages);
        return;
      case "unauthorized":
        window.location.href = "/login";
        return;
      case "error":
        setErrors([result.message]);
        return;
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={startEditing}>
        編集
      </button>
    );
  }

  return (
    <form aria-label="タスクの編集" onSubmit={onSubmit} noValidate>
      {notice && (
        <p role="alert" data-testid="edit-conflict">
          {notice}
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" data-testid="edit-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <p>
        <label>
          タイトル <input name="title" maxLength={200} value={values.title} onChange={(e) => set("title", e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          ステータス{" "}
          <select
            name="status"
            value={values.status}
            onChange={(e) => isTaskStatus(e.target.value) && set("status", e.target.value)}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          担当者{" "}
          <select name="assignee" value={values.assignee} onChange={(e) => set("assignee", e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          期限 <input name="dueDate" type="date" value={values.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          優先度{" "}
          <select
            name="priority"
            value={values.priority}
            onChange={(e) => isTaskPriority(e.target.value) && set("priority", e.target.value)}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          メモ{" "}
          <textarea
            name="memo"
            rows={4}
            cols={50}
            maxLength={MEMO_MAX_LENGTH}
            value={values.memo}
            onChange={(e) => set("memo", e.target.value)}
          />
        </label>
      </p>
      <button type="submit" disabled={pending}>
        保存
      </button>{" "}
      <button type="button" onClick={close} disabled={pending}>
        やめる
      </button>
    </form>
  );
}
