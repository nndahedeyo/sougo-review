// 画面を人と同じように操作して、全部の流れを確かめる（見本で動かす）。使い方: node tests/app.e2e.js 400
const { chromium } = require("playwright");
const path = require("path");
const W = parseInt(process.argv[2] || "400");
(async () => {
  const b = await chromium.launch(); const errs = [], log = [];
  const p = await (await b.newContext({viewport: {width: W, height: 860}, locale: "ja-JP"})).newPage();
  p.on("pageerror", e => errs.push(e.message));
  const check = (l, c) => { if (!c) process.exitCode = 1; log.push((c ? "OK  " : "NG  ") + l); };
  const until = (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, {timeout: ms}).then(() => true, () => false);
  const text = s => p.textContent(s);
  const back = async () => { await p.click("[data-act=back]"); await p.waitForTimeout(350); };
  const myTix = () => p.evaluate(() => __sr.S.users[__sr.me.pk].tickets);
  const lastMine = t => p.evaluate(t => { const e = JSON.parse(localStorage.getItem("sougo.demo")).filter(e => e.pubkey === __sr.me.pk && JSON.parse(e.content).t === t); return e.length ? e[e.length - 1].content : ""; }, t);

  try {
  await p.goto("file://" + path.resolve(__dirname, "..", "index.html") + "#demo");
  await p.fill("#nm", "テスト"); await p.click("[data-act=start]");
  await p.waitForSelector("#wallet"); await p.waitForTimeout(600);
  check("名前だけで始められ、券が1枚ある", (await text("#wallet")).includes("テスト") && (await text("#tix")).trim() === "1");
  check("待っている依頼の数が見える", (await text("#cnt")).includes("3件"));

  // ---- 公開で見てもらう（見てほしい所を2つ） ----
  await p.click("[data-act=ask]"); await p.waitForTimeout(300);
  check("公開のときは公開の注意が出る", (await text("#a-note")).includes("だれでも読めます") && await p.isHidden("#a-hint"));
  await p.click("[data-act=send-ask]");
  check("リンクがないと出せない", (await text("#a-msg")).includes("https"));
  await p.fill("#a-link", "https://example.com/my-app"); await p.fill("#a-ask", "最初の画面で迷わないか");
  await p.click('[data-chip=genres][data-v=look]'); await p.click('[data-chip=want][data-v=ai]'); await p.fill("#a-ai", "Claude");
  check("見てほしい所を複数選べる", (await p.$$('[data-chip=genres][aria-pressed=true]')).length === 2);
  await p.click("[data-act=send-ask]"); await p.waitForTimeout(300);
  check("出すと券が減る", (await myTix()) === 0);
  check("依頼に見てほしい所が2つ入る", await p.evaluate(() => Object.values(__sr.S.reqs).find(r => r.by === __sr.me.pk).genres.join() === "use,look"));
  check("見本の人が引き受けて届けてくれる", await until(() => /レビューが届きました/.test(document.querySelector("#lists").textContent)));
  check("あなたの番の件数が、画面の題名に出る", (await p.title()).startsWith("(1) 相互レビュー"));
  await p.click('.item[data-act=judge]'); await p.waitForTimeout(300);
  check("届いたレビューに、選んだ所ごとの欄と使ったAIが出る", (await text("#pbody")).includes("見た目で気になった所") && (await text("#pbody")).includes("Claude"));
  await p.click("[data-act=judge-ok]"); await p.waitForTimeout(300);
  check("役に立ったで完了", (await text("#lists")).includes("役に立った"));

  // ---- 見てあげる（非公開の依頼） ----
  await p.click("[data-act=give]"); await p.waitForTimeout(300);
  check("はじめての依頼の印と、開くときの注意が出る", (await text("#pbody")).includes("はじめての依頼") && (await text("#pbody")).includes("ウォレットをつながない"));
  check("直前に見てくれた人の依頼は回ってこない", await p.evaluate(() => !document.querySelector("#pbody").textContent.includes("ことね")));
  await p.click("[data-act=skip]"); await p.waitForTimeout(250);
  check("非公開の依頼は、ひとことだけが見え、中身もリンクも見えない", (await text("#pbody")).includes("非公開") && (await text("#pbody")).includes("天気アプリの通信まわり") && !(await text("#pbody")).includes("example.com"));
  check("中身を見ていない非公開の依頼は「危ない」にできない", !(await p.$("#pbody [data-act=flag-ask]")));
  const kreq = await p.evaluate(() => Object.values(__sr.S.reqs).find(r => r.private && r.by !== __sr.me.pk).id);
  await p.click("[data-act=take]"); await p.waitForTimeout(250);
  check("引き受けると、中身を待つ画面になる", !!(await p.$("#w-wait")) || !!(await p.$("#pbody [data-field]")));
  check("持ち主からかぎが届くと、中身とリンクが読める", await until(() => !!document.querySelector("#pbody [data-field]") && document.querySelector("#pbody").textContent.includes("エラー処理")));
  check("引き受けた人にだけかぎが渡る", await p.evaluate(id => Object.keys(__sr.S.reqs[id].shares).join() === __sr.me.pk, kreq));
  await p.click("[data-act=send-give]");
  check("中身が少ないと届けられない", (await text("#w-msg")).includes("2つ以上"));
  await p.fill("#w0", "Node 22 / 手元で実行"); await p.fill("#w1", "通信が切れたときの再試行がない"); await p.fill("#w3", "3回まで間をあけて試すとよい");
  await p.click("[data-act=send-give]"); await p.waitForTimeout(300);
  const g = await lastMine("give");
  check("非公開のレビューは閉じて届き、外からは読めない", g.includes("sealed") && !g.includes("再試行"));
  check("見てあげたレビューが役に立つと券が増える", await until(() => __sr.S.users[__sr.me.pk].tickets === 1));

  // ---- 非公開で見てもらう → 公開する ----
  await p.click("[data-act=ask]"); await p.waitForTimeout(300);
  await p.click('[data-chip=priv][data-v=priv]');
  check("非公開を選ぶと、ひとことの欄と、選ばれにくくなる知らせが出る", !(await p.isHidden("#a-hint")) && (await text("#a-note")).includes("引き受けてもらいにくく"));
  await p.fill("#a-link", "https://example.com/secret-app"); await p.fill("#a-ask", "まだ発表前の機能の使い心地");
  await p.click("[data-act=send-ask]");
  check("非公開はひとことがないと出せない", (await text("#a-msg")).includes("ひとこと"));
  await p.fill("#a-hint", "家計簿の新しい画面"); await p.click("[data-act=send-ask]"); await p.waitForTimeout(300);
  const a2 = await lastMine("ask");
  check("非公開の依頼は、リンクも見てほしい点も閉じて出る", a2.includes("sealed") && !a2.includes("secret-app") && !a2.includes("発表前"));
  check("自分の非公開の依頼は、自分には読める", await until(() => /家計簿の新しい画面|発表前/.test(document.querySelector("#lists").textContent)) && (await text("#lists")).includes("発表前"));
  check("引き受けた人に自動でかぎを渡し、閉じたレビューが届く", await until(() => /レビューが届きました/.test(document.querySelector("#lists").textContent), null, 20000));
  await p.click('.item[data-act=judge]'); await p.waitForTimeout(300);
  check("閉じたレビューを、依頼した自分は読める", await until(() => document.querySelector("#pbody").textContent.includes("見た環境・範囲")));
  await p.click("[data-act=judge-ok]"); await p.waitForTimeout(300);
  const mid = await p.evaluate(() => Object.values(__sr.S.reqs).find(r => r.by === __sr.me.pk && r.private).id);
  await p.evaluate(id => __sr.act("mine", id), mid); await p.waitForTimeout(300);
  check("非公開の依頼に「公開する」がある", !!(await p.$("#pbody [data-act=reveal]")));
  await p.click("[data-act=reveal]"); await p.waitForTimeout(300);
  check("公開すると、中身のかぎがだれでも使える形で出る", await p.evaluate(id => !!__sr.S.reqs[id].revealed && __sr.S.reqs[id].openKey.length === 64, mid));
  check("レビューは書いた人が許したときだけ公開される", await until(id => !!__sr.S.reqs[id].reviewKey, mid));
  check("外の人が公開したかぎで中身を開ける", await p.evaluate(async id => { const r = __sr.S.reqs[id]; if (!r.openKey || !r.reviewKey) return false; const o = await Seal.open(Seal.unhex(r.openKey), r.sealed, "ask:" + r.n); const v = await Seal.open(Seal.unhex(r.reviewKey), r.sealedReview, "review:" + r.id); return o && o.link.includes("secret-app") && v && !!v.body; }, mid));
  await back();

  // ---- つなぐ → 集まり → できた → 確かに ----
  await p.click("[data-act=give]"); await p.waitForTimeout(300);
  const un = await p.$("[data-act=unskip]"); if (un) { await un.click(); await p.waitForTimeout(200); }
  check("「役に立った」をもらうと、つなぐが出る", !!(await p.$("#pbody [data-act=linkfrom]")));
  await p.click("[data-act=linkfrom]"); await p.waitForTimeout(300);
  check("つなぐ相手は、自分がレビューを届けた依頼だけ", await p.evaluate(() => [...document.querySelectorAll("#pbody [data-act=pick]")].every(b => __sr.S.reqs[b.dataset.id].taker === __sr.me.pk)));
  await p.click("[data-act=send-link]");
  check("相手を選ばないと提案できない", (await text("#l-msg")).includes("選んで"));
  await p.click("[data-act=pick]"); await p.fill("#l-why", "どちらも初心者向け"); await p.click("[data-act=send-link]");
  const t0 = await myTix();
  check("両方が受けると、つないだ人に券1枚", await until(t => __sr.S.users[__sr.me.pk].tickets === t + 1, t0));
  check("集まりが出る", await until(() => /集まり/.test(document.querySelector("#lists").textContent)));
  await p.click(".item[data-act=circle]"); await p.waitForTimeout(300);
  check("集まりに貢献の記録が出る", (await text("#pbody")).includes("貢献の記録") && (await text("#pbody")).includes("つないだ 1"));
  await p.fill("#m-url", "https://example.com/together"); await p.fill("#m-what", "いっしょに直した版"); await p.click("[data-act=made]"); await p.waitForTimeout(200);
  check("ほかの仲間が確かめて完結する", await until(() => Object.values(__sr.S.circles).some(C => C.status === "complete")));
  await back();

  // ---- 保留 ----
  const seenId = kreq, otherId = await p.evaluate(() => Object.values(__sr.S.reqs).find(r => r.by !== __sr.me.pk && !r.private && !Object.values(__sr.S.circles).some(C => C.reqs.includes(r.id))).id);
  await p.evaluate(id => __sr.act("view", id), seenId); await p.waitForTimeout(300);
  await p.click("#pbody [data-act=watch]"); await p.waitForTimeout(150);
  check("保留すると外すボタンになる", (await text("#pbody")).includes("保留を外す"));
  await back();
  check("トップに保留が並ぶ", (await text("#lists")).includes("保留"));
  await p.evaluate(id => __sr.act("linkfrom", id), otherId); await p.waitForTimeout(300);
  check("つなぐ相手の一覧で、保留が上に出る", (await text("#pbody [data-act=pick]")).includes("保留"));
  await back();

  // ---- しくみ・記録・払って戻る ----
  await p.click("[data-act=how]"); await p.waitForTimeout(300);
  check("しくみが開き、試験版であることが書いてある", (await text("#pbody h2")) === "しくみ" && (await text("#pbody")).includes("公開と非公開") && (await text("#pbody")).includes("試験版です"));
  const box = await p.$("#panel");
  await p.evaluate(() => { const el = document.getElementById("panel"); const t = (type, x) => { const ev = new Event(type, {bubbles: true}); ev.touches = [{clientX: x, clientY: 300}]; el.dispatchEvent(ev); }; t("touchstart", 40); t("touchmove", 140); t("touchmove", 260); el.dispatchEvent(new Event("touchend", {bubbles: true})); });
  await p.waitForTimeout(400);
  check("横に払うと戻る", !(await p.evaluate(() => document.getElementById("panel").classList.contains("on"))));
  await p.click("[data-act=me]"); await p.waitForTimeout(300);
  check("自分の記録が見える", (await text("#pbody")).includes("見てあげた 2") || (await text("#pbody")).includes("見てあげた 1"));
  check("自分の出来事を件数つきでさかのぼれ、依頼を開ける", (await text("#pbody")).includes("あなたの出来事（") && !!(await p.$("#pbody .hist[data-act]")));
  await back();
  // ---- 紹介：券を贈る ----
  const to = await p.evaluate(() => Object.keys(__sr.S.users).find(k => k !== __sr.me.pk));
  const before = await myTix(), theirs = await p.evaluate(k => __sr.S.users[k].tickets, to);
  await p.click("[data-act=me]"); await p.waitForTimeout(300);
  check("番号と、券を贈る欄がある", !!(await p.$("#my-pk")) && !!(await p.$("#g-to")));
  await p.fill("#g-to", to); await p.click("[data-act=gift]");
  check("贈る前に、相手の名前でもう一度確かめる", (await text("#g-msg")).includes("もう一度押す"));
  await p.click("[data-act=gift]"); await p.waitForTimeout(300);
  check("券が1枚、相手に移る", (await myTix()) === before - 1 && (await p.evaluate(k => __sr.S.users[k].tickets, to)) === theirs + 1);
  check("横にはみ出さない", !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)));
  if (process.env.SHOT) { await p.screenshot({path: process.env.SHOT.replace(".png", "-top.png")}); await p.click("[data-act=ask]"); await p.waitForTimeout(350); await p.click('[data-chip=priv][data-v=priv]'); await p.screenshot({path: process.env.SHOT.replace(".png", "-ask.png")}); await back(); await p.click("[data-act=give]"); await p.waitForTimeout(350); await p.screenshot({path: process.env.SHOT.replace(".png", "-give.png")}); await back(); }
  check("閉じた中身の危ないリンク（https以外）は出さない", await p.evaluate(() => __sr.cleanAsk({link: "javascript:alert(1)", ask: "x"}).link === "" && __sr.cleanAsk({link: "https://a.example/b", ask: "x"}).link === "https://a.example/b"));
  check("閉じたレビューの中身は、文字だけに整える", await p.evaluate(() => { const v = __sr.cleanReview({body: {"a": {"x": 1}, "b": "<img src=x onerror=alert(1)>"}, used: 5}); return typeof v.body.a === "string" && v.used === "5"; }));
  check("画面の中でエラーが起きない", errs.length === 0);
  } catch (x) { check("途中で止まった：" + x.message.split("\n")[0], false); }
  console.log(log.join("\n")); if (errs.length) console.log("errors", errs);
  await b.close();
})();
