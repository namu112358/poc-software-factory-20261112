import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  confirm,
  dependencies,
  handledByOthers,
  parseQueued,
  parseTouch,
  pick,
  precheck,
  type IssueInfo,
} from "../scripts/factory/claim-core.ts";

const touch = (files: string, at: string) => ({ body: `<!-- factory:touch files=${files} -->\n着手します。`, createdAt: at });
const queued = (attrs: string, at: string) => ({ body: `<!-- factory:queued ${attrs} -->\n待ちます。`, createdAt: at });
const issue = (number: number, comments: IssueInfo["comments"] = [], body = "", blockedBy: number[] = []): IssueInfo => ({
  number,
  body,
  comments,
  blockedBy,
});
const open = (...ns: number[]) => (n: number) => ns.includes(n);
const waitOf = (d: { decision: string; wait?: unknown }) => (d.decision === "go" ? null : d.wait);

describe("コメントの読み取り", () => {
  it("factory:touch の files を読む", () => {
    assert.deepEqual(parseTouch("<!-- factory:touch files=a.ts,b.ts -->\nx"), ["a.ts", "b.ts"]);
    assert.equal(parseTouch("ふつうのコメント"), null);
  });
  it("factory:queued の wait と files を読む（slot・#N・印が前後にあっても）", () => {
    assert.deepEqual(parseQueued("<!-- factory:queued wait=slot files=a.ts -->"), { wait: "slot", files: ["a.ts"] });
    assert.deepEqual(parseQueued("<!-- factory:queued wait=#12 -->"), { wait: 12, files: [] });
  });
  it("依存先は blocked by・本文の「#N の後」・最新の wait=#N（slot は含めない）", () => {
    const i = issue(10, [queued("wait=#3", "2026-01-01T00:00:00Z"), queued("wait=#4", "2026-01-01T00:01:00Z")], "#2 の後に入れる", [1]);
    assert.deepEqual(dependencies(i), [1, 2, 4]);
    assert.deepEqual(dependencies(issue(11, [queued("wait=slot", "2026-01-01T00:00:00Z")])), []);
  });
});

describe("着手の前の確かめ（precheck）", () => {
  const base = { queued: [], openPrs: [], isOpen: open() };
  it("依存先が開いていればキューに載せる", () => {
    const r = precheck({ ...base, self: issue(10, [], "#5 の後"), files: ["a.ts"], inProgress: [], isOpen: open(5) });
    assert.equal(r.decision, "queue");
    assert.equal(waitOf(r), 5);
  });
  it("自分以外の作業中が 4 件なら空き待ち、3 件なら着手してよい", () => {
    const four = [1, 2, 3, 4].map((n) => issue(n));
    const r = precheck({ ...base, self: issue(10), files: ["a.ts"], inProgress: [...four, issue(10)] });
    assert.equal(waitOf(r), "slot");
    assert.equal(precheck({ ...base, self: issue(10), files: ["a.ts"], inProgress: four.slice(0, 3) }).decision, "go");
  });
  it("同じファイルを変える開いている PR を待つ（自分の PR は除く）", () => {
    const openPrs = [
      { number: 50, headRef: "claude/issue-10", files: ["a.ts"] },
      { number: 51, headRef: "claude/issue-9", files: ["a.ts"] },
    ];
    const r = precheck({ ...base, openPrs, self: issue(10), files: ["a.ts"], inProgress: [] });
    assert.equal(waitOf(r), 51);
  });
  it("先に待っている（番号が小さい）queued の Issue と重なれば追い越さない。後の Issue とは比べない", () => {
    const older = issue(8, [queued("wait=slot files=a.ts", "2026-01-01T00:00:00Z")]);
    const newer = issue(12, [queued("wait=slot files=a.ts", "2026-01-01T00:00:00Z")]);
    assert.equal(precheck({ ...base, queued: [older], self: issue(10), files: ["a.ts"], inProgress: [] }).decision, "queue");
    assert.equal(precheck({ ...base, queued: [newer], self: issue(10), files: ["a.ts"], inProgress: [] }).decision, "go");
  });
});

