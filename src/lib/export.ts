import type { Db } from "./db/index.ts";
import { getDb } from "./db/index.ts";
import { listTagsByTask } from "./tags.ts";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  isTaskStatus,
  listTasks,
  parseAssignee,
  parseKeyword,
  parseSort,
  parseTagFilter,
  todayInJapan,
  type TaskFilter,
} from "./tasks.ts";
import { listUsers } from "./users.ts";

/** Excel でそのまま開けるように、CSV の先頭に付ける UTF-8 の BOM。 */
export const CSV_BOM = "﻿";

export const CSV_HEADERS = ["ID", "タイトル", "ステータス", "優先度", "担当者", "期限", "タグ"] as const;

/** CSV の 1 つの欄を RFC 4180 に沿ってエスケープする。カンマ・ダブルクォート・改行を含むときだけ `"` で囲む。 */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * 利用者が入力した文字の欄を、表計算ソフトが数式として動かさないようにする（CSV インジェクション対策）。
 * 先頭が `=`・`+`・`-`・`@`・タブ・CR のときだけ、先頭に `'` を付ける。エスケープ（escapeCsvField）の前に使う。
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** 欄の配列を 1 行の CSV にする（行末は含めない）。 */
export function toCsvRow(fields: readonly string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** URL のクエリ（一覧画面と同じ ?status=&assignee=&tag=&sort=）を、一覧画面と同じ検証で絞り込み条件にする。不正な値は指定なし。 */
export function parseTaskFilter(query: URLSearchParams, db: Db = getDb()): TaskFilter {
  const status = query.get("status");
  return {
    status: isTaskStatus(status) ? status : undefined,
    assignee: parseAssignee(query.get("assignee") ?? undefined, db),
    tag: parseTagFilter(query.get("tag") ?? undefined),
    q: parseKeyword(query.get("q") ?? undefined),
    sort: parseSort(query.get("sort") ?? undefined),
  };
}

/** 一覧画面の「CSV でダウンロード」のリンク先。開いている絞り込みと並び順を引き継ぐ。 */
export function exportHref(filter: TaskFilter): string {
  const params = new URLSearchParams();
  if (filter.status !== undefined) params.set("status", filter.status);
  if (filter.assignee !== undefined) params.set("assignee", filter.assignee);
  if (filter.tag !== undefined) params.set("tag", filter.tag);
  if (filter.q !== undefined) params.set("q", filter.q);
  if (filter.sort !== undefined && filter.sort !== "created") params.set("sort", filter.sort);
  const qs = params.toString();
  return qs === "" ? "/api/tasks/export" : `/api/tasks/export?${qs}`;
}

/** タスクの一覧の CSV（BOM 付き・行末は CRLF）。列は ID・タイトル・ステータス・優先度・担当者・期限・タグ。 */
export function exportTasksCsv(filter: TaskFilter = {}, db: Db = getDb()): string {
  const tasks = listTasks(filter, db);
  const tagsByTask = listTagsByTask(tasks.map((t) => t.id), db);
  const userNames = new Map(listUsers(db).map((u) => [u.id, u.name]));
  const rows = tasks.map((t) =>
    toCsvRow([
      String(t.id),
      neutralizeFormula(t.title),
      STATUS_LABELS[t.status],
      PRIORITY_LABELS[t.priority],
      userNames.get(t.assignee) ?? t.assignee,
      t.dueDate,
      neutralizeFormula((tagsByTask.get(t.id) ?? []).join("、")),
    ]),
  );
  return CSV_BOM + [toCsvRow(CSV_HEADERS), ...rows].map((line) => line + "\r\n").join("");
}

/** ダウンロードされるファイル名（例: tasks-2026-11-12.csv）。日付は日本時間。 */
export function exportFilename(now: Date = new Date()): string {
  return `tasks-${todayInJapan(now)}.csv`;
}
