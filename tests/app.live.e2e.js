// 見本ではなく本番の動きを、中継のまね（ブラウザの中で受け答えする）で確かめる。使い方: node tests/app.live.e2e.js
// 開き直しても券が増えないこと、別の端末でも同じ数になること、つながらないあいだに出したものが後で届くこと
const { chromium } = require("playwright");
const path = require("path");
const URL = "file://" + path.resolve(__dirname, "..", "index.html");
const store = [], subs = new Set();
let down = false;   // true のあいだは中継につながらない
const match = (f, e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f["#t"] || e.tags.some(t => t[0] === "t" && f["#t"].includes(t[1]))) && (!f.until || e.created_at <= f.until);
async function relay(page) {
  await page.routeWebSocket(/^wss:\/\//, ws => {
    if (down) { ws.close(); return; }
    ws.onMessage(m => { const d = JSON.parse(m);
      if (d[0] === "REQ") { const f = d[2]; for (const e of store.filter(e => match(f, e)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit || 500)) ws.send(JSON.stringify(["EVENT", d[1], e])); ws.send(JSON.stringify(["EOSE", d[1]])); subs.add({ws, id: d[1], f}); }
      if (d[0] === "EVENT") { const e = d[1]; if (!store.some(x => x.id === e.id)) { store.push(e); for (const s of subs) if (match(s.f, e)) try { s.ws.send(JSON.stringify(["EVENT", s.id, e])); } catch (x) {} } ws.send(JSON.stringify(["OK", e.id, true, ""])); }
    });
  });
}
(async () => {
  const b = await chromium.launch(); const errs = [], log = [];
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? "OK  " : "NG  ") + l); };
  const open = async ctx => { const p = await ctx.newPage(); p.on("pageerror", e => errs.push(e.message)); await relay(p); await p.goto(URL); return p; };
  const tix = p => p.evaluate(() => __sr.S.users[__sr.me.pk] ? __sr.S.users[__sr.me.pk].tickets : null);
  try {
    const A = await b.newContext({locale: "ja-JP"});
    let p = await open(A);
    check("見本ではなく本番で動く", (await p.evaluate(() => __sr.mode)) === "live");
    await p.fill("#nm", "たろう"); await p.click("[data-act=start]"); await p.waitForTimeout(1500);
    check("名前が中継に届く", store.some(e => JSON.parse(e.content).t === "hello"));
    check("最初の券が1枚", (await tix(p)) === 1);
    await p.click("[data-act=ask]"); await p.waitForTimeout(300);
    await p.fill("#a-link", "https://example.com/app"); await p.fill("#a-ask", "最初の画面"); await p.click("[data-act=send-ask]"); await p.waitForTimeout(800);
    check("依頼で券が0枚になり、中継に届く", (await tix(p)) === 0 && store.some(e => JSON.parse(e.content).t === "ask"));
    for (let i = 1; i <= 3; i++) {
      await p.close(); p = await open(A); await p.waitForTimeout(2500);
      check(`開き直し${i}回目：券は0枚のまま`, (await tix(p)) === 0 && (await p.textContent("#tix")).trim() === "0");
      check(`開き直し${i}回目：「増えました」が出ない`, !(await p.textContent("#main")).includes("増えました"));
    }
    const key = await p.evaluate(() => __sr.me.sk);
    // 別の端末：かぎを入れると同じ券の数
    const B = await b.newContext({locale: "ja-JP"}); const q = await open(B);
    await q.fill("#nm", "仮"); await q.click("[data-act=start]"); await q.waitForTimeout(800);
    await q.click("[data-act=me]"); await q.waitForTimeout(300); await q.fill("#imp", key); await q.click("[data-act=import]"); await q.waitForTimeout(1500);
    check("別の端末でかぎを入れると、同じ券の数になる", (await tix(q)) === 0);
    // つながらないあいだ
    down = true; const C = await b.newContext({locale: "ja-JP"}); const r = await open(C);
    await r.fill("#nm", "はなこ"); await r.click("[data-act=start]"); await r.waitForTimeout(1500);
    check("つながらなくても見本に切り替わらない", (await r.evaluate(() => __sr.mode)) === "live" && (await r.textContent("#net")).includes("つないでいます"));
    const pk = await r.evaluate(() => __sr.me.pk);
    check("つながらないあいだは、まだ中継に届いていない", !store.some(e => e.pubkey === pk));
    down = false; await r.waitForTimeout(6000);
    check("つながったら、出したものが届く", store.some(e => e.pubkey === pk && JSON.parse(e.content).t === "hello"));
  } catch (x) { check("途中で止まった：" + x.message.split("\n")[0], false); }
  check("画面の中でエラーが起きない", errs.length === 0);
  console.log(log.join("\n")); if (errs.length) console.log("errors", errs);
  await b.close();
})();