describe("着手して 30 秒後の読み直し（confirm）", () => {
  // [SF-E] 第 1 回（#137）の再現: 先に 3 件が作業中、6 件がほぼ同時に着手
  const stale = [80, 88, 91].map((n) => issue(n, [touch(`old${n}.ts`, "2026-11-12T09:00:00Z")]));
  const sfe = [
    issue(170, [touch("h.ts", "2026-11-12T10:11:57Z")]),
    issue(168, [touch("s.ts", "2026-11-12T10:11:58Z")]),
    issue(171, [touch("v.ts", "2026-11-12T10:11:59Z")]),
    issue(172, [touch("t.ts", "2026-11-12T10:12:00Z")]),
    issue(173, [touch("a.ts", "2026-11-12T10:12:00Z")]),
    issue(169, [touch("p.ts", "2026-11-12T10:12:03Z")]),
  ];
  const all = [...stale, ...sfe];
  it("先に記録した 4 件だけが残り、残りは空き待ちで引き下がる", () => {
    const go = sfe.filter((s) => confirm({ self: s, inProgress: all }).decision === "go").map((s) => s.number);
    assert.deepEqual(go, [170]);
    const r = confirm({ self: sfe[1], inProgress: all });
    assert.equal(waitOf(r), "slot");
  });
  it("同じ時刻なら番号が小さいほうが先", () => {
    const three = stale;
    assert.equal(confirm({ self: sfe[3], inProgress: [...three, sfe[3], sfe[4]] }).decision, "go"); // #172 は #173 より先
    assert.equal(confirm({ self: sfe[4], inProgress: [...three, sfe[3], sfe[4]] }).decision, "retreat");
  });
  it("時刻は最新の factory:touch で比べる（取り出し直された Issue の古い記録は使わない）", () => {
    const a = issue(1, [touch("x.ts", "2026-11-12T09:00:00Z"), touch("x.ts", "2026-11-12T10:00:00Z")]);
    const b = issue(2, [touch("x.ts", "2026-11-12T09:59:00Z")]);
    assert.equal(confirm({ self: b, inProgress: [a, b] }).decision, "go");
    const r = confirm({ self: a, inProgress: [a, b] });
    assert.equal(waitOf(r), 2);
  });
  it("記録の無い作業中の Issue は先に着手したものとして数える。自分の記録が無ければ error", () => {
    const noTouch = [1, 2, 3, 4].map((n) => issue(n));
    assert.equal(confirm({ self: sfe[0], inProgress: [...noTouch, sfe[0]] }).decision, "retreat");
    assert.equal(confirm({ self: issue(9), inProgress: [] }).decision, "error");
  });
});

describe("キューから取り出す（pick）", () => {
  const q = (n: number, attrs: string) => issue(n, [queued(attrs, "2026-01-01T00:00:00Z")]);
  it("空きの数だけ、依存先の閉じたものを古い順に選ぶ", () => {
    const r = pick({ queued: [q(5, "wait=slot"), q(3, "wait=#99"), q(4, "wait=slot"), q(6, "wait=slot")], inProgressCount: 2, isOpen: open(99) });
    assert.deepEqual(r.pick, [4, 5]);
  });
  it("作業中が 4 件以上なら取り出さない（#218）", () => {
    assert.deepEqual(pick({ queued: [q(5, "wait=slot")], inProgressCount: 5, isOpen: open() }).pick, []);
  });
  it("同じ回に取り出した Issue と同じファイルを変える Issue は、待ち先を付け替える", () => {
    const r = pick({ queued: [q(1, "wait=slot files=a.ts"), q(2, "wait=slot files=a.ts,b.ts"), q(3, "wait=slot files=c.ts")], inProgressCount: 0, isOpen: open() });
    assert.deepEqual(r.pick, [1, 3]);
    assert.equal(r.rewait[0].issue, 2);
    assert.match(r.rewait[0].comment, /^<!-- factory:queued wait=#1 files=a\.ts,b\.ts -->/);
  });
});

describe("割り当ての重複（handled）", () => {
  it("since より後に、ほかのセッションが factory:dispatch を書いたものだけを返す", () => {
    const c = (issueNo: number, at: string, session: string) => ({
      issue: issueNo,
      createdAt: at,
      body: `<!-- factory:dispatch -->\n更新しました。\n\nセッション: https://claude.ai/code/${session}`,
    });
    const r = handledByOthers({
      since: "2026-11-12T09:23:00Z",
      mySession: "session_ME",
      comments: [c(157, "2026-11-12T09:23:20Z", "session_OTHER"), c(163, "2026-11-12T09:23:21Z", "session_ME"), c(174, "2026-11-12T09:22:00Z", "session_OTHER")],
    });
    assert.deepEqual(r, [157]);
  });
});
