"use client";
// タスクの「編集」ボタンとフォーム。保存はフォームを開いたときの更新日時を付けて送り、
// ほかの人が先に更新していたら（409）上書きせずに知らせ、入力は残したまま、相手が変えた項目を並べる。
// 「今の値で編集し直す」を押すまでは保存できない（自分の入力のまま、確かめずに上書きしないため）。
// 編集し直すと、相手が変えた項目だけが今の値になり、ほかの項目は自分の入力が残る。
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  TASK_EDIT_CONFLICT_MESSAGE,
  TASK_EDIT_NO_CHANGED_FIELDS_MESSAGE,
  canSaveTaskEdit,
  conflictRows,
  newerTask,
  rebaseOnCurrent,
  recordConflict,
  saveTaskEdit,
  startTaskEdit,
  taskToEditValues,
  type TaskEditState,
  type TaskEditValues,
} from "@/lib/task-edit";
import { fieldErrorId, fieldErrorProps, fieldErrorText, toFormErrorItems, type FormErrorItem, type TaskFormField } from "@/lib/form-errors";
import { MEMO_MAX_LENGTH, PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES, isTaskPriority, isTaskStatus, type Task } from "@/lib/task-types";

const ERROR_PREFIX = "edit-task";

function FieldError({ items, field }: { items: FormErrorItem[]; field: TaskFormField }) {
  const text = fieldErrorText(items, field);
  return text === "" ? null : (
    <span id={fieldErrorId(ERROR_PREFIX, field)}> {text}</span>
  );
}

type Props = { task: Task; users: { id: string; name: string; label?: string }[] };

export function EditTaskForm({ task, users }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<TaskEditState>(() => startTaskEdit(task));
  const [received, setReceived] = useState<Task>();
  const [errors, setErrors] = useState<FormErrorItem[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const errorListRef = useRef<HTMLUListElement>(null);
  const [pending, setPending] = useState(false);
  const values = edit.values;
  const userNames = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const rows = edit.conflict ? conflictRows(edit.base, taskToEditValues(edit.conflict), values, userNames) : [];
  const canSave = canSaveTaskEdit(edit);

  // 「編集」を押してフォームが開いたら、タイトルの欄にフォーカスを移す。
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  // 誤りで断られたら、誤りの一覧にフォーカスを移す。
  useEffect(() => {
    if (errors.length > 0) errorListRef.current?.focus();
  }, [errors]);

  function startEditing() {
    setEdit(startTaskEdit(newerTask(task, received)));
    setErrors([]);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setErrors([]);
  }

  function rebase() {
    setEdit(rebaseOnCurrent);
    setErrors([]);
  }

  function set<K extends keyof TaskEditValues>(key: K, value: TaskEditValues[K]) {
    setEdit((e) => ({ ...e, values: { ...e.values, [key]: value } }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canSave) return;
    setPending(true);
    setErrors([]);
    const result = await saveTaskEdit(task.id, values, edit.expectedUpdatedAt, { fetch: (url, init) => fetch(url, init) });
    setPending(false);
    switch (result.status) {
      case "saved":
        setReceived(result.task);
        setOpen(false);
        router.refresh();
        return;
      case "conflict":
        setReceived(result.task);
        setEdit((e) => recordConflict(e, result.task));
        router.refresh();
        return;
      case "invalid":
        setErrors(toFormErrorItems(result.messages, { dueDate: values.dueDate }));
        return;
      case "unauthorized":
        window.location.href = "/login";
        return;
      case "error":
        setErrors([{ message: result.message }]);
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
      {edit.conflict && (
        <p role="alert" data-testid="edit-conflict">
          {TASK_EDIT_CONFLICT_MESSAGE}
        </p>
      )}
      {errors.length > 0 && (
        <ul role="alert" data-testid="edit-errors" ref={errorListRef} tabIndex={-1}>
          {errors.map((e) => (
            <li key={e.message}>{e.message}</li>
          ))}
        </ul>
      )}
      <p>
        <label>
          タイトル<span aria-hidden="true">（必須）</span>{" "}
          <input
            ref={titleRef}
            name="title"
            maxLength={200}
            required
            aria-required="true"
            {...fieldErrorProps(errors, ERROR_PREFIX, "title")}
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </label>
        <FieldError items={errors} field="title" />
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
                {u.label ?? u.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          期限<span aria-hidden="true">（必須）</span>{" "}
          <input
            name="dueDate"
            type="date"
            required
            aria-required="true"
            {...fieldErrorProps(errors, ERROR_PREFIX, "dueDate")}
            value={values.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
          />
        </label>
        <FieldError items={errors} field="dueDate" />
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
      <button type="submit" disabled={pending || !canSave}>
        保存
      </button>{" "}
      <button type="button" onClick={close} disabled={pending}>
        やめる
      </button>
      {edit.conflict && (
        <section aria-labelledby="edit-conflict-heading" data-testid="edit-conflict-diff">
          <h3 id="edit-conflict-heading">相手が変えた項目</h3>
          {rows.length === 0 ? (
            <p>{TASK_EDIT_NO_CHANGED_FIELDS_MESSAGE}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">項目</th>
                  <th scope="col">編集を始めたときの値</th>
                  <th scope="col">今の値</th>
                  <th scope="col">あなたの入力</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.field} data-field={r.field}>
                    <th scope="row">{r.label}</th>
                    <td style={{ whiteSpace: "pre-wrap" }}>{r.base}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{r.current}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{r.mine}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>「今の値で編集し直す」を押すと、相手が変えた項目は今の値になり、ほかの項目はあなたの入力のまま残ります。確かめてから保存してください。</p>
          <button type="button" onClick={rebase} disabled={pending}>
            今の値で編集し直す
          </button>
        </section>
      )}
    </form>
  );
}
