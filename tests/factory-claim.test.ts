import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dependencies,
  handledByOthers,
  parseQueued,
  parseTouch,
  pick,
  precheck,
  mergeCheck,
  reviewStatus,
  ciCheck,
  combineChecks,
  precheckActions,
  relabelTargets,
  readyBudget,
  READY_EVENTS_PER_HOUR_BUDGET,
  waitingSince,
  waitsOn,
  blockingDeps,
  makeIsStalled,
  stalledActions,
  gateDecision,
  settleMergeable,
  ciWaitStep,
  type CiWaitState,
  type CiWaitRead,
  type GateInput,
  type StalledPr,
  type StalledIssue,
  type IssueInfo,
  normalizeLabel,
  START_LABELS,
  isOwnClaudePr,
  stalledLoadPlan,
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
  it("付ける直前に読み直したラベルに ready が無い・作業中や人待ちの印・epic があれば skip（#322）", () => {
    const withLabels = (labels: string[]) => ({ ...issue(310), labels });
    // #310 の再現: 16:23:45 に ready を外したのに、16:24:05 に in-progress が付いた
    assert.equal(precheck({ ...base, self: withLabels(["enhancement"]), files: ["a.ts"], inProgress: [] }).decision, "skip");
    for (const l of ["status:in-progress", "status:in-progress-hard", "status:needs-human", "status:blocked-question", "kind:epic", "kind:kaizen"]) {
      assert.equal(precheck({ ...base, self: withLabels(["status:ready", l]), files: ["a.ts"], inProgress: [] }).decision, "skip", l);
    }
    assert.equal(precheck({ ...base, self: withLabels(["status:ready", "type:feat"]), files: ["a.ts"], inProgress: [] }).decision, "go");
  });
  it("go の結果に、先に待ち始めて同じファイルを予定している Issue（先頭でないもの）を ahead に入れる（#183）", () => {
    // #12 は #11 の後ろで待っている（先頭でない）ので #10 を止めないが、追い越したことは記録に残す
    const head11 = issue(11, [queued("wait=#99 files=x.ts", "2026-01-01T00:00:00Z")]);
    const behind12 = issue(12, [queued("wait=#11 files=a.ts,x.ts", "2026-01-01T00:01:00Z")]);
    const later13 = issue(13, [queued("wait=slot files=a.ts", "2026-01-01T00:09:00Z")]);
    const self = issue(10, [queued("wait=slot files=a.ts", "2026-01-01T00:05:00Z")]);
    const r = precheck({ ...base, queued: [head11, behind12, later13, self], self, files: ["a.ts"], inProgress: [], isOpen: open(99) });
    assert.equal(r.decision, "go");
    assert.deepEqual(r.decision === "go" ? r.ahead : null, [12]);
  });
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
    // #84 の再現: 先に待っている #84 を、後から status:ready になった番号の大きい #108 が追い越していた
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

