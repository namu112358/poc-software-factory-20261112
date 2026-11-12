export default function TaskNotFound() {
  return (
    <main>
      <h1>タスクが見つかりません</h1>
      <p>削除されたか、番号が間違っている可能性があります。</p>
      <p>
        <a href="/tasks">タスク一覧へ戻る</a>
      </p>
    </main>
  );
}
