// スキーマのマイグレーション。PRAGMA user_version で適用済みの番号を管理する。
// 既存のマイグレーションは書き換えず、変更は末尾に新しい番号で追加する。
export type Migration = {
  version: number;
  name: string;
  sql: string;
};

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "users_and_tasks",
    sql: `
      CREATE TABLE users (
        id   TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        title    TEXT NOT NULL,
        status   TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
        assignee TEXT NOT NULL REFERENCES users(id),
        due_date TEXT NOT NULL
      );
      CREATE INDEX tasks_assignee ON tasks(assignee);
    `,
  },
  {
    version: 2,
    name: "auth",
    sql: `
      ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL -- ISO 8601（UTC）
      );
      CREATE INDEX sessions_user ON sessions(user_id);
    `,
  },
  {
    version: 3,
    name: "comments",
    sql: `
      CREATE TABLE comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author     TEXT NOT NULL REFERENCES users(id),
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL -- ISO 8601（UTC）
      );
      CREATE INDEX comments_task ON comments(task_id);
    `,
  },
  {
    version: 4,
    name: "due_date_extensions",
    sql: `
      CREATE TABLE due_date_extensions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        requester    TEXT NOT NULL REFERENCES users(id),
        new_due_date TEXT NOT NULL, -- YYYY-MM-DD
        reason       TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        created_at   TEXT NOT NULL, -- ISO 8601（UTC）
        decided_by   TEXT REFERENCES users(id),
        decided_at   TEXT -- ISO 8601（UTC）
      );
      CREATE INDEX due_date_extensions_task ON due_date_extensions(task_id);
      CREATE UNIQUE INDEX due_date_extensions_one_pending ON due_date_extensions(task_id) WHERE status = 'pending';
    `,
  },
  {
    version: 5,
    name: "task_tags",
    sql: `
      CREATE TABLE task_tags (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name    TEXT NOT NULL,
        UNIQUE (task_id, name)
      );
      CREATE INDEX task_tags_name ON task_tags(name);
    `,
  },
  {
    version: 6,
    name: "task_priority",
    sql: `
      ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low'));
    `,
  },
  {
    version: 7,
    name: "task_estimate_minutes",
    sql: `
      ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR (estimate_minutes BETWEEN 1 AND 10000));
    `,
  },
  {
    version: 8,
    name: "task_memo",
    sql: `
      ALTER TABLE tasks ADD COLUMN memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 2000);
    `,
  },
  {
    version: 9,
    name: "login_attempts",
    sql: `
      CREATE TABLE login_attempts (
        user_id      TEXT PRIMARY KEY, -- 入力された ID（存在しない ID も数える）
        failures     INTEGER NOT NULL,
        locked_until TEXT -- ISO 8601（UTC）。ロックしていなければ NULL
      );
    `,
  },
  {
    version: 10,
    name: "task_timestamps",
    sql: `
      ALTER TABLE tasks ADD COLUMN created_at TEXT NOT NULL DEFAULT ''; -- ISO 8601（UTC）
      ALTER TABLE tasks ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''; -- ISO 8601（UTC）
      UPDATE tasks SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
    `,
  },
  {
    version: 11,
    name: "task_completed_at",
    sql: `
      -- 完了にした日時。ISO 8601（UTC）。完了していなければ NULL。既存の完了済みタスクも推測で埋めず NULL のまま。
      ALTER TABLE tasks ADD COLUMN completed_at TEXT;
    `,
  },
  {
    version: 12,
    name: "task_archived",
    sql: `
      -- アーカイブ済みなら 1。既存のタスクはすべて 0（アーカイブしていない）。
      ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
    `,
  },
  {
    version: 13,
    name: "comment_edited_at",
    sql: `
      -- コメントの本文を最後に編集した日時。ISO 8601（UTC）。一度も編集していなければ NULL。
      ALTER TABLE comments ADD COLUMN edited_at TEXT;
    `,
  },
  {
    version: 14,
    name: "last_login",
    sql: `
      -- 最後にログインに成功した日時。ISO 8601（UTC）。一度もログインしていなければ NULL（既存の利用者も NULL から始まる）。
      ALTER TABLE users ADD COLUMN last_login_at TEXT;
      -- このセッションでログインする 1 つ前のログイン日時。ISO 8601（UTC）。前回が無ければ NULL。
      ALTER TABLE sessions ADD COLUMN previous_login_at TEXT;
    `,
  },
  {
    version: 15,
    name: "task_assignee_changes",
    sql: `
      -- 担当者の変更の履歴。タスクを消すと一緒に消える。
      -- 変更前・変更後は、担当者の空（''）も残せるよう users への外部キーを付けない。
      CREATE TABLE task_assignee_changes (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_assignee TEXT NOT NULL,
        to_assignee   TEXT NOT NULL,
        changed_by    TEXT REFERENCES users(id), -- 変更した人。分からなければ NULL
        changed_at    TEXT NOT NULL -- ISO 8601（UTC）
      );
      CREATE INDEX task_assignee_changes_task ON task_assignee_changes(task_id);
    `,
  },
  {
    version: 16,
    name: "session_devices",
    sql: `
      -- ログインした日時。ISO 8601（UTC）。このマイグレーションより前に作られたセッションは NULL（不明）。
      ALTER TABLE sessions ADD COLUMN created_at TEXT;
      -- ログインしたときの User-Agent。分からなければ NULL。
      ALTER TABLE sessions ADD COLUMN user_agent TEXT;
      -- 画面・API でセッションを指定するための ID（ランダムな 32 桁の 16 進）。トークンを外に出さないために使う。
      ALTER TABLE sessions ADD COLUMN device_id TEXT;
      UPDATE sessions SET device_id = lower(hex(randomblob(16)));
      CREATE UNIQUE INDEX sessions_device_id ON sessions(device_id);
    `,
  },
  {
    version: 17,
    name: "failed_logins_since_login",
    sql: `
      -- 前回のログインに成功したあと、この利用者の ID でパスワードを誤った（ロック中の試行を含む）ログインの回数。
      -- ログインに成功すると 0 に戻す。既存の利用者は 0 から始まる。試されたパスワードは保存しない。
      ALTER TABLE users ADD COLUMN failed_logins_since_login INTEGER NOT NULL DEFAULT 0;
      -- このセッションでログインした時点の上の回数（ログイン後に知らせる）。既存のセッションは 0。
      ALTER TABLE sessions ADD COLUMN failed_logins_before INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 18,
    name: "task_soft_delete",
    sql: `
      -- タスクを削除した日時。ISO 8601（UTC）。削除していなければ NULL（既存のタスクは NULL から始まる）。
      -- 削除したタスクは行を残したまま見えなくし、一定の期間のうちは元に戻せる。
      ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
      -- タスクを削除した人。削除していなければ NULL。
      ALTER TABLE tasks ADD COLUMN deleted_by TEXT REFERENCES users(id);
      CREATE INDEX tasks_deleted_at ON tasks(deleted_at);
    `,
  },
  {
    version: 19,
    name: "task_view_prefs",
    sql: `
      -- 利用者ごとに覚えておく、タスク一覧の絞り込みと並べ替え。クエリ文字列（status・assignee・tag・q・due・sort・archived）をそのまま 1 行に入れる。
      -- 行が無い利用者は「覚えた条件なし」。利用者を消すと一緒に消える。
      CREATE TABLE task_view_prefs (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        query   TEXT NOT NULL
      );
    `,
  },
  {
    version: 20,
    name: "user_absences",
    sql: `
      -- メンバーの休みの期間。1 人につき 1 行だけ（登録し直すと置き換える）。日付は日本時間の YYYY-MM-DD で、両端を含む。
      -- 行が無いメンバーは「休みの登録なし」。利用者を消すと一緒に消える。
      CREATE TABLE user_absences (
        user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        start_date TEXT NOT NULL,
        end_date   TEXT NOT NULL,
        CHECK (start_date <= end_date)
      );
    `,
  },
  {
    version: 21,
    name: "session_last_used_at",
    sql: `
      -- この端末（セッション）で最後に画面・API を使った日時。ISO 8601（UTC）。
      -- 書き込みを減らすため、前の値から 5 分を過ぎた利用のときだけ更新する。
      -- このマイグレーションより前に作られたセッションは NULL（不明）から始まる。
      ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
    `,
  },
  {
    version: 22,
    name: "bulk_update_undo",
    sql: `
      -- タスクの担当者・ステータスをまとめて変えた 1 回分。変えてから一定の時間のうちは、変えた本人が元に戻せる。
      -- changed_at・undone_at は ISO 8601（UTC）。元に戻していなければ undone_at は NULL。
      CREATE TABLE bulk_updates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        changed_by TEXT REFERENCES users(id),
        changed_at TEXT NOT NULL,
        undone_at  TEXT
      );
      -- その回に値が変わったタスクごとの、変える前の値と、変えた直後の更新日時（後からほかの変更があったかを見分ける）。
      CREATE TABLE bulk_update_items (
        bulk_update_id    INTEGER NOT NULL REFERENCES bulk_updates(id) ON DELETE CASCADE,
        task_id           INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_status       TEXT NOT NULL,
        from_assignee     TEXT NOT NULL,
        from_completed_at TEXT,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (bulk_update_id, task_id)
      );
    `,
  },
  {
    version: 23,
    name: "user_role",
    sql: `
      -- 利用者の役割。member（メンバー）か coordinator（取りまとめる人）。延長の申請を承認・却下できるのは coordinator だけ。
      -- すでにいる利用者は member から始め、初期の 3 人のうち田中（tanaka）だけを coordinator にする。
      ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'coordinator'));
      UPDATE users SET role = 'coordinator' WHERE id = 'tanaka';
    `,
  },
  {
    version: 24,
    name: "comment_soft_delete",
    sql: `
      -- コメントを削除した日時。ISO 8601（UTC）。削除していなければ NULL（既存のコメントは NULL から始まる）。
      -- 削除したコメントは行を残したまま一覧・検索から見えなくし、一定の期間のうちは書いた本人が元に戻せる。
      ALTER TABLE comments ADD COLUMN deleted_at TEXT;
    `,
  },
  {
    version: 25,
    name: "comment_revisions",
    sql: `
      -- コメントを編集したときの、編集の前の本文。本文が変わった編集 1 回につき 1 行。
      -- edited_at は、その本文を書き換えた日時（ISO 8601（UTC））。コメントの edited_at と同じ値を入れる。
      -- 既存のコメントの前の本文は残っていないので、履歴は空から始まる。
      CREATE TABLE comment_revisions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        comment_id INTEGER NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        edited_at  TEXT NOT NULL
      );
      CREATE INDEX comment_revisions_comment ON comment_revisions(comment_id);
    `,
  },
  {
    version: 26,
    name: "login_events",
    sql: `
      -- ログインに成功した記録。成功 1 回につき 1 行。ログイン中のほかの端末に「新しいログインがあった」と知らせるのに使う。
      -- セッション（端末）がログアウト・切られても記録は残す。利用者を消すと一緒に消える。
      -- logged_in_at は ISO 8601（UTC）。user_agent は保存した User-Agent（無ければ NULL）。
      -- failed_logins_before は、そのログインの前（1 つ前のログインのあと）にパスワードを誤ったログインの回数。
      CREATE TABLE login_events (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        logged_in_at         TEXT NOT NULL,
        user_agent           TEXT,
        failed_logins_before INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX login_events_user ON login_events(user_id, id);
      -- そのセッションで、どのログインの記録（login_events.id）までを確かめたか。これより後の記録を知らせる。
      -- 作ったときは、その時点の自分の最新の記録（自分のログインを含む）にする。既存のセッションは 0（記録は空から始まる）。
      ALTER TABLE sessions ADD COLUMN login_notices_seen_through INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 27,
    name: "locks_since_login",
    sql: `
      -- 前回のログインのあとに、その利用者の ID でログインがロックされた回数と、最後にロックされた日時（ISO 8601（UTC））。
      -- ロックをかけたとき（続けて誤った回数が上限に達したとき）に増やし、ログインに成功したら 0 と NULL に戻す。
      ALTER TABLE users ADD COLUMN locks_since_login INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN last_locked_at TEXT;
      -- ログインした時点で、前回のログインのあとにロックされた回数と最後の日時。ログイン後に知らせる。既存のセッションは 0（知らせない）。
      ALTER TABLE sessions ADD COLUMN locks_before INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sessions ADD COLUMN last_locked_at_before TEXT;
    `,
  },
  {
    version: 28,
    name: "user_suspension",
    sql: `
      -- 取りまとめる人が利用者のログインを停止した日時（ISO 8601（UTC））。停止していなければ NULL（既存の利用者は NULL から始まる）。
      -- 停止した利用者はログインできず、担当者の選択肢に出ない。利用者の行は消さないので、過去の記録の名前は残る。再開したら NULL に戻す。
      ALTER TABLE users ADD COLUMN suspended_at TEXT;
    `,
  },
  {
    version: 29,
    name: "login_attempts_by_source",
    sql: `
      -- ログインの失敗を「入力された ID と接続元の組」で数える（#526）。source は接続元の IP アドレス。見分けられなければ ''（ID ごとに数える）。
      -- 既存の行は、接続元の分からない組として引き継ぐ。
      CREATE TABLE login_attempts_new (
        user_id      TEXT NOT NULL, -- 入力された ID（存在しない ID も数える）
        source       TEXT NOT NULL DEFAULT '',
        failures     INTEGER NOT NULL,
        locked_until TEXT, -- ISO 8601（UTC）。ロックしていなければ NULL
        PRIMARY KEY (user_id, source)
      );
      INSERT INTO login_attempts_new (user_id, source, failures, locked_until)
        SELECT user_id, '', failures, locked_until FROM login_attempts;
      DROP TABLE login_attempts;
      ALTER TABLE login_attempts_new RENAME TO login_attempts;
      -- アカウント全体（接続元をまたいだ）の失敗の時刻。直前 1 時間の数でアカウント全体をロックする。1 時間より古い行は書くついでに消す。
      CREATE TABLE login_failure_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id   TEXT NOT NULL, -- 入力された ID（存在しない ID も数える）
        failed_at TEXT NOT NULL  -- ISO 8601（UTC）
      );
      CREATE INDEX login_failure_log_user ON login_failure_log(user_id, failed_at);
      -- アカウント全体のロック。locked_until を過ぎたら明ける。
      CREATE TABLE account_login_locks (
        user_id      TEXT PRIMARY KEY, -- 入力された ID（存在しない ID も数える）
        locked_until TEXT NOT NULL     -- ISO 8601（UTC）
      );
    `,
  },
  {
    version: 30,
    name: "must_change_password",
    sql: `
      -- 仮のパスワードのままか（1: 本人が自分のパスワードに変えるまで、ほかの画面と API を使えない。0: ふつう）。#523
      -- 取りまとめる人がアカウントを作ったときに 1 にし、本人がパスワードを変えたら 0 に戻す。既存の利用者は 0 から始まる。
      ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
    `,
  },
  {
    version: 31,
    name: "idempotency_keys",
    sql: `
      -- 作成の API に付けられた Idempotency-Key と、最初の応答（#528）。同じ利用者が同じ用途・同じキーで送り直したら、新しく作らずにこの応答を返す。
      -- scope は用途（'tasks.create'・'comments.create'）。fingerprint は送られた本文（コメントは対象のタスクの ID も含む）の SHA-256。
      -- 成功した応答（response_status と、JSON の response_body）だけを残す。created_at は ISO 8601（UTC）。24 時間を過ぎた行は、書くついでに消す。
      CREATE TABLE idempotency_keys (
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope           TEXT NOT NULL,
        key             TEXT NOT NULL,
        fingerprint     TEXT NOT NULL,
        response_status INTEGER NOT NULL,
        response_body   TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        PRIMARY KEY (user_id, scope, key)
      );
      CREATE INDEX idempotency_keys_created_at ON idempotency_keys(created_at);
    `,
  },
];
