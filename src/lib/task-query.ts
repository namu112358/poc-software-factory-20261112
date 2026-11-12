import type { Db } from "./db/index.ts";
import { getDb } from "./db/index.ts";
import { isTaskStatus, listTasks, parseAssignee, parseSort, parseTagFilter, type Task } from "./tasks.ts";

/** タスク一覧のクエリ（status・assignee・tag・sort）を画面と同じ規則で検証し、絞り込んだ一覧を返す。不正な値は指定なし。 */
export function listTasksByQuery(query: URLSearchParams, db: Db = getDb()): Task[] {
  const status = query.get("status");
  return listTasks(
    {
      status: isTaskStatus(status) ? status : undefined,
      assignee: parseAssignee(query.get("assignee"), db),
      tag: parseTagFilter(query.get("tag")),
      sort: parseSort(query.get("sort")),
    },
    db,
  );
}
