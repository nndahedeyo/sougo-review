// 名前の出ない印（保留の数・レビュー集の ♡）を、中継のまねで確かめる。使い方: node tests/signals.e2e.js（SHOT=画像の置き場所 で画面も残す）
// パスキーで始める → この端末のかぎで始めた人が「パスキーで守る」に持ち替える → 番号・券・非公開の中身がそのまま
// → 持ち替えたあとも非公開のやりとりができる → 同期したパスキーで別の端末から開ける → 古いかぎは使えなくなる
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const HTML = fs.readFileSync(path.resolve(__dirname, "..", "index.html"));
const store = [], subs = new Set();
const match = (f, e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f["#t"] || e.tags.some(t => t[0] === "t" && f["#t"].includes(t[1]))) && (!f.until || e.created_at <= f.until);
async function relay(page) {
  await page.routeWebSocket(/^wss:\/\//, ws => { ws.onMessage(m => { const d = JSON.parse(m);
    if (d[0] === "REQ") { for (const e of store.filter(e => match(d[2], e))) ws.send(JSON.stringify(["EVENT", d[1], e])); ws.send(JSON.stringify(["EOSE", d[1]])); subs.add({ws, id: d[1], f: d[2]}); }
    if (d[0] === "EVENT") { const e = d[1]; if (!store.some(x => x.id === e.id)) { store.push(e); for (const s of subs) if (match(s.f, e)) try { s.ws.send(JSON.stringify(["EVENT", s.id, e])); } catch (x) {} } ws.send(JSON.stringify(["OK", e.id, true, ""])); } }); });
}
(async () => {
  const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html; charset=utf-8"); s.end(HTML); }).listen(8768);
  const b = await chromium.launch(); const errs = [], log = [];
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? "OK  " : "NG  ") + l); };
  async function device(time) {
    const ctx = await b.newContext({viewport: {width: 400, height: 860}, locale: "ja-JP"}); const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p); await cdp.send("WebAuthn.enable");
    const {authenticatorId} = await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true}});
    if (time) await p.clock.install({time: time * 1000}); await relay(p); await p.goto("http://localhost:8768/"); await p.waitForTimeout(600); p.cdp = cdp; p.auth = authenticatorId; return p;
  }
  const until = async (p, fn, arg, ms = 8000) => { try { await p.waitForFunction(fn, arg, {timeout: ms}); return true; } catch (e) { return false; } };
  const st = p => p.evaluate(() => { const m = __sr.me, u = __sr.S.users[m.id] || {}; return {pk: m.pk, id: m.id, how: m.how, tickets: u.tickets, retired: !!m.retired}; });
  const start = async (p, name) => { await p.fill("#nm", name); await p.click("[data-act=start]"); await p.waitForTimeout(1200); };
  async function ask(p, {priv, link, text, hint}) {
    await p.evaluate(() => __sr.act("ask")); await p.waitForTimeout(250);
    if ((await p.getAttribute("[data-chip=genres][data-v=use]", "aria-pressed")) !== "true") await p.click("[data-chip=genres][data-v=use]");
    if (priv) await p.click("[data-chip=priv][data-v=priv]");
    await p.fill("#a-link", link); await p.fill("#a-ask", text); if (priv) await p.fill("#a-hint", hint);
    await p.click("[data-act=send-ask]"); await p.waitForTimeout(500);
    return p.evaluate(tx => Object.values(__sr.S.reqs).filter(r => r.by === __sr.me.id).sort((a, b) => b.at - a.at)[0].id, text);
  }
  async function review(p, id, words) {
    await p.evaluate(id => __sr.act("take", id), id);
    const ok = await until(p, () => !!document.querySelector("#pbody [data-field]"));
    await p.fill("#w0", "手元で"); await p.fill("#w1", words); await p.click("[data-act=send-give]"); await p.waitForTimeout(500);
    return ok;
  }
  const judge = async (p, id) => { await until(p, id => __sr.S.reqs[id] && __sr.S.reqs[id].status === "given", id); await p.evaluate(id => __sr.act("judge-ok", id), id); await p.waitForTimeout(400); };
  try {
    const A = await device(); await start(A, "あおい");
    const r1 = await ask(A, {link: "https://example.com/app-1", text: "家計簿アプリの入力画面"});
    const pks = [await A.evaluate(() => __sr.me.pk)];
    // 3人が保留する
    const P3 = [];
    for (const nm of ["べに", "えま", "ゆず"]) {
      const P = await device(); await start(P, nm); pks.push(await P.evaluate(() => __sr.me.pk));
      await P.evaluate(id => __sr.act("view", id), r1); await P.waitForTimeout(300);
      await P.click('#pbody [data-act="watch"]'); await P.waitForTimeout(400); P3.push(P);
    }
    await A.waitForTimeout(800);
    const cnt = (type, id = r1) => A.evaluate(([t, id]) => __sr.sigCount(t, id), [type, id]);
    check("3人が保留すると、依頼した人に「3」と伝わる", await cnt("watch") === 3);
    check("「あなたの依頼」の一覧に「保留 3」（ほど・目安などの言葉なし）", (await A.textContent("#lists")).includes("保留 3") && !(await A.textContent("#lists")).includes("ほど"));
    // 作品への反応：使ってみた・よかった
    const [B, C, D] = P3;
    await C.evaluate(id => __sr.act("view", id), r1); await C.waitForTimeout(300);
    check("ほかの人の依頼に「使ってみた」「よかった」のボタン（数は出ない）", !!(await C.$('#pbody [data-act="react-used"]')) && !!(await C.$('#pbody [data-act="react-like"]')) && !/使ってみた\s*\d/.test(await C.textContent("#pbody")));
    await C.click('#pbody [data-act="react-used"]'); await C.waitForTimeout(300); await C.click('#pbody [data-act="react-like"]'); await C.waitForTimeout(300);
    await D.evaluate(id => __sr.act("view", id), r1); await D.waitForTimeout(300); await D.click('#pbody [data-act="react-used"]'); await D.waitForTimeout(400);
    await A.waitForTimeout(800);
    check("使ってみた 2・よかった 1 が依頼した人に届く", await cnt("used") === 2 && await cnt("like") === 1);
    check("一覧に「保留 3・使った 2・♡ 1」", (await A.textContent("#lists")).includes("使った 2") && (await A.textContent("#lists")).includes("♡ 1"));
    await A.evaluate(id => __sr.act("mine", id), r1); await A.waitForTimeout(300);
    const mt = await A.textContent("#pbody");
    check("自分の依頼の中身に、保留・使ってみた・よかったの3つの数", mt.includes("保留している人") && mt.includes("使ってみた人") && mt.includes("よかった") && await A.$$eval("#pbody .tally b", x => x.map(e => e.textContent).join()) === "3,2,1");
    check("自分の作品には押せない", !(await A.$('#pbody [data-act^="react-"]')));
    if (process.env.SHOT) { await A.screenshot({path: process.env.SHOT + "-mine.png"}); }
    await C.click('#pbody [data-act="react-like"]'); await C.waitForTimeout(400); await A.waitForTimeout(600);
    check("もう一度押すと外れる", await cnt("like") === 0);
    await C.click('#pbody [data-act="react-like"]'); await C.waitForTimeout(400);
    const sigs = store.filter(e => e.kind === 7711);
    check("印はだれのかぎでもない、使い捨てのかぎで出る", sigs.length >= 6 && sigs.every(e => !pks.includes(e.pubkey)));
    check("印の中身に名前や番号は入らない", sigs.every(e => { const c = JSON.parse(e.content); return Object.keys(c).sort().join() === "on,req,t"; }));
    check("印は券の決まりに数えられない（参加の人数も増えない）", await A.evaluate(n => Object.keys(__sr.S.users).length === n, 4));
    await B.evaluate(id => __sr.act("view", id), r1); await B.waitForTimeout(200); await B.click('#pbody [data-act="unwatch"]'); await B.waitForTimeout(400);
    await A.waitForTimeout(600); check("保留を外すと、数が減る", await cnt("watch") === 2);
    await B.click('#pbody [data-act="watch"]'); await B.waitForTimeout(400); await A.waitForTimeout(600);
    check("また付けても、同じ人は1つと数える", await cnt("watch") === 3);
    // レビュー集：反応は作品に付く
    const E = await device(); await start(E, "りん");
    const r2 = await ask(E, {link: "https://example.com/app-2", text: "写真整理アプリの見た目"}); await B.waitForTimeout(800);
    await review(B, r2, "ボタンの位置が分かりやすい"); await judge(E, r2);
    await D.evaluate(() => __sr.act("reviews")); await D.waitForTimeout(400);
    check("レビュー集でも、作品に「使ってみた」「よかった」を押せる", !!(await D.$(`#pbody [data-act="react-like"][data-id="${r2}"]`)));
    await D.click(`#pbody [data-act="react-like"][data-id="${r2}"]`); await D.waitForTimeout(500);
    check("押すと押した印が付く（ほかの人の数は見せない）", await D.getAttribute(`#pbody [data-act="react-like"][data-id="${r2}"]`, "aria-pressed") === "true" && !/よかった\s*\d/.test(await D.textContent("#pbody")));
    await E.evaluate(() => __sr.act("reviews")); await E.waitForTimeout(400);
    check("依頼した人はレビュー集でも自分の作品に押せない（数は見える）", !(await E.$(`#pbody [data-act^="react-"][data-id="${r2}"]`)) && (await E.textContent("#pbody")).includes("よかった 1"));
    const V = await device(); await V.waitForTimeout(800); await V.click("[data-act=reviews]"); await V.waitForTimeout(400);
    check("始める前の人には、数もボタンも出ない", !(await V.textContent("#pbody")).includes("よかった") && !(await V.$('#pbody [data-act^="react-"]')));
    if (process.env.SHOT) await D.screenshot({path: process.env.SHOT + "-reviews.png"});
    // いまの動きから、その先へ
    await A.evaluate(() => __sr.closePanel()); await A.waitForTimeout(300);
    const fe = await A.$("#feed [data-act]");
    check("いまの動きの行を押せる", !!fe);
    if (fe) { await fe.click(); await A.waitForTimeout(400); check("押すと、その依頼が開く", await A.evaluate(() => document.querySelector("#panel").classList.contains("on") && !!document.querySelector("#pbody h2"))); }
    if (process.env.SHOT) { await A.evaluate(() => __sr.closePanel()); await A.waitForTimeout(200); await A.screenshot({path: process.env.SHOT + "-home.png"}); }
    // みんなの作品：レビューの結果に関係なく、公開の依頼が並ぶ
    await C.evaluate(() => __sr.act("works")); await C.waitForTimeout(400);
    const wt = await C.textContent("#pbody");
    check("みんなの作品に、待っている依頼も完了した依頼も並ぶ", wt.includes("家計簿アプリの入力画面") && wt.includes("写真整理アプリの見た目"));
    check("ホームの数に「作品」がある", (await A.textContent("#pulse")).includes("作品"));
    // 作者に伝える
    await C.click(`#pbody [data-act="tell"][data-id="${r1}"]`); await C.waitForTimeout(300);
    await C.fill("#n-text", "保存ボタンを押しても反応しないことがありました"); await C.click('#pbody [data-act="send-note"]'); await C.waitForTimeout(800);
    check("送ると「送ったもの」に残る", (await C.textContent("#pbody")).includes("保存ボタンを押しても反応しない"));
    const nev = store.filter(e => e.kind === 7712);
    check("伝言は暗号になっていて、中継には中身が出ない", nev.length === 1 && !nev[0].content.includes("保存ボタン"));
    await A.waitForTimeout(6500);
    check("作者の一覧に「伝言 1」", (await A.textContent("#lists")).includes("伝言 1"));
    await A.evaluate(id => __sr.act("mine", id), r1); await A.waitForTimeout(400);
    const at = await A.textContent("#pbody");
    check("作者は伝言を読める（送った人の名前つき）", at.includes("保存ボタンを押しても反応しない") && at.includes("えま"));
    if (process.env.SHOT) await A.screenshot({path: process.env.SHOT + "-tell.png"});
    await D.waitForTimeout(6000);
    check("ほかの人には読めない", await D.evaluate(() => !document.body.textContent.includes("保存ボタン")) && !(await D.evaluate(id => { __sr.act("view", id); return document.querySelector("#pbody").textContent.includes("保存ボタン"); }, r1)));
    check("自分の作品には「作者に伝える」が出ない", await A.evaluate(id => { __sr.act("works"); return !document.querySelector(`#pbody [data-act="tell"][data-id="${id}"]`); }, r1));
    // 名前を載せたくない人の伝言（ゆず）
    await D.evaluate(id => __sr.act("tell", id), r1); await D.waitForTimeout(300);
    await D.fill("#n-text", "色が少し薄く感じました"); await D.uncheck("#n-credit"); await D.click('#pbody [data-act="send-note"]'); await D.waitForTimeout(600);
    await A.waitForTimeout(6500);
    // 直しました：作者だけが出せる。だれのおかげかを選ぶ
    await A.evaluate(id => __sr.act("mine", id), r1); await A.waitForTimeout(300);
    await A.click('#pbody [data-act="fix"]'); await A.waitForTimeout(300);
    const cands = await A.$$eval("#pbody [data-thank]", x => x.map(e => e.parentElement.textContent));
    check("「だれの指摘で」の候補に、名前を載せてよい人だけが出る", cands.length === 1 && cands[0].includes("えま") && !cands.some(c => c.includes("ゆず")));
    await A.fill("#f-text", "保存ボタンを画面の上に移しました"); await A.check("#pbody [data-thank]"); await A.click('#pbody [data-act="send-fix"]'); await A.waitForTimeout(600);
    check("作者の画面に「直しました」と「関わった人：えま」", (await A.textContent("#pbody")).includes("保存ボタンを画面の上に移しました") && /関わった人：えま#\w+（直すのに協力）/.test(await A.textContent("#pbody")));
    await C.evaluate(() => __sr.closePanel()); await C.waitForTimeout(1500);
    check("おかげで直った人に「あなたの指摘で直りました」", (await C.textContent("#lists")).includes("あなたの指摘で直りました"));
    await D.evaluate(() => __sr.closePanel()); await D.waitForTimeout(1500);
    check("使った人に「使った作品が直りました」（名前は載らない）", (await D.textContent("#lists")).includes("使った作品が直りました"));
    await C.click('#lists [data-act="fixnews"]'); await C.waitForTimeout(400);
    check("お知らせを押すと作品が開き、関わった人が見える", /関わった人：えま/.test(await C.textContent("#pbody")));
    await C.evaluate(() => __sr.closePanel()); await C.waitForTimeout(300);
    check("見たお知らせは消える", !(await C.textContent("#lists")).includes("あなたの指摘で直りました"));
    await B.evaluate(id => __sr.act("view", id), r1); await B.waitForTimeout(200);
    const nb = store.length; await B.evaluate(async id => { await __sr.emitRaw({t: "fixed", req: id, text: "なりすまし", thanks: []}); }, r1).catch(() => {});
    await A.waitForTimeout(800);
    check("作者でない人の「直しました」は無視される", !(await A.evaluate(id => JSON.stringify(__sr.fixes(id)), r1)).includes("なりすまし"));
    // ひとつ試す
    await C.evaluate(() => __sr.act("works")); await C.waitForTimeout(300);
    check("みんなの作品の見出しの横に「ひとつ試す」", !!(await C.$('#pbody [data-act="try"]')));
    await C.click('#pbody [data-act="try"]'); await C.waitForTimeout(300);
    check("押すと、自分のでない作品が1つ開く", await C.evaluate(() => { const h = document.querySelector("#pbody h2"); return !!h && h.textContent === "依頼"; }));
    check("一覧で、見てほしい所と数が別の行", await A.evaluate(() => { const it = [...document.querySelectorAll("#lists .item")].find(x => x.textContent.includes("家計簿")); return !!it && it.querySelector("span").textContent === "使い心地" && /保留 3/.test(it.querySelector(".meta").textContent); }));
    // リンクなしの依頼（アイデア）：いつから通すかはまだ決めていない。いまは今までどおり、リンクがないと出せない
    const G = await device(); await start(G, "そら");
    const nReq = await G.evaluate(() => Object.keys(__sr.S.reqs).length);
    await G.evaluate(() => __sr.act("ask")); await G.waitForTimeout(250);
    await G.click("[data-chip=genres][data-v=idea]"); await G.fill("#a-ask", "通知を時間帯ごとに自動でまとめて受け取れるようにするアイデア"); await G.click("[data-act=send-ask]"); await G.waitForTimeout(400);
    check("いまは、リンクなしでは依頼を出せない", (await G.evaluate(() => Object.keys(__sr.S.reqs).length)) === nReq && (await G.textContent("#pbody")).includes("https://"));
    check("横にはみ出さない", !(await D.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  } catch (x) { check("途中で止まった：" + x.message.split("\n")[0], false); }
  check("画面の中でエラーが起きない", errs.length === 0);
  console.log(log.join("\n")); if (errs.length) console.log("errors", errs);
  await b.close(); srv.close();
})();
