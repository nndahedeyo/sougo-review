// 英語の画面を確かめる：端末の言語が英語なら英語で出て、画面に日本語が残っていないこと。使い方: node tests/app.en.e2e.js 400
const { chromium } = require("playwright");
const path = require("path");
const W = parseInt(process.argv[2] || "400");
(async () => {
  const b = await chromium.launch(); const errs = [], log = [];
  const p = await (await b.newContext({viewport: {width: W, height: 860}, locale: "en-US"})).newPage();
  p.on("pageerror", e => errs.push(e.message));
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? "OK  " : "NG  ") + l); };
  const JA = /[぀-ヿ一-鿿]/;
  const noJa = async where => { const txt = await p.evaluate(() => document.body.innerText + [...document.querySelectorAll("[placeholder],[aria-label],[title]")].map(e => (e.placeholder || "") + (e.getAttribute("aria-label") || "") + (e.title || "")).join(" ")); const m = txt.match(new RegExp(".{0,12}" + JA.source + ".{0,12}")); check(`${where}に日本語が残っていない${m ? "：" + m[0] : ""}`, !m); };
  const back = async () => { await p.click("[data-act=back]"); await p.waitForTimeout(350); };
  try {
    await p.goto("file://" + path.resolve(__dirname, "..", "index.html") + "#demo");
    check("英語の端末では英語で出る", (await p.textContent("h1")) === "Mutual Review" && (await p.evaluate(() => document.documentElement.lang)) === "en");
    await noJa("はじめの画面");
    await p.fill("#nm", "Tester"); await p.click("[data-act=start]"); await p.waitForSelector("#wallet"); await p.waitForTimeout(800);
    await noJa("トップ");
    await p.click("[data-act=ask]"); await p.waitForTimeout(300); await p.click('[data-chip=priv][data-v=priv]'); await p.click('[data-chip=want][data-v=ai]'); await noJa("見てもらう");
    await p.fill("#a-link", "https://example.com/x"); await p.fill("#a-ask", "Is it clear?"); await p.click('[data-chip=priv][data-v=pub]'); await p.click("[data-act=send-ask]"); await p.waitForTimeout(300);
    check("英語でも依頼が出せる", await p.evaluate(() => Object.values(__sr.S.reqs).some(r => r.by === __sr.me.pk)));
    check("届いたレビューの欄が英語で出る", await p.waitForFunction(() => /A review arrived/.test(document.querySelector("#lists").textContent), null, {timeout: 15000}).then(() => true, () => false));
    await p.click('.item[data-act=judge]'); await p.waitForTimeout(300);
    check("欄の名前が英語", (await p.textContent("#pbody")).includes("Where & what you checked") && (await p.textContent("#pbody")).includes("Issues: Usability"));
    await noJa("届いたレビュー"); await p.click("[data-act=judge-ok]"); await p.waitForTimeout(300);
    await p.click("[data-act=give]"); await p.waitForTimeout(300); await noJa("見てあげる");
    await p.click("[data-act=take]"); await p.waitForTimeout(300); await noJa("レビューを書く"); await back();
    await p.click("[data-act=how]"); await p.waitForTimeout(300); await noJa("しくみ"); await back();
    await p.click("[data-act=me]"); await p.waitForTimeout(300); await noJa("記録とかぎ"); await back();
    check("横にはみ出さない", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
    if (process.env.SHOT) await p.screenshot({path: process.env.SHOT});
  } catch (x) { check("途中で止まった：" + x.message.split("\n")[0], false); }
  check("画面の中でエラーが起きない", errs.length === 0);
  console.log(log.join("\n")); if (errs.length) console.log("errors", errs);
  await b.close();
})();
