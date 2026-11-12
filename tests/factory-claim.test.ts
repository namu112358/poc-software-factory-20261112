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
  ciCheck,
  precheckActions,
  relabelTargets,
  readyBudget,
  READY_EVENTS_PER_HOUR_BUDGET,
  waitingSince,
  waitsOn,
  blockingDeps,
  makeIsStalled,
  type IssueInfo,
  normalizeLabel,
  START_LABELS,
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

  it("app-check と pr-body-check が両方 success なら ok", () => {
    assert.equal(ciCheck([run("app-check", "success"), run("pr-body-check", "success"), run("Summary", "failure")]).ok, true);
  });

  it("app-check が落ちていれば ok にしない（#364 の形）", () => {
    const r = ciCheck([run("app-check", "failure"), run("pr-body-check", "success")]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /app-check が failure/);
  });

  it("本文の検査が skipped のまま残っていれば ok にしない（#258 の形）", () => {
    assert.equal(ciCheck([run("app-check", "success"), run("pr-body-check", "skipped")]).ok, false);
  });

  it("まだ終わっていない・まだ無いチェックがあれば ok にしない", () => {
    assert.equal(ciCheck([run("app-check", null, "2026-11-12T18:00:00Z", "in_progress"), run("pr-body-check", "success")]).ok, false);
    assert.equal(ciCheck([run("app-check", "success")]).ok, false);
  });

  it("同じ名前のチェックが何度も動いたときは、最後に始まったものを見る", () => {
    const old = run("pr-body-check", "failure", "2026-11-12T17:00:00Z");
    const now = run("pr-body-check", "success", "2026-11-12T18:00:00Z");
    assert.equal(ciCheck([run("app-check", "success"), now, old]).ok, true);
    assert.equal(ciCheck([run("app-check", "success"), old, run("pr-body-check", "failure", "2026-11-12T19:00:00Z")]).ok, false);
  });
});
