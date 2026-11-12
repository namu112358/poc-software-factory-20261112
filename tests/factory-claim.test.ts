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
  readyBudget,
  READY_EVENTS_PER_HOUR_BUDGET,
  waitingSince,
  waitsOn,
  blockingDeps,
  makeIsStalled,
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
  it("キューに載ったことの無い Issue は、同じファイルを変える queued の Issue を、番号にかかわらず追い越さない（#183）", () => {
    // #84 の再現: 先に待っている #84 を、後から ready になった番号の大きい #108 が追い越していた
    const waiting84 = issue(84, [queued("wait=#236 files=src/lib/tasks.ts", "2026-11-12T11:12:07Z")]);
    const r = precheck({ ...base, queued: [waiting84], self: issue(108), files: ["src/lib/tasks.ts"], inProgress: [] });
    assert.equal(waitOf(r), 84);
    const waiting12 = issue(12, [queued("wait=slot files=a.ts", "2026-01-01T00:00:00Z")]);
    assert.equal(waitOf(precheck({ ...base, queued: [waiting12], self: issue(10), files: ["a.ts"], inProgress: [] })), 12);
  });
  it("取り出された Issue は、自分より後に待ち始めた queued の Issue には待たされない", () => {
    const self = issue(92, [queued("wait=#83 files=src/lib/tasks.ts", "2026-11-12T09:05:00Z")]);
    const later = issue(85, [queued("wait=#83 files=src/lib/tasks.ts", "2026-11-12T10:30:00Z")]);
    assert.equal(precheck({ ...base, queued: [later, self], self, files: ["src/lib/tasks.ts"], inProgress: [] }).decision, "go");
    const earlier = issue(101, [queued("wait=#83 files=src/lib/tasks.ts", "2026-11-12T09:00:00Z")]);
    assert.equal(waitOf(precheck({ ...base, queued: [earlier, self], self, files: ["src/lib/tasks.ts"], inProgress: [] })), 101);
  });
  it("待ち始めの時刻は、最初の factory:queued のコメントの時刻", () => {
    const i = issue(92, [touch("a.ts", "2026-11-12T08:00:00Z"), queued("wait=#83", "2026-11-12T09:05:00Z"), queued("wait=#99", "2026-11-12T11:00:00Z")]);
    assert.equal(waitingSince(i), "2026-11-12T09:05:00Z");
    assert.equal(waitingSince(issue(1)), null);
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

describe("自分の PR がすでにあるとき（#248）", () => {
  it("confirm・precheck は、上限を超えていても引き下がらせず go を返す", () => {
    const four = [1, 2, 3, 4].map((n) => issue(n));
    const self = issue(229, [touch("tz.ts", "2026-11-12T11:16:25Z")]);
    const c = confirm({ self, inProgress: [...four, self], ownPr: 239 });
    assert.equal(c.decision, "go");
    assert.match(c.decision === "go" ? (c.note ?? "") : "", /#239/);
    assert.equal(precheck({ self, files: ["tz.ts"], inProgress: four, queued: [], openPrs: [], isOpen: () => false, ownPr: 239 }).decision, "go");
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

describe("キューから取り出す（pick）: 待っている時間と、開いている PR・作業中の Issue（#183）", () => {
  it("番号ではなく、待ち始めが早い順に選ぶ", () => {
    const longWait = issue(92, [queued("wait=slot files=a.ts", "2026-11-12T09:05:00Z")]);
    const shortWait = issue(85, [queued("wait=slot files=b.ts", "2026-11-12T11:00:00Z")]);
    assert.deepEqual(pick({ queued: [shortWait, longWait], inProgressCount: 3, isOpen: open() }).pick, [92]);
  });
  it("同じファイルを変える開いている PR があれば、取り出さずに待ち先をその PR に付け替える", () => {
    const q84 = issue(84, [queued("wait=#236 files=src/lib/tasks.ts", "2026-11-12T11:12:07Z")]);
    const openPrs = [{ number: 238, headRef: "claude/issue-108", files: ["src/lib/tasks.ts"] }];
    const r = pick({ queued: [q84], inProgressCount: 0, isOpen: open(), openPrs });
    assert.deepEqual(r.pick, []);
    assert.equal(r.rewait[0].wait, 238);
    assert.match(r.rewait[0].comment, /^<!-- factory:queued wait=#238 files=src\/lib\/tasks\.ts -->/);
  });
  it("待ち先がすでに同じなら、付け替えのコメントをくり返さない", () => {
    const q84 = issue(84, [queued("wait=#238 files=src/lib/tasks.ts", "2026-11-12T11:20:00Z")]);
    const openPrs = [{ number: 238, headRef: "claude/issue-108", files: ["src/lib/tasks.ts"] }];
    const r = pick({ queued: [q84], inProgressCount: 0, isOpen: open(238), openPrs });
    assert.deepEqual(r.pick, []);
    assert.deepEqual(r.rewait, []);
  });
  it("作業中の Issue と同じファイルを変えるなら取り出さない。自分の PR は数えない", () => {
    const q = issue(210, [queued("wait=#93 files=src/app/tasks/page.tsx", "2026-11-12T10:57:47Z")]);
    const working = issue(213, [touch("src/app/tasks/page.tsx,src/lib/tasks.ts", "2026-11-12T11:30:00Z")]);
    const r = pick({ queued: [q], inProgressCount: 1, isOpen: open(), inProgress: [working] });
    assert.deepEqual(r.pick, []);
    assert.equal(r.rewait[0].wait, 213);
    const own = [{ number: 300, headRef: "claude/issue-210", files: ["src/app/tasks/page.tsx"] }];
    assert.deepEqual(pick({ queued: [q], inProgressCount: 0, isOpen: open(), openPrs: own }).pick, [210]);
  });
  it("依存先が開いていて飛ばした、先に待っている Issue と同じファイルを変える Issue は取り出さない", () => {
    const a = issue(92, [queued("wait=#300 files=src/lib/tasks.ts", "2026-11-12T09:05:00Z")]);
    const b = issue(98, [queued("wait=slot files=src/lib/tasks.ts", "2026-11-12T10:00:00Z")]);
    const c = issue(99, [queued("wait=slot files=other.ts", "2026-11-12T10:10:00Z")]);
    const r = pick({ queued: [a, b, c], inProgressCount: 0, isOpen: open(300) });
    assert.deepEqual(r.pick, [99]);
    assert.equal(r.rewait[0].issue, 98);
    assert.equal(r.rewait[0].wait, 92);
  });
  it("前より長く待っている Issue が、同じファイルを変える新しい待ちより先に出る", () => {
    const old = issue(92, [queued("wait=slot files=src/lib/tasks.ts", "2026-11-12T09:05:00Z")]);
    const fresh = issue(85, [queued("wait=slot files=src/lib/tasks.ts", "2026-11-12T11:00:00Z")]);
    const r = pick({ queued: [fresh, old], inProgressCount: 0, isOpen: open() });
    assert.deepEqual(r.pick, [92]);
    assert.equal(r.rewait[0].issue, 85);
    assert.equal(r.rewait[0].wait, 92);
  });
});

describe("お互いを待って止まらない（#253 のレビュー）", () => {
  const base = { openPrs: [], isOpen: open() };
  it("難しい用に回された作業中の Issue は、自分を待っている queued の Issue の後ろに並ばない", () => {
    const waiting20 = issue(20, [queued("wait=#10 files=src/lib/tasks.ts", "2026-11-12T10:00:00Z")]);
    const self10 = issue(10, [touch("src/lib/tasks.ts", "2026-11-12T09:59:00Z")]);
    const r = precheck({ ...base, queued: [waiting20], self: self10, files: ["src/lib/tasks.ts"], inProgress: [], isOpen: open(10) });
    assert.equal(r.decision, "go");
  });
  it("引き下がった Issue を、自分を待っている Issue に付け替えない", () => {
    const waiting20 = issue(20, [queued("wait=#10 files=src/lib/tasks.ts", "2026-11-12T10:00:00Z")]);
    const retreated10 = issue(10, [touch("src/lib/tasks.ts", "2026-11-12T09:59:00Z"), queued("wait=#30 files=src/lib/tasks.ts", "2026-11-12T10:05:00Z")]);
    const r = pick({ queued: [waiting20, retreated10], inProgressCount: 0, isOpen: open(10) });
    assert.deepEqual(r.pick, [10]);
    assert.deepEqual(r.rewait, []);
  });
  it("待ち先を間に挟んでも（A→B→C）自分に戻ってくれば、自分を待っているとみなす", () => {
    const a = issue(1, [queued("wait=#2", "2026-01-01T00:00:00Z")]);
    const b = issue(2, [queued("wait=#3", "2026-01-01T00:00:00Z")]);
    assert.equal(waitsOn(a, 3, [a, b]), true);
    assert.equal(waitsOn(a, 4, [a, b]), false);
    const loop = issue(5, [queued("wait=#6", "2026-01-01T00:00:00Z")]);
    const loop2 = issue(6, [queued("wait=#5", "2026-01-01T00:00:00Z")]);
    assert.equal(waitsOn(loop, 7, [loop, loop2]), false); // 輪になっていても止まる
  });
});

describe("待ち先が人を待って止まっているとき（#255）", () => {
  const stalled = (...ns: number[]) => (n: number) => ns.includes(n);
  it("同じファイル待ち（wait=#N）の待ち先が needs-human なら、その待ちは数えない", () => {
    const i210 = issue(210, [queued("wait=#84 files=src/app/tasks/page.tsx", "2026-11-12T11:19:40Z")]);
    assert.deepEqual(blockingDeps(i210, open(84), stalled(84)), []);
    assert.deepEqual(blockingDeps(i210, open(84), stalled()), [84]);
  });
  it("人が決めた依存（blocked by・「#N の後」）は、待ち先が needs-human でも待つ", () => {
    const i = issue(10, [queued("wait=#5", "2026-01-01T00:00:00Z")], "#7 の後", [6]);
    assert.deepEqual(blockingDeps(i, open(5, 6, 7), stalled(5, 6, 7)), [6, 7]);
  });
  it("pick: 待ち先が needs-human の Issue を取り出す", () => {
    const i210 = issue(210, [queued("wait=#84 files=src/app/tasks/page.tsx", "2026-11-12T11:19:40Z")]);
    assert.deepEqual(pick({ queued: [i210], inProgressCount: 0, isOpen: open(84), isStalled: stalled(84) }).pick, [210]);
    assert.deepEqual(pick({ queued: [i210], inProgressCount: 0, isOpen: open(84) }).pick, []);
  });
  it("pick: 人を待って止まった PR と同じファイルを変えていても、取り出す", () => {
    const q = issue(210, [queued("wait=slot files=a.ts", "2026-11-12T11:00:00Z")]);
    const openPrs = [{ number: 300, headRef: "claude/issue-84", files: ["a.ts"], stalled: true }];
    assert.deepEqual(pick({ queued: [q], inProgressCount: 0, isOpen: open(), openPrs }).pick, [210]);
  });
  it("待ち先が PR で、止まった印がその Issue にだけ付いていても、待ちを解く（#257 のレビュー）", () => {
    const isStalled = makeIsStalled(new Map([[84, ["enhancement", "needs-human"]], [300, []]]), new Map([[300, 84]]));
    assert.equal(isStalled(300), true);
    assert.equal(isStalled(84), true);
    assert.equal(makeIsStalled(new Map([[300, []]]), new Map([[300, 84]]))(300), false);
    const i210 = issue(210, [queued("wait=#300 files=a.ts", "2026-11-12T11:19:40Z")]);
    const openPrs = [{ number: 300, headRef: "claude/issue-84", files: ["a.ts"], stalled: true }];
    assert.deepEqual(pick({ queued: [i210], inProgressCount: 0, isOpen: open(300, 84), isStalled, openPrs }).pick, [210]);
    const r = precheck({ self: i210, files: ["a.ts"], inProgress: [], queued: [i210], openPrs, isOpen: open(300, 84), isStalled });
    assert.equal(r.decision, "go");
  });
  it("precheck: 止まった PR と同じファイルを変えるなら、待たずに着手し、そのことを note で伝える", () => {
    const openPrs = [{ number: 300, headRef: "claude/issue-84", files: ["a.ts"], stalled: true }];
    const r = precheck({ self: issue(210), files: ["a.ts"], inProgress: [], queued: [], openPrs, isOpen: open() });
    assert.equal(r.decision, "go");
    assert.match(r.decision === "go" ? (r.note ?? "") : "", /#300/);
    const live = [{ number: 301, headRef: "claude/issue-85", files: ["a.ts"] }];
    assert.equal(waitOf(precheck({ self: issue(210), files: ["a.ts"], inProgress: [], queued: [], openPrs: live, isOpen: open() })), 301);
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

describe("1 時間あたりの起動の数（budget。#250）", () => {
  const q = (n: number) => issue(n, [queued("wait=slot", "2026-01-01T00:00:00Z")]);
  it("残りの数は、上限の推定から直近 60 分の数を引いたもの（0 未満にしない）", () => {
    assert.equal(readyBudget(40).remaining, READY_EVENTS_PER_HOUR_BUDGET - 40);
    assert.equal(readyBudget(99).remaining, 0);
  });
  it("取り出す数は、空きと残りの数の小さいほう。残りが 0 なら取り出さない", () => {
    const queuedIssues = [q(1), q(2), q(3)];
    assert.deepEqual(pick({ queued: queuedIssues, inProgressCount: 0, isOpen: open(), readyRemaining: 1 }).pick, [1]);
    assert.deepEqual(pick({ queued: queuedIssues, inProgressCount: 0, isOpen: open(), readyRemaining: 0 }).pick, []);
    assert.deepEqual(pick({ queued: queuedIssues, inProgressCount: 2, isOpen: open() }).pick, [1, 2]);
  });
});
