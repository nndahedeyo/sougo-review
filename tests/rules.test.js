// 決まりの確かめ。使い方: node tests/rules.test.js
const test = require("node:test"), assert = require("node:assert");
const {reduce, DAY} = require("../app/rules.js");
let seq = 0;
const ev = (pk, at, c) => ({id: String(++seq).padStart(4, "0"), pubkey: pk, created_at: at, kind: 7710, content: JSON.stringify(c)});
const ask = (pk, at, extra = {}) => ev(pk, at, {t: "ask", link: "https://example.com/app", genre: "use", ask: "最初の画面で迷わないか", ...extra});
const body = {"確かめた環境": "iPhone"};

test("一回り：依頼→引き受け→届ける→役に立った で券が移る", () => {
  const a = ask("A", 10); const evs = [a, ev("B", 20, {t: "take", req: a.id}), ev("B", 30, {t: "give", req: a.id, body}), ev("A", 40, {t: "judge", req: a.id, ok: true})];
  const S = reduce(evs, 50);
  assert.equal(S.reqs[a.id].status, "done");
  assert.equal(S.users.A.tickets, 0); assert.equal(S.users.B.tickets, 2);
});
test("券がなければ依頼できない", () => {
  const S = reduce([ask("A", 1), ask("A", 2)], 3);
  assert.equal(Object.keys(S.reqs).length, 1);
});
test("自分の依頼は引き受けられない・先に引き受けた人が優先", () => {
  const a = ask("A", 1);
  const S = reduce([a, ev("A", 2, {t: "take", req: a.id}), ev("B", 3, {t: "take", req: a.id}), ev("C", 4, {t: "take", req: a.id})], 5);
  assert.equal(S.reqs[a.id].taker, "B");
});
test("お返しの引き受けはできない（直前にレビューしてくれた相手の依頼）", () => {
  const a = ask("A", 1);
  const e = [a, ev("B", 2, {t: "take", req: a.id}), ev("B", 3, {t: "give", req: a.id, body}), ev("A", 4, {t: "judge", req: a.id, ok: true})];
  const b = ask("B", 5); e.push(b, ev("A", 6, {t: "take", req: b.id}), ev("C", 7, {t: "take", req: b.id}));
  assert.equal(reduce(e, 8).reqs[b.id].taker, "C");
});
test("7日届かなければ依頼は戻る・届いて7日返事がなければ役に立った扱い", () => {
  const a = ask("A", 0); const e = [a, ev("B", 10, {t: "take", req: a.id})];
  assert.equal(reduce(e, 10 + 8 * DAY).reqs[a.id].status, "open");
  e.push(ev("B", 20, {t: "give", req: a.id, body}));
  const S = reduce(e, 20 + 8 * DAY);
  assert.equal(S.reqs[a.id].status, "done"); assert.equal(S.users.B.tickets, 2);
});
test("だれが書いても券は同じ1枚・依頼の希望と使ったAIが残る", () => {
  const a = ask("A", 1, {want: "ai", aiName: "Claude Opus 5.5"});
  const e = [a, ev("B", 2, {t: "take", req: a.id}), ev("B", 3, {t: "give", req: a.id, used: "Claude Opus 5.5", body}), ev("A", 4, {t: "judge", req: a.id, ok: true})];
  const S = reduce(e, 5);
  assert.equal(S.users.B.tickets, 2); assert.equal(S.reqs[a.id].want, "ai"); assert.equal(S.reqs[a.id].used, "Claude Opus 5.5");
  const S2 = reduce([ask("C", 1, {want: "???"})], 2); assert.equal(Object.values(S2.reqs)[0].want, "any");
});
test("取り下げると券が戻る・引き受けた人は手放せる・同時に持てるのは2件まで", () => {
  const a = ask("A", 1), b = ask("C", 1), c = ask("E", 1);
  const e = [a, ev("A", 2, {t: "cancel", req: a.id}), b, c, ev("B", 3, {t: "take", req: b.id}), ev("B", 3, {t: "release", req: b.id}),
             ev("B", 4, {t: "take", req: b.id}), ev("B", 4, {t: "take", req: c.id}), ask("F", 1)];
  const f = e[e.length - 1]; e.push(ev("B", 5, {t: "take", req: f.id}));
  const S = reduce(e, 6);
  assert.equal(S.users.A.tickets, 1); assert.equal(S.reqs[b.id].taker, "B"); assert.equal(S.reqs[f.id].status, "open");
});
test("同じ出来事の並びなら、順番が違っても同じ結果", () => {
  const a = ask("A", 1); const e = [a, ev("B", 2, {t: "take", req: a.id}), ev("C", 2, {t: "take", req: a.id})];
  assert.equal(reduce(e, 3).reqs[a.id].taker, reduce(e.slice().reverse(), 3).reqs[a.id].taker);
});
test("危ない依頼：「役に立った」をもらったことのある2人が知らせると消える（実績のない人の知らせは数えない）", () => {
  const x = ask("X", 1), done = ask("Z", 1);
  const e = [done, ev("B", 2, {t: "take", req: done.id}), ev("B", 3, {t: "give", req: done.id, body}), ev("Z", 4, {t: "judge", req: done.id, ok: true}),
             ask("Y", 1)];
  const y = e[e.length - 1];
  e.push(ev("C", 5, {t: "take", req: y.id}), ev("C", 6, {t: "give", req: y.id, body}), ev("Y", 7, {t: "judge", req: y.id, ok: true}));
  e.push(x, ev("N", 8, {t: "flag", what: "ask", req: x.id}), ev("B", 9, {t: "flag", what: "ask", req: x.id}));
  let S = reduce(e, 10); assert.equal(S.reqs[x.id].status, "open");
  e.push(ev("C", 11, {t: "flag", what: "ask", req: x.id}));
  S = reduce(e, 12); assert.equal(S.reqs[x.id].status, "hidden"); assert.equal(S.users.X.flaggedAsks, 1); assert.equal(S.users.X.tickets, 0);
});
test("危ないレビュー：依頼した人が知らせると券は入らず、書いた人に印が残る", () => {
  const a = ask("A", 1); const e = [a, ev("B", 2, {t: "take", req: a.id}), ev("B", 3, {t: "give", req: a.id, body}), ev("A", 4, {t: "flag", what: "review", req: a.id})];
  const S = reduce(e, 5); assert.equal(S.users.B.tickets, 1); assert.equal(S.users.B.flaggedReviews, 1); assert.equal(S.reqs[a.id].status, "done");
});
test("未来の時刻の出来事は数えない・依頼より前の時刻の引き受けは無効", () => {
  const a = ask("A", 100);
  const S = reduce([a, ev("B", 50, {t: "take", req: a.id}), ev("C", 99999, {t: "take", req: a.id})], 200);
  assert.equal(S.reqs[a.id].status, "open");
});
test("期限切れにした人は同じ依頼を引き受け直せない・実績のない人は同時に1件まで", () => {
  const a = ask("A", 0), b = ask("C", 0);
  const e = [a, b, ev("B", 1, {t: "take", req: a.id}), ev("B", 2, {t: "take", req: b.id})];
  let S = reduce(e, 3); assert.equal(S.reqs[b.id].status, "open");          // 実績なしは1件まで
  e.push(ev("B", 8 * DAY, {t: "take", req: a.id}));
  S = reduce(e, 8 * DAY + 1); assert.equal(S.reqs[a.id].status, "open"); assert.equal(S.users.B.lapses, 1);
});
test("いまひとつは半券（0.5枚）、2つで1枚。知らせたレビューには何も入らない", () => {
  const a = ask("A", 1), b = ask("C", 1), c = ask("D", 1);
  const e = [a, b, c, ev("B", 2, {t: "take", req: a.id}), ev("B", 3, {t: "give", req: a.id, body}), ev("A", 4, {t: "judge", req: a.id, ok: false}),
             ev("B", 5, {t: "take", req: b.id}), ev("B", 6, {t: "give", req: b.id, body}), ev("C", 7, {t: "judge", req: b.id, ok: false}),
             ev("E", 5, {t: "take", req: c.id}), ev("E", 6, {t: "give", req: c.id, body}), ev("D", 7, {t: "flag", what: "review", req: c.id})];
  const S = reduce(e, 8);
  assert.equal(S.users.B.tickets, 2); assert.equal(S.users.E.tickets, 1);
});
const {contributions} = require("../app/rules.js");
function helpedUser(e, who, at) {   // who に「役に立った」の実績をつける
  const x = ask("H" + at, at); e.push(x, ev(who, at + 1, {t: "take", req: x.id}), ev(who, at + 2, {t: "give", req: x.id, body}), ev("H" + at, at + 3, {t: "judge", req: x.id, ok: true}));
}
const gave = (e, who, r, at) => e.push(ev(who, at, {t: "take", req: r.id}), ev(who, at + 1, {t: "give", req: r.id, body}));  // who が r を見て届けた
test("つなぐ：両方の持ち主が受けると成立し、つないだ人に券1枚・集まりができる", () => {
  const e = []; helpedUser(e, "L", 1);
  const a = ask("A", 10), b = ask("B", 10); e.push(a, b); gave(e, "L", a, 12);
  const l = ev("L", 20, {t: "link", a: a.id, b: b.id, why: "同じ悩み"}); e.push(l, ev("A", 21, {t: "answer", link: l.id, ok: true}));
  let S = reduce(e, 22); assert.equal(S.links[l.id].status, "pending"); assert.equal(S.users.L.tickets, 2);
  e.push(ev("B", 23, {t: "answer", link: l.id, ok: true}));
  S = reduce(e, 24);
  assert.equal(S.links[l.id].status, "joined"); assert.equal(S.users.L.tickets, 3);
  const C = Object.values(S.circles)[0]; assert.deepEqual(C.members.sort(), ["A", "B", "L"]);
});
test("つなぐ：実績のない人・持ち主本人は提案できない、断られたら何も起きない、同じ2人は1回だけ", () => {
  const e = []; helpedUser(e, "L", 1); helpedUser(e, "M", 5);
  const a = ask("A", 10), b = ask("B", 10), a2 = ask("A", 11); e.push(a, b); gave(e, "L", a, 12);
  e.push(ev("N", 20, {t: "link", a: a.id, b: b.id}), ev("A", 20, {t: "link", a: a.id, b: b.id}));
  let S = reduce(e, 21); assert.equal(Object.keys(S.links).length, 0);
  const l = ev("L", 22, {t: "link", a: a.id, b: b.id}); e.push(l, ev("A", 23, {t: "answer", link: l.id, ok: false}));
  S = reduce(e, 24); assert.equal(S.links[l.id].status, "declined"); assert.equal(S.users.L.tickets, 2);
  const l2 = ev("L", 25, {t: "link", a: a.id, b: b.id}); e.push(l2, ev("A", 26, {t: "answer", link: l2.id, ok: true}), ev("B", 27, {t: "answer", link: l2.id, ok: true}));
  const l3 = ev("M", 28, {t: "link", a: b.id, b: a.id}); e.push(l3);
  S = reduce(e, 29); assert.equal(S.links[l2.id].status, "joined"); assert.equal(S.links[l3.id], undefined);
});
test("集まりが広がり、できた→確かにで完結し、貢献の記録が残る", () => {
  const e = []; helpedUser(e, "L", 1);
  const a = ask("A", 10), b = ask("B", 10), c = ask("C", 10); e.push(a, b, c); gave(e, "L", a, 12); gave(e, "L", b, 14);
  const l1 = ev("L", 20, {t: "link", a: a.id, b: b.id}); e.push(l1, ev("A", 21, {t: "answer", link: l1.id, ok: true}), ev("B", 21, {t: "answer", link: l1.id, ok: true}));
  const l2 = ev("L", 22, {t: "link", a: b.id, b: c.id}); e.push(l2, ev("B", 23, {t: "answer", link: l2.id, ok: true}), ev("C", 23, {t: "answer", link: l2.id, ok: true}));
  let S = reduce(e, 24); const C = Object.values(S.circles); assert.equal(C.length, 1); assert.equal(C[0].reqs.length, 3);
  e.push(ev("C", 30, {t: "made", circle: C[0].id, url: "https://example.com/done", what: "合作アプリ"}), ev("C", 31, {t: "confirm", circle: C[0].id}));
  S = reduce(e, 32); assert.equal(S.circles[C[0].id].status, "made");
  e.push(ev("X", 33, {t: "confirm", circle: C[0].id}), ev("A", 34, {t: "confirm", circle: C[0].id}));
  S = reduce(e, 35); assert.equal(S.circles[C[0].id].status, "complete");
  const rec = contributions(S, C[0].id); assert.equal(rec.find(x => x.pk === "L").linked, 2); assert.equal(rec.find(x => x.pk === "C").made, 1);
});
test("つなぎの提案は14日で消える", () => {
  const e = []; helpedUser(e, "L", 1); const a = ask("A", 10), b = ask("B", 10); e.push(a, b); gave(e, "L", a, 12); const l = ev("L", 20, {t: "link", a: a.id, b: b.id}); e.push(l);
  assert.equal(reduce(e, 20 + 15 * DAY).links[l.id].status, "expired");
});
test("つなぐ：2つのどちらも見たことがなければ提案できない。片方を見ていればよい", () => {
  const e = []; helpedUser(e, "L", 1); const a = ask("A", 10), b = ask("B", 10), c = ask("C", 10); e.push(a, b, c);
  const l1 = ev("L", 20, {t: "link", a: a.id, b: b.id}); e.push(l1);
  e.push(ev("L", 21, {t: "take", req: c.id}));
  const l2 = ev("L", 22, {t: "link", a: c.id, b: b.id}); e.push(l2);   // 引き受けただけでは「見た」にならない
  e.push(ev("L", 23, {t: "give", req: c.id, body}));
  const l3 = ev("L", 24, {t: "link", a: b.id, b: c.id}); e.push(l3);   // 届けた依頼となら、もう片方は見ていなくてよい
  const S = reduce(e, 25);
  assert.equal(S.links[l1.id], undefined); assert.equal(S.links[l2.id], undefined); assert.equal(S.links[l3.id].status, "pending");
});
