"use client";
// タスク作成のフォーム。誤りがあれば画面の上に理由を並べ、入力した値は残す。
// ログインが切れていたら（401）、ログイン画面へは移らず、入力を残したまま、誤りの一覧にログインし直す案内を出す（#491）。
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TASK_CREATE_FAILED_MESSAGE, buildTaskBody, taskDetailHref, taskFormErrorMessages } from "@/lib/task-form";
import { fieldErrorId, fieldErrorProps, fieldErrorText, toFormErrorItems, type FormErrorItem, type TaskFormField } from "@/lib/form-errors";
import { isSessionExpired } from "@/lib/session-expired";
import { SessionExpiredNotice } from "../../session-expired";
import { MEMO_MAX_LENGTH, PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, isTaskPriority, isTaskStatus } from "@/lib/task-types";

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
  const [expired, setExpired] = useState(false);
  const errorListRef = useRef<HTMLUListElement>(null);
  const [pending, setPending] = useState(false);

  // 誤りやログイン切れで断られたら、誤りの一覧にフォーカスを移す（読み上げで気づけるように）。
  useEffect(() => {
    if (errors.length > 0 || expired) errorListRef.current?.focus();
  }, [errors, expired]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = String(data.get("status") ?? "");
    const priority = String(data.get("priority") ?? "");
    const body = buildTaskBody({
      title: String(data.get("title") ?? ""),
      assignee: String(data.get("assignee") ?? ""),
      dueDate: String(data.get("dueDate") ?? ""),
      status: isTaskStatus(status) ? status : "todo",
      priority: isTaskPriority(priority) ? priority : "medium",
      memo: String(data.get("memo") ?? ""),
    });
    setErrors([]);
    setExpired(false);
    setPending(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (isSessionExpired(res.status)) {
        setExpired(true);
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
      {(errors.length > 0 || expired) && (
        <ul role="alert" data-testid="form-errors" ref={errorListRef} tabIndex={-1}>
          {expired && (
            <li data-testid="new-task-session-expired">
              <SessionExpiredNotice />
            </li>
          )}
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
      <p>
        <label>
          優先度{" "}
          <select name="priority" defaultValue="medium" {...fieldErrorProps(errors, ERROR_PREFIX, "priority")}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <FieldError items={errors} field="priority" />
      </p>
      <p>
        <label>
          メモ{" "}
          <textarea name="memo" rows={4} cols={50} maxLength={MEMO_MAX_LENGTH} {...fieldErrorProps(errors, ERROR_PREFIX, "memo")} />
        </label>
        <FieldError items={errors} field="memo" />
      </p>
      <button type="submit" disabled={pending}>
        作成
      </button>
    </form>
  );
}
