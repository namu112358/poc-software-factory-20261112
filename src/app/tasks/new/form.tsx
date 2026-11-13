"use client";
// タスク作成のフォーム。誤りがあれば画面の上に理由を並べ、入力した値は残す。
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TASK_CREATE_FAILED_MESSAGE, buildTaskBody, taskDetailHref, taskFormErrorMessages } from "@/lib/task-form";
import { fieldErrorId, fieldErrorProps, fieldErrorText, toFormErrorItems, type FormErrorItem, type TaskFormField } from "@/lib/form-errors";
import { STATUS_LABELS, TASK_STATUSES, isTaskStatus } from "@/lib/task-types";

const ERROR_PREFIX = "new-task";

function FieldError({ items, field }: { items: FormErrorItem[]; field: TaskFormField }) {
  const text = fieldErrorText(items, field);
  return text === "" ? null : (
    <span id={fieldErrorId(ERROR_PREFIX, field)}> {text}</span>
  );
}

type Props = { users: { id: string; name: string; label?: string }[]; defaultAssignee: string };

export function TaskForm({ users, defaultAssignee }: Props) {
  const [errors, setErrors] = useState<FormErrorItem[]>([]);
  const errorListRef = useRef<HTMLUListElement>(null);
  const [pending, setPending] = useState(false);

  // 誤りで断られたら、誤りの一覧にフォーカスを移す（読み上げで気づけるように）。
  useEffect(() => {
    if (errors.length > 0) errorListRef.current?.focus();
  }, [errors]);

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
      setErrors(toFormErrorItems(taskFormErrorMessages(json), { dueDate: body.dueDate }));
    } catch {
      setErrors([{ message: TASK_CREATE_FAILED_MESSAGE }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-label="タスク作成" noValidate>
      {errors.length > 0 && (
        <ul role="alert" data-testid="form-errors" ref={errorListRef} tabIndex={-1}>
          {errors.map((e) => (
            <li key={e.message}>{e.message}</li>
          ))}
        </ul>
      )}
      <p>
        <label>
          タイトル<span aria-hidden="true">（必須）</span>{" "}
          <input name="title" maxLength={200} required aria-required="true" {...fieldErrorProps(errors, ERROR_PREFIX, "title")} />
        </label>
        <FieldError items={errors} field="title" />
      </p>
      <p>
        <label>
          担当者{" "}
          <select name="assignee" defaultValue={defaultAssignee}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label ?? u.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          期限<span aria-hidden="true">（必須）</span>{" "}
          <input name="dueDate" type="date" required aria-required="true" {...fieldErrorProps(errors, ERROR_PREFIX, "dueDate")} />
        </label>
        <FieldError items={errors} field="dueDate" />
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
