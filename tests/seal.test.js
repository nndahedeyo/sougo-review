// 非公開の暗号の確かめ。使い方: node --test tests/seal.test.js
const test = require("node:test"), assert = require("node:assert");
const Sig = require("../app/sig.js"), Seal = require("../app/seal.js");
const pair = () => { const sk = Sig.newKey(); return {sk, pk: Sig.hex(Sig.pubkey(Sig.unhex(sk)))}; };
test("ふたりのかぎは、どちらの側から作っても同じ（かぎの向きによらず）", async () => {
  for (let i = 0; i < 30; i++) { const a = pair(), b = pair(); assert.equal(Sig.hex(await Seal.pairKey(a.sk, b.pk)), Sig.hex(await Seal.pairKey(b.sk, a.pk))); }
});
test("ほかの人のかぎでは開けない・書き換えると開けない・別の依頼の札では開けない", async () => {
  const a = pair(), b = pair(), c = pair();
  const k = await Seal.pairKey(a.sk, b.pk), s = await Seal.seal(k, {x: "中身"}, "share:1");
  assert.deepEqual(await Seal.open(await Seal.pairKey(b.sk, a.pk), s, "share:1"), {x: "中身"});
  assert.equal(await Seal.open(await Seal.pairKey(c.sk, a.pk), s, "share:1"), null);
  assert.equal(await Seal.open(k, s, "share:2"), null);
  const t = s.slice(0, -4) + (s.slice(-4) === "AAAA" ? "BBBB" : "AAAA"); assert.equal(await Seal.open(k, t, "share:1"), null);
});
test("中身のかぎは、自分のかぎと乱数から作り直せる（端末を替えても読める）", async () => {
  const a = pair(), n = Sig.hex(Seal.rand(16));
  assert.equal(Sig.hex(await Seal.contentKey(a.sk, n)), Sig.hex(await Seal.contentKey(a.sk, n)));
  assert.notEqual(Sig.hex(await Seal.contentKey(a.sk, n)), Sig.hex(await Seal.contentKey(pair().sk, n)));
});
