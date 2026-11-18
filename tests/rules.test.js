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
test("危ない依頼：見てあげた実績のある2人が知らせると消える（実績のない人の知らせは数えない）", () => {
  const x = ask("X", 1), done = ask("Z", 1);
  const e = [done, ev("B", 2, {t: "take", req: done.id}), ev("B", 3, {t: "give", req: done.id, body}), ev("Z", 4, {t: "judge", req: done.id, ok: true}),
             ask("Y", 1)];
  const y = e[e.length - 1];
  e.push(ev("C", 5, {t: "take", req: y.id}), ev("C", 6, {t: "give", req: y.id, body}), ev("Y", 7, {t: "judge", req: y.id, ok: false}));
  e.push(x, ev("N", 8, {t: "flag", what: "ask", req: x.id}), ev("B", 9, {t: "flag", what: "ask", req: x.id}));
  let S = reduce(e, 10); assert.equal(S.reqs[x.id].status, "open");
  e.push(ev("C", 11, {t: "flag", what: "ask", req: x.id}));
  S = reduce(e, 12); assert.equal(S.reqs[x.id].status, "hidden"); assert.equal(S.users.X.flaggedAsks, 1); assert.equal(S.users.X.tickets, 0);
});
test("危ないレビュー：依頼した人が知らせると券は入らず、書いた人に印が残る", () => {
  const a = ask("A", 1); const e = [a, ev("B", 2, {t: "take", req: a.id}), ev("B", 3, {t: "give", req: a.id, body}), ev("A", 4, {t: "flag", what: "review", req: a.id})];
  const S = reduce(e, 5); assert.equal(S.users.B.tickets, 1); assert.equal(S.users.B.flaggedReviews, 1); assert.equal(S.reqs[a.id].status, "done");
});
