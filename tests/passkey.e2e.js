// パスキーと共通のアカウントを、試験用の仮の認証器と中継のまねで確かめる。使い方: node tests/passkey.e2e.js
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
  const srv = http.createServer((q, s) => { s.setHeader("content-type", "text/html; charset=utf-8"); s.end(HTML); }).listen(8767);
  const b = await chromium.launch(); const errs = [], log = [];
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? "OK  " : "NG  ") + l); };
  async function device() {
    const ctx = await b.newContext({viewport: {width: 400, height: 860}, locale: "ja-JP"}); const p = await ctx.newPage();
    p.on("pageerror", e => errs.push(e.message));
    const cdp = await ctx.newCDPSession(p); await cdp.send("WebAuthn.enable");
    const {authenticatorId} = await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true}});
    await relay(p); await p.goto("http://localhost:8767/"); await p.waitForTimeout(600); p.cdp = cdp; p.auth = authenticatorId; return p;
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
    // パスキーで始める
    const A = await device();
    await start(A, "あおい");
    const a = await st(A);
    check("パスキーで始められる", a.how === "passkey" && a.tickets === 1);
    check("共通のアカウントが開かれる（仮想市場と同じしくみ）", store.some(e => e.kind === 7720 && e.pubkey === a.pk && JSON.parse(e.content).t === "open"));
    // この端末のかぎで始めた人（パスキーが使えない端末を、パスキーを隠してまねる）
    const B = await device();
    await B.evaluate(() => { window._pkc = window.PublicKeyCredential; window.PublicKeyCredential = undefined; });
    await start(B, "べに");
    await B.evaluate(() => { window.PublicKeyCredential = window._pkc; });
    const b0 = await st(B);
    check("パスキーが使えない端末では、この端末のかぎで始まる", b0.how === "device" && b0.tickets === 1 && !store.some(e => e.kind === 7720 && e.pubkey === b0.pk));
    // べにが非公開で頼み、あおいが見る
    const r1 = await ask(B, {priv: true, link: "https://example.com/hidden-1", text: "発表前の画面その1", hint: "新しい画面"});
    await A.waitForTimeout(800);
    check("持ち替える前：引き受けた人に中身が届く", await review(A, r1, "ボタンが小さい") && (await A.textContent("#pbody")).includes("発表前の画面その1"));
    await judge(B, r1);
    check("持ち替える前：閉じたレビューを読める", await until(B, id => __sr.rplain[id] && JSON.stringify(__sr.rplain[id]).includes("ボタンが小さい"), r1));
    // ほかの人（えま）の公開の依頼をべにが見て、券を1枚ためる（見てくれた人どうしの返し合いは決まりで止まるため）
    const E = await device(); await start(E, "えま");
    const r2 = await ask(E, {link: "https://example.com/open-2", text: "公開の依頼"}); await B.waitForTimeout(800);
    await review(B, r2, "読みやすい"); await judge(E, r2);
    await until(B, () => __sr.S.users[__sr.me.id].tickets === 1);
    const b1 = await st(B), oldSk = await B.evaluate(() => __sr.me.sk);
    // パスキーで守る（持ち替え）
    await B.evaluate(() => __sr.act("me")); await B.waitForTimeout(300);
    check("記録とかぎに「パスキーで守る」がある", !!(await B.$("#pbody [data-act=protect]")));
    await B.click("#pbody [data-act=protect]"); await B.waitForTimeout(1200);
    const b2 = await st(B);
    check("パスキーで守ると、かぎは替わるが番号と券はそのまま", b2.how === "passkey" && b2.pk !== b1.pk && b2.id === b1.id && b2.tickets === b1.tickets);
    check("記録とかぎに「パスキーで守られています」と出る", (await B.textContent("#pbody")).includes("パスキーで守られています"));
    // 開き直しても、持ち替える前の非公開の中身とレビューが読める（この端末に前のかぎを残してある）
    await B.reload(); await B.waitForTimeout(1500);
    check("開き直しても同じ人", (await st(B)).id === b1.id);
    check("持ち替える前の自分の非公開の依頼が読める", await until(B, id => __sr.plain[id] && __sr.plain[id].ask.includes("その1"), r1));
    check("持ち替える前に届いたレビューが読める", await until(B, id => __sr.rplain[id] && JSON.stringify(__sr.rplain[id]).includes("ボタンが小さい"), r1));
    // 持ち替えたあとの非公開のやりとり
    const r3 = await ask(B, {priv: true, link: "https://example.com/hidden-3", text: "発表前の画面その3", hint: "次の画面"});
    check("新しいかぎで出した依頼も、同じ人の依頼として数えられる", await B.evaluate(id => __sr.S.reqs[id].by === __sr.me.id && __sr.S.reqs[id].byKey === __sr.me.pk, r3));
    await A.waitForTimeout(800);
    check("持ち替えたあと：引き受けた人に中身が届く", await review(A, r3, "色が見づらい") && (await A.textContent("#pbody")).includes("発表前の画面その3"));
    check("持ち替えたあと：閉じたレビューを読める", await until(B, id => __sr.rplain[id] && JSON.stringify(__sr.rplain[id]).includes("色が見づらい"), r3));
    // パスキーで開き直す（同期した別の端末と同じ。試験用の認証器はパスキーを別の端末へ写せないので、同じ端末で閉じてから開く）
    const bt = (await st(B)).tickets;
    await B.evaluate(() => { localStorage.removeItem("sougo.me"); localStorage.removeItem("sougo.live"); localStorage.removeItem("sougo.ok"); }); await B.reload(); await B.waitForTimeout(1200);
    check("記録を消すと、はじめの画面になる", !!(await B.$("[data-act=pk-open]")));
    await B.click("[data-act=pk-open]"); await B.waitForTimeout(1500);
    const c = await st(B);
    check("パスキーで開くと、同じアカウント（同じ番号・券）に戻る", c.pk === b2.pk && c.id === b1.id && c.tickets === bt);
    check("名前も戻る", (await B.textContent("#main")).includes("べに"));
    check("持ち替えたあとのレビューが読める", await until(B, id => __sr.rplain[id] && JSON.stringify(__sr.rplain[id]).includes("色が見づらい"), r3));
    // パスキーのない端末で「パスキーで開く」を押しても、案内が出るだけ
    const C = await device();
    await C.click("[data-act=pk-open]"); await C.waitForTimeout(1200);
    check("パスキーがないときは、案内が出るだけ", (await C.textContent("#st-msg")).includes("開けませんでした") && !(await C.evaluate(() => __sr.me)));
    // 古いかぎを別の端末で使おうとしても、もう使えない
    const D = await device();
    await D.click("[data-act=show-key]"); await D.fill("#st-imp", oldSk); await D.click("[data-act=start-import]"); await D.waitForTimeout(1200);
    check("持ち替える前のかぎは「もう使われていません」になる", (await D.textContent("#main")).includes("もう使われていません") && (await st(D)).retired);
    check("横にはみ出さない", !(await B.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    if (process.env.SHOT) { await B.evaluate(() => __sr.act("me")); await B.waitForTimeout(300); await B.screenshot({path: process.env.SHOT}); await D.screenshot({path: process.env.SHOT.replace(".png", "-old.png")}); }
  } catch (x) { check("途中で止まった：" + x.message.split("\n")[0], false); }
  check("画面の中でエラーが起きない", errs.length === 0);
  console.log(log.join("\n")); if (errs.length) console.log("errors", errs);
  await b.close(); srv.close();
})();
