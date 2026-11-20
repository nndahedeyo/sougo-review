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
test("いまひとつは書いた人と依頼した人に半券ずつ（2つで1枚）。知らせたレビューは書いた人に何もなく、依頼した人に半券", () => {
  const a = ask("A", 1), b = ask("C", 1), c = ask("D", 1);
  const e = [a, b, c, ev("B", 2, {t: "take", req: a.id}), ev("B", 3, {t: "give", req: a.id, body}), ev("A", 4, {t: "judge", req: a.id, ok: false}),
             ev("B", 5, {t: "take", req: b.id}), ev("B", 6, {t: "give", req: b.id, body}), ev("C", 7, {t: "judge", req: b.id, ok: false}),
             ev("E", 5, {t: "take", req: c.id}), ev("E", 6, {t: "give", req: c.id, body}), ev("D", 7, {t: "flag", what: "review", req: c.id})];
  const S = reduce(e, 8);
  assert.equal(S.users.B.tickets, 2); assert.equal(S.users.E.tickets, 1);
  assert.equal(S.users.A.tickets, 0.5); assert.equal(S.users.C.tickets, 0.5); assert.equal(S.users.D.tickets, 0.5);
  // 役に立ったは依頼した人に何も戻らない。期限切れの自動の「役に立った」も同じ
  const x = ask("F", 1), S2 = reduce([x, ev("G", 2, {t: "take", req: x.id}), ev("G", 3, {t: "give", req: x.id, body})], 3 + 8 * 86400);
  assert.equal(S2.users.F.tickets, 0); assert.equal(S2.users.G.tickets, 2);
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
test("集まりに入った依頼は、取り下げても券が戻らない（つなぎで券を作り出すのを防ぐ）", () => {
  const e = []; helpedUser(e, "L", 1);
  const a = ask("A", 10), b = ask("B", 10); e.push(a, b); gave(e, "L", a, 12);
  const l = ev("L", 20, {t: "link", a: a.id, b: b.id}); e.push(l, ev("A", 21, {t: "answer", link: l.id, ok: true}), ev("B", 22, {t: "answer", link: l.id, ok: true}), ev("B", 23, {t: "cancel", req: b.id}));
  const S = reduce(e, 24); assert.equal(S.reqs[b.id].status, "cancelled"); assert.equal(S.users.B.tickets, 0);
  const c = ask("C", 30); assert.equal(reduce([c, ev("C", 31, {t: "cancel", req: c.id})], 32).users.C.tickets, 1);   // ふつうの取り下げは戻る
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
// ---------- 見てほしい所を複数・非公開 ----------
const pask = (pk, at, extra = {}) => ev(pk, at, {t: "ask", private: true, genres: ["use", "look"], hint: "家計簿アプリの最初の画面", sealed: "1:AAAA:BBBB", n: "0".repeat(32), ...extra});
const sealed = "1:CCCC:DDDD", K = "a".repeat(64);
test("見てほしい所は複数選べ、知らない種類は落とす。目安と書く欄が種類に合わせて増える", () => {
  const {genresOf, minutes, fields} = require("../app/rules.js");
  const a = ask("A", 1, {genre: undefined, genres: ["look", "use", "???"]});
  const S = reduce([a], 2); assert.deepEqual(S.reqs[a.id].genres, ["use", "look"]);
  assert.equal(minutes(["use", "look"]), 40); assert.equal(fields(["use", "look"]).length, 5);
  assert.equal(Object.keys(reduce([ask("B", 1, {genre: "x"})], 2).reqs).length, 0);
});
test("非公開：ひとことと閉じた中身がないと出せない。中身はだれにも見えない形で残る", () => {
  const ok = pask("A", 1), bad1 = pask("B", 1, {hint: " "}), bad2 = pask("C", 1, {sealed: "<script>"}), bad3 = pask("D", 1, {n: "zz"});
  const S = reduce([ok, bad1, bad2, bad3], 2);
  assert.deepEqual(Object.keys(S.reqs), [ok.id]); assert.equal(S.reqs[ok.id].link, ""); assert.equal(S.reqs[ok.id].private, true);
});
test("非公開：かぎは持ち主から引き受けた人にだけ渡せる。かぎがないと届けられない", () => {
  const a = pask("A", 1); const e = [a, ev("B", 2, {t: "take", req: a.id}),
    ev("B", 3, {t: "give", req: a.id, sealed, keyFor: sealed}),                 // かぎが来る前は届けられない
    ev("C", 3, {t: "share", req: a.id, to: "B", key: sealed}),                  // 持ち主でない人は渡せない
    ev("A", 4, {t: "share", req: a.id, to: "C", key: sealed})];                 // 引き受けていない人には渡せない
  let S = reduce(e, 5); assert.equal(S.reqs[a.id].status, "taken"); assert.deepEqual(S.reqs[a.id].shares, {});
  e.push(ev("A", 6, {t: "share", req: a.id, to: "B", key: sealed}), ev("B", 7, {t: "give", req: a.id, body}));   // 非公開は中身を閉じないと届けられない
  S = reduce(e, 8); assert.equal(S.reqs[a.id].status, "taken");
  e.push(ev("B", 9, {t: "give", req: a.id, sealed, keyFor: sealed}), ev("A", 10, {t: "judge", req: a.id, ok: true}));
  S = reduce(e, 11); assert.equal(S.reqs[a.id].status, "done"); assert.equal(S.reqs[a.id].body, null); assert.equal(S.users.B.tickets, 2);
});
test("非公開：かぎが届かないまま期限が来たら、引き受けた人に印をつけずに戻す。期限はかぎが届いてから数える", () => {
  const a = pask("A", 0), b = pask("C", 0);
  let S = reduce([a, ev("B", 1, {t: "take", req: a.id})], 3 * DAY); assert.equal(S.reqs[a.id].status, "taken");   // 期限前はかぎを待つ
  S = reduce([a, ev("B", 1, {t: "take", req: a.id})], 8 * DAY);
  assert.equal(S.reqs[a.id].status, "open"); assert.equal(S.users.B.lapses, undefined);
  const e = [b, ev("B", 1, {t: "take", req: b.id}), ev("C", 6 * DAY, {t: "share", req: b.id, to: "B", key: sealed})];
  S = reduce(e, 8 * DAY); assert.equal(S.reqs[b.id].status, "taken");
  S = reduce(e, 14 * DAY); assert.equal(S.reqs[b.id].status, "open"); assert.equal(S.users.B.lapses, 1);
});
test("非公開：公開は持ち主だけ。レビューの公開は、依頼が公開されたあと、書いた人だけ", () => {
  const a = pask("A", 1); const e = [a, ev("B", 2, {t: "take", req: a.id}), ev("A", 3, {t: "share", req: a.id, to: "B", key: sealed}),
    ev("B", 4, {t: "give", req: a.id, sealed, keyFor: sealed}), ev("B", 5, {t: "open-review", req: a.id, key: K}), ev("B", 5, {t: "reveal", req: a.id, key: K})];
  let S = reduce(e, 6); assert.equal(S.reqs[a.id].revealed, undefined); assert.equal(S.reqs[a.id].reviewKey, undefined);
  e.push(ev("A", 7, {t: "reveal", req: a.id, key: K}), ev("A", 8, {t: "open-review", req: a.id, key: K}));
  S = reduce(e, 9); assert.equal(S.reqs[a.id].openKey, K); assert.equal(S.reqs[a.id].reviewKey, undefined);
  e.push(ev("B", 10, {t: "open-review", req: a.id, key: K})); S = reduce(e, 11); assert.equal(S.reqs[a.id].reviewKey, K);
});
test("非公開の危ない依頼：かぎを受け取った実績のある人が2人そろうと消える。中身を見ていない人は知らせられない。知らせた人は手放したことになる", () => {
  const e = []; helpedUser(e, "L", 1); helpedUser(e, "M", 5); helpedUser(e, "N", 9);
  const a = pask("A", 20); e.push(a, ev("M", 21, {t: "flag", what: "ask", req: a.id}));
  let S = reduce(e, 22); assert.equal(S.reqs[a.id].status, "open"); assert.equal(S.reqs[a.id].flags, undefined);
  e.push(ev("L", 23, {t: "take", req: a.id}), ev("A", 24, {t: "share", req: a.id, to: "L", key: sealed}), ev("L", 25, {t: "flag", what: "ask", req: a.id}));
  S = reduce(e, 26); assert.equal(S.reqs[a.id].status, "open"); assert.equal(S.reqs[a.id].taker, null);   // 1人目：消えずに手放される
  e.push(ev("N", 27, {t: "take", req: a.id}), ev("A", 28, {t: "share", req: a.id, to: "N", key: sealed}), ev("N", 29, {t: "flag", what: "ask", req: a.id}));
  S = reduce(e, 30); assert.equal(S.reqs[a.id].status, "hidden"); assert.equal(S.users.A.flaggedAsks, 1);
});
// ---------- 最初の券・紹介・借り ----------
const END = require("../app/rules.js").R.starterUntil;
const P = c => c.repeat(64);
test("最初の券は期限までに始めた人だけ。期限のあとに始めた人は0枚から", () => {
  const S = reduce([ev("A", END - 10, {t: "hello", name: "a"}), ev("B", END + 10, {t: "hello", name: "b"})], END + 20);
  assert.equal(S.users.A.tickets, 1); assert.equal(S.users.A.starter, true);
  assert.equal(S.users.B.tickets, 0); assert.equal(S.users.B.starter, false);
  assert.equal(Object.keys(reduce([ev("B", END + 10, {t: "hello"}), ask("B", END + 11)], END + 20).reqs).length, 0);
});
test("紹介：実績のある人が券を1枚贈れる。自分には贈れない。実績も券もないと贈れない", () => {
  const e = []; helpedUser(e, P("a"), 1);
  e.push(ev(P("a"), END + 50, {t: "gift", to: P("c")}), ev(P("a"), END + 51, {t: "gift", to: P("a")}), ev(P("n"), END + 52, {t: "gift", to: P("c")}));
  e.push(ev(P("c"), END + 60, {t: "hello", name: "c"}));
  const S = reduce(e, END + 70);
  assert.equal(S.users[P("a")].tickets, 1); assert.equal(S.users[P("a")].gifted, 1);   // 最初の1枚＋役に立った1枚−贈った1枚
  assert.equal(S.users[P("c")].tickets, 1); assert.equal(S.users[P("c")].gotGift, 1);
  assert.equal(S.users[P("n")].gifted, 0);
  const q = ask(P("c"), END + 80); assert.equal(reduce([...e, q], END + 90).reqs[q.id].by, P("c"));   // 贈られた券で依頼できる
});
test("保険の借り：ふだんは使えない。有効なら、待っている依頼がないときだけ1件借りて出せ、次の券で返る", () => {
  const R = require("../app/rules.js").R;
  const b = ask("B", END + 2), e = [ev("B", END + 1, {t: "hello"}), b];
  assert.equal(Object.keys(reduce(e, END + 3).reqs).length, 0);
  R.borrow = true;
  try {
    let S = reduce(e, END + 3); assert.equal(S.users.B.tickets, -1);
    const c = ask("C", END + 5); e.push(ev("C", END + 4, {t: "hello"}), c);   // B の依頼が待っているので C は借りられない
    S = reduce(e, END + 6); assert.equal(S.reqs[c.id], undefined);
    const d = ask("B", END + 7); e.push(d); S = reduce(e, END + 8); assert.equal(S.reqs[d.id], undefined);   // 借りは1件まで
    // B がだれかを見て「役に立った」をもらうと、借りが返って0枚になる
    const a = ask("A", END + 8); e.push(ev("A", 10, {t: "hello"}), a, ev("B", END + 9, {t: "take", req: a.id}), ev("B", END + 10, {t: "give", req: a.id, body}), ev("A", END + 11, {t: "judge", req: a.id, ok: true}));
    S = reduce(e, END + 12); assert.equal(S.users.B.tickets, 0);
  } finally { R.borrow = false; }
});
// ---------- 共通のアカウント（かぎが替わっても同じ人） ----------
test("共通のアカウント：かぎを持ち替えても、券と記録は同じ人のまま", () => {
  const resolve = (pk, t) => ({K1: "ID", K2: "ID"})[pk] || null;
  const a = ask("K1", 10), e = [a, ev("B", 11, {t: "take", req: a.id}), ev("B", 12, {t: "give", req: a.id, body}), ev("K2", 13, {t: "judge", req: a.id, ok: true}), ask("K2", 14)];
  const S = reduce(e, 20, resolve);
  assert.equal(S.reqs[a.id].by, "ID"); assert.equal(S.reqs[a.id].status, "done");   // 別のかぎでも本人として返事できる
  assert.equal(S.users.ID.tickets, 0); assert.equal(S.users.K1, undefined);            // 最初の1枚を使い、2件目は券がないので出せない
  assert.equal(Object.values(S.reqs).filter(r => r.by === "ID").length, 1);
  assert.equal(S.reqs[a.id].byKey, "K1");
});
