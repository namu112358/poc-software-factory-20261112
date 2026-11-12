"use client";
// タスク作成のフォーム。誤りがあれば画面の上に理由を並べ、入力した値は残す。
import { useState } from "react";
import type { FormEvent } from "react";
import { TASK_CREATE_FAILED_MESSAGE, buildTaskBody, taskDetailHref, taskFormErrorMessages } from "@/lib/task-form";
import { STATUS_LABELS, TASK_STATUSES, isTaskStatus } from "@/lib/task-types";

type Props = { users: { id: string; name: string }[]; defaultAssignee: string };

export function TaskForm({ users, defaultAssignee }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = String(data.get("status") ?? "");
    const body = buildTaskBody({
      title: String(data.get("title") ?? ""),
      assignee: String(data.get("assignee") ?? ""),
      dueDate: String(data.get("dueDate") ?? ""),
      status: isTaskStatus(status) ? status : "todo",
    });
    setErrors([]);
    setPending(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json().catch(() => undefined);
      if (res.ok && typeof json?.task?.id === "number") {
        window.location.href = taskDetailHref(json.task.id);
        return;
      }
      setErrors(taskFormErrorMessages(json));
    } catch {
      setErrors([TASK_CREATE_FAILED_MESSAGE]);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="タスク作成" noValidate>
      {errors.length > 0 && (
        <ul role="alert" data-testid="form-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <p>
        <label>
          タイトル <input name="title" maxLength={200} />
        </label>
      </p>
      <p>
        <label>
          担当者{" "}
          <select name="assignee" defaultValue={defaultAssignee}>
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
          期限 <input name="dueDate" type="date" />
        </label>
      </p>
      <p>
        <label>
          ステータス{" "}
          <select name="status" defaultValue="todo">
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </p>
      <button type="submit" disabled={pending}>
        作成
      </button>
    </form>
  );
}