describe("自分の PR がすでにあるとき（#248）", () => {
  it("precheck は、上限を超えていても待たせず go を返す", () => {
    const four = [1, 2, 3, 4].map((n) => issue(n));
    const self = issue(229, [touch("tz.ts", "2026-11-12T11:16:25Z")]);
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
    // どちらか 1 件だけを出し、もう 1 件は出したほうを待つ（お互いを待たない。#10 はキューにいるだけなので #20 の依存にならず、待ち始めの早い #20 が先。#275）
    assert.deepEqual(r.pick, [20]);
    assert.deepEqual(r.rewait.map((x) => [x.issue, x.wait]), [[10, 20]]);
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
  it("同じファイル待ち（wait=#N）の待ち先が status:needs-human なら、その待ちは数えない", () => {
    const i210 = issue(210, [queued("wait=#84 files=src/app/tasks/page.tsx", "2026-11-12T11:19:40Z")]);
    assert.deepEqual(blockingDeps(i210, open(84), stalled(84)), []);
    assert.deepEqual(blockingDeps(i210, open(84), stalled()), [84]);
  });
  it("人が決めた依存（blocked by・「#N の後」）は、待ち先が status:needs-human でも待つ", () => {
    const i = issue(10, [queued("wait=#5", "2026-01-01T00:00:00Z")], "#7 の後", [6]);
    assert.deepEqual(blockingDeps(i, open(5, 6, 7), stalled(5, 6, 7)), [6, 7]);
  });
  it("pick: 待ち先が status:needs-human の Issue を取り出す", () => {
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
    const isStalled = makeIsStalled(new Map([[84, ["type:feat", "status:needs-human"]], [300, []]]), new Map([[300, 84]]));
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

describe("待つ理由が無くなった同じファイル待ちを解く（#262）", () => {
  // #98 の再現: tasks.ts の重なりで #213 を待ったが、tasks.ts を分けた後は #213 と重ならない
  const q98 = issue(98, [queued("wait=#213 files=src/app/api/tasks/[id]/route.ts,src/lib/tasks.ts", "2026-11-12T11:25:34Z")]);
  const working213 = issue(213, [touch("src/app/tasks/page.tsx,src/lib/task-format.ts", "2026-11-12T13:30:30Z")]);
  it("待ち先の今のファイル（作業中なら最新の factory:touch）と重ならなければ、待ち終わりとして取り出す", () => {
    const r = pick({ queued: [q98], inProgressCount: 1, isOpen: open(213), inProgress: [working213] });
    assert.deepEqual(r.pick, [98]);
  });
  it("待ち先の今のファイルとまだ重なるなら待つ", () => {
    const still = issue(213, [touch("src/app/api/tasks/[id]/route.ts", "2026-11-12T13:30:30Z")]);
    assert.deepEqual(pick({ queued: [q98], inProgressCount: 1, isOpen: open(213), inProgress: [still] }).pick, []);
  });
  it("待ち先が PR なら、その変更ファイルで判定する。今のファイルが分からなければ待つ", () => {
    const q = issue(98, [queued("wait=#300 files=src/lib/tasks.ts", "2026-11-12T11:25:34Z")]);
    const openPrs = [{ number: 300, headRef: "claude/issue-92", files: ["src/lib/task-store.ts"] }];
    assert.deepEqual(pick({ queued: [q], inProgressCount: 0, isOpen: open(300), openPrs }).pick, [98]);
    assert.deepEqual(pick({ queued: [q], inProgressCount: 0, isOpen: open(300) }).pick, []); // #300 のファイルが分からない
  });
  it("待ち先の Issue に PR があれば、着手の記録（見積もり）より PR の実際の変更ファイルで判定する", () => {
    // 13:31 の #213 の再現: 着手の記録は tasks.ts を含むが、PR #272 が変えたのは task-format.ts
    const w213 = issue(213, [touch("src/app/tasks/page.tsx,src/lib/tasks.ts", "2026-11-12T13:31:10Z")]);
    const openPrs = [{ number: 272, headRef: "claude/issue-213", files: ["src/app/tasks/page.tsx", "src/lib/task-format.ts", "tests/unestimated-count.test.ts"] }];
    assert.deepEqual(pick({ queued: [q98], inProgressCount: 1, isOpen: open(213), inProgress: [w213], openPrs }).pick, [98]);
    assert.deepEqual(pick({ queued: [q98], inProgressCount: 1, isOpen: open(213), inProgress: [w213] }).pick, []); // PR が無ければ記録で判定
  });
  it("待ち先が作業中でも、着手の記録がまだ無ければ「分からない」として待つ", () => {
    const justStarted = issue(213, []);
    assert.deepEqual(pick({ queued: [q98], inProgressCount: 1, isOpen: open(213), inProgress: [justStarted] }).pick, []);
  });
  it("人が決めた依存（blocked by・「#N の後」）は、重ならなくても判定し直さずに待つ", () => {
    const human = issue(98, [queued("wait=slot files=a.ts", "2026-11-12T11:25:34Z")], "#213 の後", [214]);
    const r = pick({ queued: [human], inProgressCount: 1, isOpen: open(213, 214), inProgress: [working213] });
    assert.deepEqual(r.pick, []);
  });
  it("precheck は、自分の今のファイル（--files）で判定し直す", () => {
    const self = issue(98, [queued("wait=#213 files=src/lib/tasks.ts", "2026-11-12T11:25:34Z")]);
    const r = precheck({ self, files: ["src/app/api/tasks/[id]/route.ts"], inProgress: [working213], queued: [self], openPrs: [], isOpen: open(213) });
    assert.equal(r.decision, "go");
    const r2 = precheck({ self, files: ["src/app/tasks/page.tsx"], inProgress: [working213], queued: [self], openPrs: [], isOpen: open(213) });
    assert.equal(r2.decision, "queue");
  });
});

describe("#275 の再現: 13:40 UTC のキュー 12 件（待ちの数珠つなぎと古い見積もり）", () => {
  const q = (n: number, recs: [string, string][]) => issue(n, recs.map(([at, attrs]) => queued(attrs, at)));
  const queue275 = [
    q(85, [["2026-11-12T11:25:34Z", "wait=#236 files=src/lib/db/migrations.ts,src/lib/comments.ts,src/app/api/tasks/[id]/comments/[commentId]/route.ts,src/app/tasks/[id]/page.tsx"], ["2026-11-12T13:12:44Z", "wait=#101 files=src/lib/db/migrations.ts,src/lib/comments.ts,src/app/api/tasks/[id]/comments/[commentId]/route.ts,src/app/tasks/[id]/page.tsx"]]),
    q(94, [["2026-11-12T12:42:18Z", "wait=#84 files=src/app/api/tasks/[id]/route.ts,src/lib/tasks.ts,src/app/tasks/[id]/page.tsx"], ["2026-11-12T13:12:33Z", "wait=#213 files=src/app/api/tasks/[id]/route.ts,src/lib/tasks.ts,src/app/tasks/[id]/page.tsx"]]),
    q(98, [["2026-11-12T11:25:34Z", "wait=#236 files=src/app/api/tasks/[id]/route.ts,src/lib/tasks.ts"], ["2026-11-12T13:12:32Z", "wait=#213 files=src/app/api/tasks/[id]/route.ts,src/lib/tasks.ts"]]),
    q(100, [["2026-11-12T13:31:18Z", "wait=#210 files=src/app/tasks/new/page.tsx,src/app/tasks/page.tsx,src/app/layout.tsx,src/lib/task-form.ts"]]),
    q(101, [["2026-11-12T11:14:06Z", "wait=#236 files=src/app/tasks/[id]/page.tsx,src/lib/tasks.ts,tests/completed-at-display.test.ts"], ["2026-11-12T13:12:30Z", "wait=#213 files=src/app/tasks/[id]/page.tsx,src/lib/tasks.ts,tests/completed-at-display.test.ts"]]),
    q(102, [["2026-11-12T13:12:21Z", "wait=#92 files=src/app/tasks/page.tsx,src/lib/task-query.ts,src/lib/tasks.ts,src/app/api/tasks/route.ts"], ["2026-11-12T13:30:40Z", "wait=#210 files=src/app/tasks/page.tsx,src/lib/task-query.ts,src/lib/tasks.ts,src/app/api/tasks/route.ts"]]),
    q(104, [["2026-11-12T12:42:12Z", "wait=#101 files=src/lib/tags.ts,src/app/tasks/[id]/tags.tsx,src/app/tasks/[id]/page.tsx"]]),
    q(210, [["2026-11-12T10:50:03Z", "wait=slot files=src/app/tasks/page.tsx"], ["2026-11-12T13:12:29Z", "wait=#213 files=src/app/tasks/page.tsx"]]),
    q(211, [["2026-11-12T10:50:06Z", "wait=slot files=src/app/tasks/page.tsx,src/lib/tasks.ts"], ["2026-11-12T10:58:28Z", "wait=#210 files=src/app/tasks/page.tsx,src/lib/tasks.ts"]]),
    q(259, [["2026-11-12T13:12:22Z", "wait=#92 files=src/lib/overdue.ts,src/lib/members.ts,src/lib/tasks.ts,src/lib/export.ts,src/lib/board.ts,src/lib/tags.ts"], ["2026-11-12T13:30:41Z", "wait=#211 files=src/lib/overdue.ts,src/lib/members.ts,src/lib/tasks.ts,src/lib/export.ts,src/lib/board.ts,src/lib/tags.ts"]]),
    q(266, [["2026-11-12T13:23:17Z", "wait=#259 files=src/app/members/page.tsx,src/lib/members.ts"]]),
    q(267, [["2026-11-12T13:29:31Z", "wait=#104 files=src/app/tags/page.tsx,src/lib/tags.ts"], ["2026-11-12T13:36:26Z", "wait=#104 files=src/app/settings/password/form.tsx,src/lib/password-strength.ts"]]),
  ];
  // #213 は PR #272 が Mergify のキューにいて、作業中のラベルは外れている。#84・#92・#236 は閉じている
  const openPrs = [{ number: 272, headRef: "claude/issue-213", files: ["src/app/tasks/page.tsx", "src/lib/task-format.ts", "tests/unestimated-count.test.ts"] }];
  const isOpen275 = open(85, 94, 98, 100, 101, 102, 104, 210, 211, 213, 259, 266, 267, 272);
  it("空き 4 件で、#101・#266・#267 の 3 件を取り出せる（直す前は 0 件）", () => {
    const r = pick({ queued: queue275, inProgressCount: 0, isOpen: isOpen275, openPrs, inProgress: [] });
    assert.deepEqual(r.pick, [101, 266, 267]);
  });
  it("待ち先は先頭か動いている作業だけになり、数珠つなぎにならない", () => {
    const r = pick({ queued: queue275, inProgressCount: 0, isOpen: isOpen275, openPrs, inProgress: [] });
    const heads = new Set([101, 210, 266, 267, 213, 272]);
    for (const x of r.rewait) assert.ok(heads.has(x.wait), `#${x.issue} → #${x.wait}`);
  });
  it("#267（ほかの Issue と重ならない）は、キューにいるだけの #104 を待たずに着手してよい", () => {
    const self = queue275.find((i) => i.number === 267)!;
    const r = precheck({ self, files: ["src/app/settings/password/form.tsx", "src/lib/password-strength.ts"], inProgress: [], queued: queue275, openPrs, isOpen: isOpen275 });
    assert.equal(r.decision, "go");
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

describe("役がそのまま行う操作（precheckActions・relabelTargets）", () => {
  it("go なら status:ready を外して status:in-progress を付け、着手の記録を書く", () => {
    const a = precheckActions(issue(5), ["a.ts"], { decision: "go" });
    assert.deepEqual(a.removeLabels, ["status:ready"]);
    assert.deepEqual(a.addLabels, ["status:in-progress"]);
    assert.match(a.comment ?? "", /^<!-- factory:touch files=a\.ts ahead= -->/);
    assert.match(a.comment ?? "", /この Issue が先頭/);
  });
  it("go の着手の記録に、先に待っている同じファイルの Issue を ahead= で残し、parseTouch はこれまでどおり files を読む（#183）", () => {
    const a = precheckActions(issue(5), ["a.ts", "b.ts"], { decision: "go", ahead: [3, 4] });
    assert.match(a.comment ?? "", /^<!-- factory:touch files=a\.ts,b\.ts ahead=#3,#4 -->/);
    assert.deepEqual(parseTouch(a.comment ?? ""), ["a.ts", "b.ts"]);
  });
  it("skip ならラベルもコメントも変えない（#322）", () => {
    const a = precheckActions(issue(5), ["a.ts"], { decision: "skip", reason: "r" });
    assert.deepEqual(a, { removeLabels: [], addLabels: [], comment: null });
  });
  it("queue ならラベルを変えず、待ち先が前と同じならコメントもしない", () => {
    const d = { decision: "queue" as const, wait: 3 as const, files: ["a.ts"], reason: "r", comment: "c" };
    assert.equal(precheckActions(issue(5), ["a.ts"], d).comment, "c");
    const waited = issue(5, [queued("wait=#3 files=a.ts", "2026-01-01T00:00:00Z")]);
    assert.equal(precheckActions(waited, ["a.ts"], d).comment, null);
  });
  it("付け直しは、時間がたち・着手のコメントも PR も無いものを、残りの回数まで。2 回目は人に回す", () => {
    const base = { label: "status:in-progress", hasPr: false };
    const r = relabelTargets({
      now: "2026-11-12T12:00:00Z",
      minMinutes: 15,
      remaining: 1,
      issues: [
        { ...base, number: 1, labeledAt: "2026-11-12T11:30:00Z", comments: [] },
        { ...base, number: 2, labeledAt: "2026-11-12T11:31:00Z", comments: [] },
        { ...base, number: 3, labeledAt: "2026-11-12T11:55:00Z", comments: [] },
        { ...base, number: 4, labeledAt: "2026-11-12T11:00:00Z", comments: [{ body: "<!-- factory:implement action=start -->", createdAt: "2026-11-12T11:01:00Z" }] },
        { ...base, number: 5, labeledAt: "2026-11-12T11:00:00Z", comments: [{ body: "<!-- factory:patrol action=relabel-start -->", createdAt: "2026-11-12T11:20:00Z" }] },
      ],
    });
    assert.deepEqual(r.relabel, [{ issue: 1, label: "status:in-progress" }]);
    assert.deepEqual(r.needsHuman, [5]);
  });
});

describe("merge:requested を付けてよいか（mergeCheck。#293）", () => {
  const ok = (c: string, association = "OWNER") => ({ body: `<!-- factory:review verdict=ok round=1 commit=${c} -->\n本文`, association });
  const ng = (c: string) => ({ body: `<!-- factory:review verdict=changes round=1 commit=${c} -->\n本文`, association: "OWNER" });
  it("レビューが無い・最新が changes なら付けない", () => {
    assert.equal(mergeCheck({ reviews: [], headSha: "aaa", after: [] }).ok, false);
    assert.equal(mergeCheck({ reviews: [ok("aaa"), ng("bbb")], headSha: "bbb", after: [] }).ok, false);
  });
  it("最新のコミットが ok を受けていれば付けてよい", () => {
    assert.equal(mergeCheck({ reviews: [ng("aaa"), ok("bbbbbbb")], headSha: "bbbbbbb1234", after: [] }).ok, true);
  });
  it("同じ版に changes と ok の両方があれば付けない（後の ok が先の指摘を打ち消さない）", () => {
    assert.equal(mergeCheck({ reviews: [ng("aaa"), ok("aaa")], headSha: "aaa", after: [] }).ok, false);
  });
  it("レビューのコミットが PR の履歴に無ければ付けない", () => {
    assert.equal(mergeCheck({ reviews: [ok("aaa")], headSha: "bbb", after: null }).ok, false);
  });
  it("書き込み権限の無い人のレビューの印は信じない", () => {
    assert.equal(mergeCheck({ reviews: [ng("aaa"), ok("aaa", "NONE")], headSha: "aaa", after: [] }).ok, false);
    assert.equal(mergeCheck({ reviews: [ok("aaa", "CONTRIBUTOR")], headSha: "aaa", after: [] }).ok, false);
    assert.equal(mergeCheck({ reviews: [ok("aaa", "COLLABORATOR")], headSha: "aaa", after: [] }).ok, true);
  });
  it("ok の後が取り込みだけなら付けてよく、中身の変わるコミットがあれば付けない", () => {
    assert.equal(mergeCheck({ reviews: [ok("aaa")], headSha: "ccc", after: [{ sha: "ccc", mergeOnly: true }] }).ok, true);
    const r = mergeCheck({ reviews: [ok("aaa")], headSha: "ddd", after: [{ sha: "ccc", mergeOnly: true }, { sha: "ddd1234", mergeOnly: false }] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ddd1234/);
  });
});

describe("ラベルの名前（接頭を付けた名前への切り替え）", () => {
  it("旧名を今の名前に直し、それ以外の名前はそのまま返す", () => {
    assert.equal(normalizeLabel("in-progress"), "status:in-progress");
    assert.equal(normalizeLabel("in-progress:hard"), "status:in-progress-hard");
    assert.equal(normalizeLabel("status:in-progress"), "status:in-progress");
    assert.equal(normalizeLabel("risk:high"), "risk:high");
  });

  it("旧名で付けられた起動のラベルも、起動のきっかけとして数える", () => {
    assert.ok(START_LABELS.includes(normalizeLabel("in-progress")));
    assert.ok(START_LABELS.includes(normalizeLabel("in-progress:hard")));
    assert.ok(!START_LABELS.includes(normalizeLabel("ready")));
  });
});

describe("キューに入る条件のチェック（ciCheck。#364）", () => {
  const run = (name: string, conclusion: string | null, startedAt = "2026-11-12T18:00:00Z", status = "completed") => ({ name, status, conclusion, startedAt });

  const ds = run("design-system-check", "success");

  it("app-check・design-system-check・pr-body-check がすべて success なら ok", () => {
    assert.equal(ciCheck([run("app-check", "success"), ds, run("pr-body-check", "success"), run("Summary", "failure")]).ok, true);
  });

  it("app-check が落ちていれば ok にしない（#364 の形）", () => {
    const r = ciCheck([run("app-check", "failure"), ds, run("pr-body-check", "success")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /app-check が failure/);
  });

  it("design-system-check が落ちている・無いときは ok にしない（.mergify.yml のキューの条件と同じ）", () => {
    const r = ciCheck([run("app-check", "success"), run("design-system-check", "failure"), run("pr-body-check", "success")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /design-system-check が failure/);
    assert.match(ciCheck([run("app-check", "success"), run("pr-body-check", "success")]).reason, /design-system-check が無い/);
  });

  it("本文の検査が skipped のまま残っていれば ok にしない（#258 の形）", () => {
    assert.equal(ciCheck([run("app-check", "success"), ds, run("pr-body-check", "skipped")]).ok, false);
  });

  it("まだ終わっていない・まだ無いチェックがあれば ok にしない", () => {
    assert.equal(ciCheck([run("app-check", null, "2026-11-12T18:00:00Z", "in_progress"), ds, run("pr-body-check", "success")]).ok, false);
    assert.equal(ciCheck([run("app-check", "success"), ds]).ok, false);
  });

  it("同じ名前のチェックが何度も動いたときは、最後に始まったものを見る", () => {
    const old = run("pr-body-check", "failure", "2026-11-12T17:00:00Z");
    const now = run("pr-body-check", "success", "2026-11-12T18:00:00Z");
    assert.equal(ciCheck([run("app-check", "success"), ds, now, old]).ok, true);
    assert.equal(ciCheck([run("app-check", "success"), ds, old, run("pr-body-check", "failure", "2026-11-12T19:00:00Z")]).ok, false);
  });
});

describe("巡回の CI の状態（combineChecks。app-check と design-system-check をまとめる）", () => {
  it("どちらかが落ちていれば failure（design-system-check だけが落ちた PR を「CI が通った」と扱わない）", () => {
    assert.equal(combineChecks(["success", "failure"]), "failure");
    assert.equal(combineChecks(["failure", "pending"]), "failure");
  });

  it("落ちたものが無く、動いているものがあれば pending、まだ無いものがあれば none", () => {
    assert.equal(combineChecks(["success", "pending"]), "pending");
    assert.equal(combineChecks(["success", "none"]), "none");
  });

  it("すべて成功なら success", () => {
    assert.equal(combineChecks(["success", "success"]), "success");
  });
});

describe("main の CI を壊している不具合の直しを先に着手させる（#363）", () => {
  const pr355 = { number: 355, headRef: "claude/issue-354", files: ["src/lib/tasks.ts"], stalled: false };
  const fix = { ...issue(362, [queued("wait=#355 files=src/lib/tasks.ts", "2026-11-12T18:28:00Z")]), labels: ["status:ready", "type:fix"] };
  const feat = { ...issue(361, [queued("wait=#355 files=src/lib/tasks.ts", "2026-11-12T18:00:00Z")]), labels: ["status:ready", "type:feat"] };

  it("precheck: main の CI が壊れていて type:fix なら、同じファイルの PR を待たずに go", () => {
    const d = precheck({ self: fix, files: ["src/lib/tasks.ts"], inProgress: [], queued: [], openPrs: [pr355], isOpen: () => false, mainBroken: true });
    assert.equal(d.decision, "go");
  });

  it("precheck: main の CI が壊れていなければ、type:fix でもふだんどおり待つ", () => {
    const d = precheck({ self: fix, files: ["src/lib/tasks.ts"], inProgress: [], queued: [], openPrs: [pr355], isOpen: () => false, mainBroken: false });
    assert.equal(waitOf(d), 355);
  });

  it("precheck: type:fix でなければ、main の CI が壊れていても待つ", () => {
    const d = precheck({ self: feat, files: ["src/lib/tasks.ts"], inProgress: [], queued: [], openPrs: [pr355], isOpen: () => false, mainBroken: true });
    assert.equal(waitOf(d), 355);
  });

  it("precheck: 同時に実装する数の上限は、直しでも守る", () => {
    const four = [1, 2, 3, 4].map((n) => issue(n));
    const d = precheck({ self: fix, files: ["src/lib/tasks.ts"], inProgress: four, queued: [], openPrs: [], isOpen: () => false, mainBroken: true });
    assert.equal(waitOf(d), "slot");
  });

  it("pick: 先に待っている Issue より先に、同じファイルの PR を越えて取り出す", () => {
    const r = pick({ queued: [feat, fix], inProgressCount: 3, isOpen: () => false, openPrs: [pr355], mainBroken: true });
    assert.deepEqual(r.pick, [362]);
  });

  it("#362 の形: 同じファイル待ち（wait=#355）の記録があり、#355 が開いていても、precheck は go・pick は取り出す", () => {
    const isOpen = (n: number) => n === 355;
    const d = precheck({ self: fix, files: ["src/lib/tasks.ts"], inProgress: [], queued: [feat, fix], openPrs: [pr355], isOpen, mainBroken: true });
    assert.equal(d.decision, "go");
    assert.deepEqual(d.decision === "go" ? d.ahead : null, [361]); // 先に待っていた #361 を越えたことを記録に残す（#183）
    assert.deepEqual(pick({ queued: [feat, fix], inProgressCount: 3, isOpen, openPrs: [pr355], mainBroken: true }).pick, [362]);
  });

  it("急ぎの直しでも、人が決めた依存（blocked by）が開いていれば待つ", () => {
    const blocked = { ...fix, blockedBy: [300] };
    const isOpen = (n: number) => n === 300 || n === 355;
    assert.equal(waitOf(precheck({ self: blocked, files: ["src/lib/tasks.ts"], inProgress: [], queued: [], openPrs: [pr355], isOpen, mainBroken: true })), 300);
    assert.deepEqual(pick({ queued: [blocked], inProgressCount: 0, isOpen, openPrs: [pr355], mainBroken: true }).pick, []);
  });

  it("pick: main の CI が壊れていなければ、ふだんどおり（同じファイルの PR を待つ）", () => {
    assert.deepEqual(pick({ queued: [feat, fix], inProgressCount: 3, isOpen: () => false, openPrs: [pr355], mainBroken: false }).pick, []);
  });
});

describe("レビューを通ったことを表す status（reviewStatus・自動でキューに入れる）", () => {
  const ok = (commit: string) => ({ body: `<!-- factory:review verdict=ok round=1 commit=${commit} -->`, association: "COLLABORATOR" });
  const changes = (commit: string) => ({ body: `<!-- factory:review verdict=changes round=1 commit=${commit} -->`, association: "COLLABORATOR" });
  it("最新のコミットが ok のレビューを受けていれば success", () => {
    const mc = mergeCheck({ reviews: [ok("aaaa111")], headSha: "aaaa1112222", after: [] });
    assert.equal(reviewStatus(mc, "aaaa1112222", []).state, "success");
  });
  it("ok の後が取り込みだけのコミットなら success を引き継ぐ（キューが main を取り込んだ後も入れるように）", () => {
    const mc = mergeCheck({ reviews: [ok("aaaa111")], headSha: "bbbb222", after: [{ sha: "bbbb222", mergeOnly: true }] });
    assert.equal(reviewStatus(mc, "bbbb222", []).state, "success");
  });
  it("ok の後に中身の変わるコミットがあれば付けない（レビューし直すまで入らない）", () => {
    const mc = mergeCheck({ reviews: [ok("aaaa111")], headSha: "bbbb222", after: [{ sha: "bbbb222", mergeOnly: false }] });
    assert.equal(reviewStatus(mc, "bbbb222", []).state, null);
  });
  it("最新のコミットへのレビューが changes なら failure", () => {
    const mc = mergeCheck({ reviews: [ok("aaaa111"), changes("bbbb222")], headSha: "bbbb222", after: [] });
    assert.equal(reviewStatus(mc, "bbbb222", []).state, "failure");
  });
  it("書き込み権限の無い人の ok の印では success にしない（なりすまし）", () => {
    const mc = mergeCheck({ reviews: [{ ...ok("aaaa111"), association: "NONE" }], headSha: "aaaa111", after: [] });
    assert.equal(reviewStatus(mc, "aaaa111", []).state, null);
  });
  it("品質のゲート（CI・Mergify・手順書・判定のスクリプト・規約・Ruleset・package.json などの CI の動きを決めるファイル）を変える PR には、ok でも success を付けない", () => {
    const mc = mergeCheck({ reviews: [ok("aaaa111")], headSha: "aaaa111", after: [] });
    for (const f of [".mergify.yml", ".github/workflows/ci.yml", ".claude/routines/review.md", "scripts/factory/claim.ts", "scripts/check-skills.py", "AGENTS.md", "CLAUDE.md", "docs/rulesets/main.json", "package.json", "package-lock.json", "tsconfig.json", "tests/factory-claim.test.ts"]) {
      assert.equal(reviewStatus(mc, "aaaa111", [], ["src/app/page.tsx", f]).state, null, f);
    }
    assert.equal(reviewStatus(mc, "aaaa111", [], ["src/app/page.tsx", "docs/product.md", "tests/a.test.ts"]).state, "success");
  });
  it("risk:high の PR には、ok でも success を付けない（人が merge:requested を付ける）", () => {
    const mc = mergeCheck({ reviews: [ok("aaaa111")], headSha: "aaaa111", after: [] });
    assert.equal(reviewStatus(mc, "aaaa111", ["risk:high"]).state, null);
  });
});

describe("stalled: 止まった実装・PR の片付け", () => {
  const NOW = "2026-11-13T12:00:00.000Z";
  const ago = (min: number) => new Date(new Date(NOW).getTime() - min * 60000).toISOString();
  const HEAD = "aaaaaaa1111111";
  const pr = (o: Partial<StalledPr> = {}): StalledPr => ({
    number: 10, headRef: "claude/issue-5", headSha: HEAD, draft: true, mergeable: true, labels: [], updatedAt: ago(0), readyAt: null,
    appCheck: "none", bodyCheck: "success", reviews: [], after: {}, priorMarks: [], mergifyTimeout: null, ...o,
  });
  const iss = (o: Partial<StalledIssue> = {}): StalledIssue => ({ number: 5, labels: ["status:in-progress"], updatedAt: ago(0), ...o });
  const run = (prs: StalledPr[], issues: StalledIssue[] = [iss()], closedStarted: { number: number; labels: string[] }[] = [], sessionUrl: string | null = "https://claude.ai/code/session_X") =>
    stalledActions({ role: "dispatch", now: NOW, sessionUrl, prs, issues, closedStarted });
  const only = (r: ReturnType<typeof run>) => {
    assert.equal(r.actions.length, 1, JSON.stringify(r.actions));
    return r.actions[0];
  };

  it("1: Ready で衝突している PR は draft に戻す（claude/issue- 以外でも）", () => {
    const a = only(run([pr({ draft: false, mergeable: false, readyAt: ago(1) })]));
    assert.equal(a.action, "conflict");
    assert.equal(a.target, "pr");
    assert.equal(a.draft, "to-draft");
    assert.match(a.comment!, /^<!-- factory:dispatch action=conflict commit=aaaaaaa -->\n.*\nセッション: https:\/\/claude\.ai\/code\/session_X$/s);
    assert.equal(only(run([pr({ number: 11, headRef: "claude/other", draft: false, mergeable: false })], [])).action, "conflict");
  });

  it("2: 衝突した draft は 30 分たつまで待ち、たったら修正の役を起こし直す", () => {
    assert.equal(run([pr({ mergeable: false, updatedAt: ago(29) })], [iss({ updatedAt: ago(29) })]).actions.length, 0);
    assert.equal(only(run([pr({ mergeable: false, updatedAt: ago(31) })], [iss({ updatedAt: ago(31) })])).draft, "ready-then-draft");
    // 最後の動きは、PR と Issue の新しいほう
    assert.equal(run([pr({ mergeable: false, updatedAt: ago(31) })], [iss({ updatedAt: ago(5) })]).actions.length, 0);
    // claude/issue- 以外の draft は触らない
    assert.equal(run([pr({ headRef: "claude/other", mergeable: false, updatedAt: ago(99) })], []).actions.length, 0);
  });

  it("mergeable が null の PR は unknown に入れ、ほかの行は判定しない", () => {
    const r = run([pr({ mergeable: null, appCheck: "success", updatedAt: ago(99) })]);
    assert.deepEqual(r.actions, []);
    assert.deepEqual(r.unknown, [{ pr: 10, reason: "mergeable が null" }]);
  });

  it("3: Ready でレビューが無いまま 10 分たったら起こし直す（commit 付き）。9 分なら待つ", () => {
    const base = { draft: false, readyAt: ago(11) };
    const a = only(run([pr(base)], []));
    assert.equal(a.action, "rereview");
    assert.equal(a.draft, "draft-then-ready");
    assert.match(a.comment!, /^<!-- factory:dispatch action=rereview commit=aaaaaaa -->/);
    assert.equal(run([pr({ ...base, readyAt: ago(9) })], []).actions.length, 0);
    // 最新のコミットにレビューがあれば対象外
    assert.equal(run([pr({ ...base, reviews: [{ verdict: "ok", commit: "aaaaaaa" }] })], []).actions.length, 0);
    // 古い ok の後が取り込みだけなら対象外。中身の変わるコミットがあれば対象
    const old = { reviews: [{ verdict: "ok", commit: "bbbbbbb" }] };
    assert.equal(run([pr({ ...base, ...old, after: { bbbbbbb: [{ sha: "c1", mergeOnly: true }] } })], []).actions.length, 0);
    assert.equal(only(run([pr({ ...base, ...old, after: { bbbbbbb: [{ sha: "c1", mergeOnly: false }] } })], [])).action, "rereview");
  });

  it("3: 同じコミットへの 2 回目は、人に回す", () => {
    const a = only(run([pr({ draft: false, readyAt: ago(30), priorMarks: [{ action: "rereview", commit: "aaaaaaa" }] })], []));
    assert.equal(a.action, "rereview");
    assert.equal(a.draft, null);
    assert.deepEqual(a.addLabels, ["status:needs-human"]);
    // 別のコミットへの起こし直しは数えない
    assert.equal(only(run([pr({ draft: false, readyAt: ago(30), priorMarks: [{ action: "rereview", commit: "ccccccc" }] })], [])).draft, "draft-then-ready");
  });

  it("4: 最新のレビューが changes で、そのコミットが最新のまま 30 分動かなければ人に回す", () => {
    const rv = { reviews: [{ verdict: "changes", commit: "aaaaaaa" }] };
    const a = only(run([pr({ ...rv, updatedAt: ago(31) })], [iss({ updatedAt: ago(31), labels: [] })]));
    assert.equal(a.action, "changes-stuck");
    assert.deepEqual(a.addLabels, ["status:needs-human"]);
    assert.equal(run([pr({ ...rv, updatedAt: ago(20) })], [iss({ updatedAt: ago(20), labels: [] })]).actions.length, 0);
    // 直したコミットが増えていれば対象外
    assert.equal(run([pr({ reviews: [{ verdict: "changes", commit: "ddddddd" }], updatedAt: ago(31) })], [iss({ updatedAt: ago(31), labels: [] })]).actions.length, 0);
  });

  it("5: CI が通った draft が 15 分動かなければ Ready にし、Issue の起動のラベルを外す", () => {
    const p = pr({ appCheck: "success", updatedAt: ago(16) });
    const a = only(run([p], [iss({ updatedAt: ago(16), labels: ["status:in-progress-hard"] })]));
    assert.equal(a.action, "ready-stalled");
    assert.equal(a.draft, "to-ready");
    assert.deepEqual(a.issue, { number: 5, removeLabels: ["status:in-progress-hard"], addLabels: [] });
    assert.equal(run([pr({ appCheck: "success", updatedAt: ago(14) })], [iss({ updatedAt: ago(14) })]).actions.length, 0);
    // 最新のレビューの後が取り込みだけなら Ready にしない。中身の変わるコミットがあれば Ready にする
    const rv = { reviews: [{ verdict: "changes", commit: "bbbbbbb" }], updatedAt: ago(16) };
    assert.equal(run([pr({ appCheck: "success", ...rv, after: { bbbbbbb: [{ sha: "c", mergeOnly: true }] } })], [iss({ updatedAt: ago(16), labels: [] })]).actions.length, 0);
    assert.equal(only(run([pr({ appCheck: "success", ...rv, after: { bbbbbbb: [{ sha: "c", mergeOnly: false }] } })], [iss({ updatedAt: ago(16), labels: [] })])).action, "ready-stalled");
  });

  it("6: 作業中で CI が落ちた draft が 30 分動かなければ、Issue を人に回す", () => {
    const a = only(run([pr({ appCheck: "failure", updatedAt: ago(31) })], [iss({ updatedAt: ago(31) })]));
    assert.equal(a.target, "issue");
    assert.equal(a.number, 5);
    assert.equal(a.action, "stalled");
    assert.deepEqual(a.removeLabels, ["status:in-progress"]);
    assert.deepEqual(a.addLabels, ["status:needs-human"]);
    assert.match(a.comment!, /CI が落ちたまま 30 分/);
    assert.equal(run([pr({ appCheck: "failure", updatedAt: ago(29) })], [iss({ updatedAt: ago(29) })]).actions.length, 0);
  });

  it("7: 作業中で PR が無い・draft のまま 60 分動かなければ、Issue を人に回す", () => {
    const a = only(run([], [iss({ updatedAt: ago(61), labels: ["status:in-progress-hard"] })]));
    assert.equal(a.action, "stalled");
    assert.deepEqual(a.removeLabels, ["status:in-progress-hard"]);
    assert.match(a.comment!, /60 分動きが無い/);
    assert.equal(run([], [iss({ updatedAt: ago(59) })]).actions.length, 0);
    assert.equal(only(run([pr({ appCheck: "pending", updatedAt: ago(61) })], [iss({ updatedAt: ago(61) })])).comment!.includes("60 分"), true);
    // Ready の PR がある Issue は、ここでは扱わない
    assert.equal(run([pr({ draft: false, readyAt: ago(1), updatedAt: ago(99) })], [iss({ updatedAt: ago(99) })]).actions.length, 0);
  });

  it("8: 起動のラベルが無く、CI が通らない draft が 60 分動かなければ PR を人に回す", () => {
    for (const appCheck of ["failure", "pending", "none"] as const) {
      const a = only(run([pr({ appCheck, updatedAt: ago(61) })], [iss({ updatedAt: ago(61), labels: [] })]));
      assert.equal(a.action, "stalled-ci");
      assert.equal(a.target, "pr");
      assert.deepEqual(a.addLabels, ["status:needs-human"]);
    }
    assert.equal(run([pr({ appCheck: "failure", updatedAt: ago(59) })], [iss({ updatedAt: ago(59), labels: [] })]).actions.length, 0);
  });

  describe("9: Mergify の時間切れ", () => {
    const base = (o: Partial<StalledPr> = {}) =>
      pr({ draft: false, readyAt: ago(60), labels: ["merge:requested", "merge:dequeued"], appCheck: "success", reviews: [{ verdict: "ok", commit: "aaaaaaa" }], mergifyTimeout: { at: ago(6) }, ...o });
    it("条件がそろえば人に回す。旧名 dequeued も同じ", () => {
      const a = only(run([base()], []));
      assert.equal(a.action, "checks-timeout");
      assert.deepEqual(a.addLabels, ["status:needs-human"]);
      assert.equal(only(run([base({ labels: ["merge:requested", "dequeued"] })], [])).action, "checks-timeout");
      // レビューの status で自動で入った PR（merge:requested が無い）も同じ
      assert.equal(only(run([base({ labels: ["merge:dequeued"] })], [])).action, "checks-timeout");
    });
    it("5 分たたない・CI が成功でない・ok が最新でない・ラベルが足りないときは何もしない", () => {
      assert.equal(run([base({ mergifyTimeout: { at: ago(4) } })], []).actions.length, 0);
      assert.equal(run([base({ appCheck: "failure" })], []).actions.length, 0);
      assert.equal(run([base({ bodyCheck: "failure" })], []).actions.length, 0);
      assert.equal(run([base({ bodyCheck: "pending" })], []).actions.length, 0);
      assert.equal(run([base({ mergifyTimeout: null })], []).actions.length, 0);
      assert.equal(run([base({ labels: ["merge:requested"] })], []).actions.length, 0);
      const stale = { reviews: [{ verdict: "ok", commit: "bbbbbbb" }], after: { bbbbbbb: [{ sha: "c", mergeOnly: false }] } };
      assert.equal(run([base({ ...stale, readyAt: ago(5) })], []).actions.some((x) => x.action === "checks-timeout"), false);
      // 後が取り込みだけなら ok のまま
      assert.equal(only(run([base({ reviews: [{ verdict: "ok", commit: "bbbbbbb" }], after: { bbbbbbb: [{ sha: "c", mergeOnly: true }] } })], [])).action, "checks-timeout");
    });
  });

  it("10: 閉じた Issue に残った起動のラベルを外す（コメントなし）", () => {
    const r = run([], [], [{ number: 7, labels: ["status:in-progress", "type:fix"] }, { number: 8, labels: ["type:fix"] }]);
    const a = only(r);
    assert.deepEqual({ target: a.target, number: a.number, action: a.action, comment: a.comment }, { target: "issue", number: 7, action: "cleanup", comment: null });
    assert.deepEqual(a.removeLabels, ["status:in-progress"]);
  });

  it("1 つの PR には、最初に当たった処置だけを出す", () => {
    // 衝突（行 2）・CI 成功（行 5）・60 分動かない（行 7）のすべてに当たる draft は、行 2 だけ
    const r = run([pr({ mergeable: false, appCheck: "success", updatedAt: ago(99) })], [iss({ updatedAt: ago(99) })]);
    assert.deepEqual(r.actions.map((a) => a.action), ["conflict-kick"]);
  });

  it("人を待っているものは対象にしない", () => {
    const stuck = pr({ draft: false, mergeable: false });
    assert.equal(run([{ ...stuck, labels: ["status:needs-human"] }], []).actions.length, 0);
    for (const label of ["status:blocked-question", "status:needs-human", "kind:epic"]) {
      assert.equal(run([stuck], [iss({ labels: [label, "status:in-progress"], updatedAt: ago(99) })]).actions.length, 0, label);
    }
    assert.equal(run([], [iss({ labels: ["status:in-progress", "status:needs-human"], updatedAt: ago(99) })]).actions.length, 0);
  });

  it("claude/issue- 以外の PR は、衝突とレビューの起こし直しの行だけ", () => {
    const other = pr({ headRef: "claude/hand-made", draft: true, readyAt: null, updatedAt: ago(99), appCheck: "success", mergeable: true });
    assert.equal(run([other], []).actions.length, 0); // CI が通ったまま止まった draft でも、Ready にしない（出したセッションが扱う）
    assert.equal(only(run([{ ...other, draft: false, mergeable: false }], [])).action, "conflict");
  });

  it("入力の読み込み: claude/issue- 以外の PR でも、レビューと（Ready なら）Ready の時刻を読む。mergeable が null でも読む", () => {
    for (const mergeable of [true, false, null]) {
      const other = stalledLoadPlan({ own: false, mergeable, draft: false });
      assert.equal(other.reviews, true, String(mergeable));
      assert.equal(other.readyAt, true, String(mergeable));
      assert.equal(other.checks, false, String(mergeable)); // CI などは claude/issue- の PR のほかの行だけが使う
    }
    assert.equal(stalledLoadPlan({ own: false, mergeable: true, draft: true }).readyAt, false);
    assert.deepEqual(stalledLoadPlan({ own: true, mergeable: true, draft: false }), { reviews: true, readyAt: true, checks: true });
    assert.equal(stalledLoadPlan({ own: true, mergeable: null, draft: false }).checks, false);
  });

  it("claude/issue- 以外の PR（claude/ci- など）も、Ready のまま 10 分レビューが無ければ起こし直し、同じコミットで 2 回目は人に回す（#482・#518）", () => {
    const ci = pr({ headRef: "claude/ci-flaky", draft: false, readyAt: ago(12), updatedAt: ago(12), appCheck: "success", mergeable: true });
    for (const role of ["dispatch", "patrol"] as const) {
      const first = stalledActions({ role, now: NOW, sessionUrl: null, prs: [ci], issues: [], closedStarted: [] }).actions;
      assert.equal(first.length, 1, role);
      assert.equal(first[0].action, "rereview", role);
      assert.equal(first[0].draft, "draft-then-ready", role);
      const second = stalledActions({ role, now: NOW, sessionUrl: null, prs: [{ ...ci, priorMarks: [{ action: "rereview", commit: "aaaaaaa" }] }], issues: [], closedStarted: [] }).actions;
      assert.equal(second[0].draft, null, role);
      assert.deepEqual(second[0].addLabels, ["status:needs-human"], role);
    }
    // 10 分たっていなければ起こさない
    assert.equal(run([{ ...ci, readyAt: ago(5) }], []).actions.length, 0);
  });

  it("コメントの印は役の名前になり、セッションが無ければ行を省く", () => {
    const r = stalledActions({ role: "patrol", now: NOW, sessionUrl: null, prs: [pr({ draft: false, mergeable: false })], issues: [], closedStarted: [] });
    assert.equal(r.actions[0].comment, "<!-- factory:patrol action=conflict commit=aaaaaaa -->\n`main` と衝突しているので draft に戻した。衝突を直して Ready に戻す。");
  });

  it("巡回は claude/issue- 以外の PR を扱わず、割り当てだけが衝突を知らせる", () => {
    const foo = pr({ headRef: "claude/foo", draft: false, mergeable: false, readyAt: ago(1) });
    const patrol = stalledActions({ role: "patrol", now: NOW, sessionUrl: null, prs: [foo], issues: [], closedStarted: [] });
    assert.deepEqual(patrol.actions, []);
    assert.deepEqual(patrol.unknown, []);
    assert.equal(only(run([foo], [])).action, "conflict");
  });

  describe("同じコミットに同じ処置は 1 回まで", () => {
    const kick = { mergeable: false, updatedAt: ago(40) };
    const kickIssue = [iss({ updatedAt: ago(40) })];
    it("初回の印には commit が付く", () => {
      assert.match(only(run([pr(kick)], kickIssue)).comment!, /^<!-- factory:dispatch action=conflict-kick commit=aaaaaaa -->/);
      assert.match(only(run([pr({ draft: false, mergeable: false })], [])).comment!, /action=conflict commit=aaaaaaa -->/);
      assert.match(only(run([pr({ appCheck: "success", updatedAt: ago(20) })], [iss({ updatedAt: ago(20) })])).comment!, /action=ready-stalled commit=aaaaaaa -->/);
    });
    it("同じコミットへの 2 回目は、draft を切り替えずに人に回す", () => {
      for (const [action, p, is] of [
        ["conflict-kick", pr({ ...kick, priorMarks: [{ action: "conflict-kick", commit: "aaaaaaa" }] }), kickIssue],
        ["conflict", pr({ draft: false, mergeable: false, priorMarks: [{ action: "conflict", commit: "aaaaaaa" }] }), []],
        ["ready-stalled", pr({ appCheck: "success", updatedAt: ago(20), priorMarks: [{ action: "ready-stalled", commit: "aaaaaaa" }] }), [iss({ updatedAt: ago(20) })]],
      ] as const) {
        const a = only(run([p], [...is]));
        assert.equal(a.action, action);
        assert.equal(a.draft, null);
        assert.equal(a.issue, null);
        assert.deepEqual(a.addLabels, ["status:needs-human"]);
        assert.match(a.comment!, new RegExp(`^<!-- factory:dispatch action=${action}-repeat commit=aaaaaaa -->\\n同じ処置（${action}）を同じコミットに 2 回しても動かないので、人に回す。\\nセッション: `));
      }
    });
    it("別のコミット・別の処置の記録は数えない", () => {
      assert.equal(only(run([pr({ ...kick, priorMarks: [{ action: "conflict-kick", commit: "ccccccc" }] })], kickIssue)).draft, "ready-then-draft");
      assert.equal(only(run([pr({ ...kick, priorMarks: [{ action: "conflict", commit: "aaaaaaa" }] })], kickIssue)).draft, "ready-then-draft");
    });
  });
});

describe("gate: 各役の起動の判定", () => {
  const REPO = "namu112358/poc-software-factory-20261112";
  const T0 = "2026-11-13T10:00:00Z";
  const T1 = "2026-11-13T10:05:00Z";
  const startMark = { body: "<!-- factory:implement action=start -->\n着手します。", createdAt: T1 };
  type Impl = Extract<GateInput, { role: "implement" }>;
  const impl = (o: Partial<Impl> = {}): GateInput => ({
    role: "implement", number: 7, sessionUrl: "https://claude.ai/code/session_X", repo: REPO, issueOpen: true, labels: ["status:in-progress"],
    lastStartAt: T0, labeler: "alice", comments: [], closingPrs: [], branchExists: false, ...o,
  });

  describe("implement", () => {
    it("1: 閉じた Issue・起動のラベル無し・epic・人待ちは stop（何も書かない）", () => {
      for (const o of [{ issueOpen: false }, { labels: [] }, { labels: ["status:in-progress", "kind:epic"] }, { labels: ["status:in-progress-hard", "status:blocked-question"] }, { labels: ["status:in-progress", "status:needs-human"] }]) {
        const r = gateDecision(impl(o));
        assert.equal(r.decision, "stop", JSON.stringify(o));
        assert.equal(r.ops, null);
      }
    });
    it("起動のラベルを付けた人（labeler）を、どの判定でも出す。読めなければ null（権限は gate では確かめない。役が確かめる）", () => {
      assert.equal(gateDecision(impl()).labeler, "alice");
      assert.equal(gateDecision(impl({ labeler: null, lastStartAt: null })).labeler, null);
      assert.equal(gateDecision(impl({ labeler: null, lastStartAt: null })).decision, "lock");
      assert.equal(gateDecision(impl({ issueOpen: false })).labeler, "alice");
    });
    it("2: 最後の起動の後に着手のコメントがあれば stop。起動の前のものは数えない", () => {
      assert.equal(gateDecision(impl({ comments: [startMark] })).decision, "stop");
      assert.equal(gateDecision(impl({ comments: [{ ...startMark, createdAt: "2026-11-13T09:00:00Z" }] })).decision, "lock");
    });
    it("3: Closes で参照する開いている PR があれば stop。claude/issue-N の draft でレビュー前なら takeover", () => {
      const pr = (o = {}) => ({ number: 90, headRef: "claude/issue-7", headRepo: REPO, draft: true, reviewed: false, ...o });
      const t = gateDecision(impl({ closingPrs: [pr()] }));
      assert.equal(t.decision, "takeover");
      assert.equal(t.pr, 90);
      assert.equal(t.branch, "claude/issue-7");
      for (const o of [{ draft: false }, { reviewed: true }, { headRef: "claude/other" }]) assert.equal(gateDecision(impl({ closingPrs: [pr(o)] })).decision, "stop", JSON.stringify(o));
      // 着手のコメントがあれば、PR より先（3）に stop
      assert.equal(gateDecision(impl({ comments: [startMark], closingPrs: [pr()] })).decision, "stop");
    });
    it("4: PR が無くブランチだけがあれば takeover（pr は null）。読み直して着手のコメントが現れたら stop", () => {
      const r = gateDecision(impl({ branchExists: true }));
      assert.equal(r.decision, "takeover");
      assert.equal(r.pr, null);
      assert.equal(r.branch, "claude/issue-7");
      assert.equal(gateDecision(impl({ branchExists: true, comments: [startMark] })).decision, "stop");
    });
    it("5: どれでもなければ lock（ブランチ名を返す）", () => {
      const r = gateDecision(impl());
      assert.equal(r.decision, "lock");
      assert.equal(r.branch, "claude/issue-7");
      assert.equal(r.pr, null);
      assert.equal(r.ops, null);
    });
    it("最初に当たった 1 つだけ: 着手のコメントがあれば、ブランチや PR があっても stop", () => {
      const r = gateDecision(impl({ comments: [startMark], branchExists: true, closingPrs: [{ number: 90, headRef: "claude/issue-7", headRepo: REPO, draft: true, reviewed: false }] }));
      assert.equal(r.decision, "stop");
    });
    it("フォークの PR（head のリポジトリが違う・null）は引き継がず、着手も止めない（数えずに lock へ）", () => {
      for (const headRepo of ["someone/poc-software-factory-20261112", null]) {
        const r = gateDecision(impl({ closingPrs: [{ number: 90, headRef: "claude/issue-7", headRepo, draft: true, reviewed: false }] }));
        assert.equal(r.decision, "lock", String(headRepo));
        assert.equal(r.pr, null);
      }
    });
  });

  const HEAD = "aaaaaaa1111111";
  type Rev = Extract<GateInput, { role: "review" }>;
  type Fix = Extract<GateInput, { role: "fix" }>;
  const pr = (o = {}) => ({ open: true, draft: false, headRef: "claude/issue-7", headSha: HEAD, labels: [] as string[], headRepo: REPO as string | null, ...o });
  const review = (o: Partial<Rev> = {}): GateInput => ({ role: "review", number: 20, sessionUrl: null, repo: REPO, pr: pr(), reviews: [], afterOk: null, files: [], ...o });

  describe("review", () => {
    it("1: 閉じている・draft・claude/ 以外・needs-human は stop", () => {
      for (const p of [pr({ open: false }), pr({ draft: true }), pr({ headRef: "feature/x" }), pr({ labels: ["status:needs-human"] })]) assert.equal(gateDecision(review({ pr: p })).decision, "stop", JSON.stringify(p));
      assert.equal(gateDecision(review({ pr: pr({ headRef: "claude/hand-made" }) })).decision, "go"); // claude/issue- でなくてもレビューする
    });
    it("フォークの PR（head のリポジトリが違う・null）は stop", () => {
      for (const headRepo of ["someone/poc-software-factory-20261112", null]) assert.equal(gateDecision(review({ pr: pr({ headRepo }) })).decision, "stop", String(headRepo));
    });
    it("2: 最新のコミットへのレビューがもうあれば stop（ok でも changes でも）", () => {
      for (const verdict of ["ok", "changes"]) assert.equal(gateDecision(review({ reviews: [{ verdict, commit: "aaaaaaa" }] })).decision, "stop");
      assert.equal(gateDecision(review({ reviews: [{ verdict: "ok", commit: "bbbbbbb" }] })).decision, "go");
    });
    const rv = [{ verdict: "ok", commit: "bbbbbbb" }];
    it("3: ok の後が取り込みだけなら stop", () => {
      assert.equal(gateDecision(review({ reviews: rv, afterOk: [{ sha: "c1", mergeOnly: true, merge: true }, { sha: "c2", mergeOnly: true, merge: true }] })).decision, "stop");
    });
    it("4: ok の後がマージのコミットだけ（衝突の解消を含む）なら go で light", () => {
      const r = gateDecision(review({ reviews: rv, afterOk: [{ sha: "c1", mergeOnly: true, merge: true }, { sha: "c2", mergeOnly: false, merge: true }] }));
      assert.equal(r.decision, "go");
      assert.equal(r.light, true);
    });
    it("main 以外のブランチを取り込んだマージ（merge: false）が入ったら、軽い再レビューにしない", () => {
      const r = gateDecision(review({ reviews: rv, afterOk: [{ sha: "c1", mergeOnly: false, merge: false }] }));
      assert.equal(r.decision, "go");
      assert.equal(r.light, false);
    });
    it("5: それ以外は go で light ではない（機能の変更を含む・ok が無い・履歴に無い）", () => {
      for (const o of [{ reviews: rv, afterOk: [{ sha: "c1", mergeOnly: false, merge: true }, { sha: "c2", mergeOnly: false, merge: false }] }, { reviews: [] }, { reviews: rv, afterOk: null }, { reviews: [{ verdict: "changes", commit: "bbbbbbb" }] }]) {
        const r = gateDecision(review(o));
        assert.equal(r.decision, "go", JSON.stringify(o));
        assert.equal(r.light, false);
      }
    });
    it("go のときだけ、高リスクのファイルに当たった変更ファイルを riskFiles に出す", () => {
      const files = ["src/app/page.tsx", "src/lib/auth.ts", "src/lib/db/migrations.ts", "tests/auth.test.ts"];
      assert.deepEqual(gateDecision(review({ files })).riskFiles, ["src/lib/auth.ts", "src/lib/db/migrations.ts"]);
      assert.deepEqual(gateDecision(review({ files: ["src/app/page.tsx"] })).riskFiles, []);
      assert.equal(gateDecision(review({ files, pr: pr({ draft: true }) })).riskFiles, undefined);
    });
    it("最初に当たった 1 つだけ: draft なら、最新のレビューがあっても理由は draft", () => {
      assert.match(gateDecision(review({ pr: pr({ draft: true }), reviews: [{ verdict: "ok", commit: "aaaaaaa" }] })).reason, /draft/);
    });
  });

  const fix = (o: Partial<Fix> = {}): GateInput => ({
    role: "fix", number: 20, sessionUrl: "https://claude.ai/code/session_X", repo: REPO, pr: pr({ draft: true }), reviews: [{ verdict: "changes", commit: "aaaaaaa" }], mergeable: true, ...o,
  });
  describe("fix", () => {
    it("1: 閉じている・draft でない・claude/issue- 以外・needs-human は stop", () => {
      for (const p of [pr({ draft: true, open: false }), pr({ draft: false }), pr({ draft: true, headRef: "claude/hand-made" }), pr({ draft: true, labels: ["status:needs-human"] })]) {
        const r = gateDecision(fix({ pr: p, mergeable: false }));
        assert.equal(r.decision, "stop", JSON.stringify(p));
        assert.equal(r.fix, null);
      }
    });
    it("フォークの PR（head のリポジトリが違う・null）は、指摘や衝突があっても stop", () => {
      for (const headRepo of ["someone/poc-software-factory-20261112", null]) assert.equal(gateDecision(fix({ pr: pr({ draft: true, headRepo }), mergeable: false })).decision, "stop", String(headRepo));
    });
    it("2: 直すものが無ければ stop（指摘が古い版へのもの・指摘が無い）。衝突が無くても、指摘があれば go", () => {
      assert.equal(gateDecision(fix({ reviews: [{ verdict: "changes", commit: "ccccccc" }] })).decision, "stop");
      assert.equal(gateDecision(fix({ reviews: [{ verdict: "ok", commit: "aaaaaaa" }] })).decision, "stop");
      assert.equal(gateDecision(fix({ reviews: [] })).decision, "stop");
      const r = gateDecision(fix());
      assert.equal(r.decision, "go");
      assert.deepEqual(r.fix, { changes: true, conflict: false, removeMergeRequested: false });
    });
    it("衝突だけでも go（conflict: true）。merge:requested があれば外す印を出す", () => {
      const r = gateDecision(fix({ reviews: [], mergeable: false, pr: pr({ draft: true, labels: ["merge:requested"] }) }));
      assert.equal(r.decision, "go");
      assert.deepEqual(r.fix, { changes: false, conflict: true, removeMergeRequested: true });
    });
    it("3: verdict=changes のレビューが 3 つ以上なら needs-human（PR に status:needs-human とコメント）", () => {
      const three = [{ verdict: "changes", commit: "1111111" }, { verdict: "changes", commit: "2222222" }, { verdict: "changes", commit: "aaaaaaa" }];
      const r = gateDecision(fix({ reviews: three }));
      assert.equal(r.decision, "needs-human");
      assert.deepEqual(r.ops?.addLabels, ["status:needs-human"]);
      assert.match(r.ops!.comment!, /^<!-- factory:fix action=round-limit -->\n2 往復直しても指摘が残っているので、人に回す。\nセッション: /);
      // 2 つなら、まだ直す
      assert.equal(gateDecision(fix({ reviews: three.slice(1) })).decision, "go");
      // 直すものが無ければ（2）、3 つ以上でも stop が先
      assert.equal(gateDecision(fix({ reviews: [...three.slice(0, 2), { verdict: "changes", commit: "3333333" }] })).decision, "stop");
    });
  });

  describe("mergeable が null（計算中）のとき（settleMergeable）", () => {
    const reader = (values: (boolean | null)[]) => {
      const calls = { reads: 0, waits: 0 };
      return { calls, read: async () => values[calls.reads++] ?? null, wait: async () => void calls.waits++ };
    };
    it("null を 3 回読んだら衝突（false）として扱う。間に待つのは 2 回", async () => {
      const r = reader([null, null, null]);
      assert.equal(await settleMergeable(r.read, r.wait), false);
      assert.deepEqual(r.calls, { reads: 3, waits: 2 });
    });
    it("途中で値が出たらそこで止める", async () => {
      const r = reader([null, true]);
      assert.equal(await settleMergeable(r.read, r.wait), true);
      assert.deepEqual(r.calls, { reads: 2, waits: 1 });
      const f = reader([false]);
      assert.equal(await settleMergeable(f.read, f.wait), false);
      assert.deepEqual(f.calls, { reads: 1, waits: 0 });
    });
    it("衝突として扱った PR は、指摘が無くても修正の対象（go）", async () => {
      const r = reader([null, null, null]);
      const mergeable = await settleMergeable(r.read, r.wait);
      assert.equal(gateDecision(fix({ reviews: [], mergeable })).decision, "go");
    });
  });
});

describe("CI の待ち（ciWaitStep）", () => {
  const start: CiWaitState = { sha: null, deadlineMs: 900_000, failures: 0 };
  const at: CiWaitState = { sha: "aaa", deadlineMs: 900_000, failures: 0 };
  const read = (o: Partial<CiWaitRead> = {}): CiWaitRead => ({ ok: true, sha: "aaa", appCheck: null, mergeable: true, ...o });
  const done = (r: ReturnType<typeof ciWaitStep>) => (r.done ? { result: r.result, conclusion: r.conclusion } : null);

  it("app-check がまだ無い・実行中なら、待ち始めの head を覚えて続ける", () => {
    const r = ciWaitStep(start, read({ appCheck: { status: "in_progress", conclusion: null } }), 30_000);
    assert.deepEqual(r, { done: false, state: { sha: "aaa", deadlineMs: 900_000, failures: 0 } });
    assert.equal(ciWaitStep(at, read(), 30_000).done, false);
  });
  it("app-check が success なら success、それ以外の conclusion はすべて failure（conclusion も返す）", () => {
    assert.deepEqual(done(ciWaitStep(at, read({ appCheck: { status: "completed", conclusion: "success" } }), 1)), { result: "success", conclusion: "success" });
    for (const c of ["failure", "cancelled", "timed_out", "skipped", null])
      assert.deepEqual(done(ciWaitStep(at, read({ appCheck: { status: "completed", conclusion: c } }), 1)), { result: "failure", conclusion: c });
  });
  it("mergeable が false なら conflict。null は計算中なので待つ", () => {
    assert.deepEqual(done(ciWaitStep(at, read({ mergeable: false }), 1)), { result: "conflict", conclusion: null });
    assert.equal(ciWaitStep(at, read({ mergeable: null }), 1).done, false);
  });
  it("終わった CI は、衝突していても先に結果を返す（閉じた PR の mergeable に左右されない）", () => {
    assert.equal(done(ciWaitStep(at, read({ mergeable: false, appCheck: { status: "completed", conclusion: "success" } }), 1))?.result, "success");
  });
  it("head が待ち始めと変わったら head-changed（app-check が終わっていても）", () => {
    assert.equal(done(ciWaitStep(at, read({ sha: "bbb", appCheck: { status: "completed", conclusion: "success" } }), 1))?.result, "head-changed");
  });
  it("時間切れの回の読み直しで終わっていれば、その結果。終わっていなければ timeout", () => {
    assert.equal(done(ciWaitStep(at, read({ appCheck: { status: "completed", conclusion: "success" } }), 900_000))?.result, "success");
    assert.equal(done(ciWaitStep(at, read({ mergeable: false }), 900_000))?.result, "conflict");
    assert.equal(done(ciWaitStep(at, read({ appCheck: { status: "queued", conclusion: null } }), 900_000))?.result, "timeout");
    assert.equal(ciWaitStep(at, read(), 899_999).done, false);
  });
  it("読み取りの失敗はその回を飛ばし、続けて 5 回で error。成功すれば数え直す", () => {
    let s = at;
    for (let i = 1; i < 5; i++) {
      const r = ciWaitStep(s, { ok: false }, i * 30_000);
      assert.equal(r.done, false);
      if (!r.done) s = r.state;
    }
    assert.equal(s.failures, 4);
    assert.equal(done(ciWaitStep(s, { ok: false }, 150_000))?.result, "error");
    const ok = ciWaitStep(s, read(), 150_000);
    assert.equal(ok.done === false && ok.state.failures, 0);
  });
  it("時間切れの回に読めなかったときは timeout（5 回目なら error）", () => {
    assert.equal(done(ciWaitStep(at, { ok: false }, 900_000))?.result, "timeout");
    assert.equal(done(ciWaitStep({ ...at, failures: 4 }, { ok: false }, 900_000))?.result, "error");
  });
  it("最初の読み取りが失敗しても head を覚えていないだけで、次の成功で覚える", () => {
    const r = ciWaitStep(start, { ok: false }, 1);
    assert.equal(r.done === false && r.state.sha, null);
  });
});

describe("isOwnClaudePr（フォークの PR を役の対象にしない）", () => {
  const repo = "o/r";
  it("このリポジトリの claude/ のブランチは対象", () => {
    assert.equal(isOwnClaudePr({ head: { ref: "claude/issue-1", repo: { full_name: repo } } }, repo), true);
  });
  it("フォークの PR は、ブランチ名が claude/ でも対象にしない", () => {
    assert.equal(isOwnClaudePr({ head: { ref: "claude/issue-1", repo: { full_name: "x/r" } } }, repo), false);
  });
  it("フォークが消えた PR（repo が null）は対象にしない", () => {
    assert.equal(isOwnClaudePr({ head: { ref: "claude/issue-1", repo: null } }, repo), false);
  });
  it("claude/ で始まらないブランチは対象にしない", () => {
    assert.equal(isOwnClaudePr({ head: { ref: "sf-d/x", repo: { full_name: repo } } }, repo), false);
  });
});
