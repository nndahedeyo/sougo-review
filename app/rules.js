// 相互レビューの決まり。署名つきの出来事（イベント）の並びから、だれが計算しても同じ状態になる。
// 運営もサーバーもいない。決まりに合わない出来事は、どの画面でも同じように無視される。
"use strict";
(function (root) {
  const DAY = 86400;
  const R = {
    start: 1,          // 最初に配られる券
    holdMax: 2,        // 同時に引き受けられる数
    writeDays: 7,      // 引き受けてから届けるまで
    judgeDays: 7,      // 届いてから返事がなければ「役に立った」
    newHoldMax: 1,     // まだ1件も「役に立った」をもらっていない人が同時に引き受けられる数（引き受けて放置する嫌がらせを防ぐ）
    futureSkew: 600,   // 未来の時刻の出来事は、この秒数より先なら無視する
    linkDays: 14,      // つなぎの提案に返事がなければ、この日数で消える
    hideFlags: 2,      // 「危ない」がこの人数（見てあげた実績のある人）から付いた依頼は、だれの画面からも消える
    starterUntil: 1798729200,   // 最初の券を配るのは、この時刻（2027-01-01 00:00 日本時間）までに始めた人だけ。以後は見てあげるか、贈ってもらって始める
    borrow: false,     // 保険：券が足りなくなったときだけ有効にする。待っている依頼が1件もないとき、券のない人が1件だけ借りて出せる
  };
  // 期限のあとに、期限までに始めた人の一覧（ビットコインに刻んだ記録から作る）を固めて入れる。null のあいだは時刻で判断する
  // （時刻は出した人の端末の時計なので、期限のあとは、さかのぼった時刻で最初の券を取るのをこの一覧で防ぐ）
  const STARTERS = null;
  // いまは個人開発のアプリとホームページに絞る。種類を広げるときは、ここに1行足す。見てほしい所は複数選べる
  const GENRES = [
    {id: "use", name: "使い心地", min: 30},
    {id: "code", name: "コード", min: 45},
    {id: "text", name: "文章", min: 30},
    {id: "look", name: "見た目", min: 20},
    {id: "play", name: "遊び心地", min: 30},   // ゲーム：面白さ・難しさ・操作の気持ちよさ・続けたくなるか
  ];
  // 依頼する人の希望（だれに見てほしいか）。届いたレビューの券の数は、だれが書いても同じ1枚
  const WANTS = ["any", "human", "ai"];
  const gen = id => GENRES.find(g => g.id === id);
  const genresOf = c => { const a = Array.isArray(c.genres) ? c.genres : [c.genre]; return GENRES.map(g => g.id).filter(id => a.includes(id)); };
  const minutes = gs => gs.length ? Math.max(...gs.map(id => gen(id).min)) + 10 * (gs.length - 1) : 0;
  // レビューの欄は言語によらない記号で残す（env：見た環境・範囲、g:種類：その所で気になった所、good：よかった所、fix：直すとよい所）
  const fields = gs => ["env", ...gs.map(id => `g:${id}`), "good", "fix"];
  const isHex = (s, n) => typeof s === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(s);
  const isSealed = s => typeof s === "string" && s.length < 6000 && /^1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(s);

  // resolve(かぎ, 時刻)：そのかぎの持ち主のアカウント番号（共通のアカウントを使うとき）。なければ、かぎの番号のまま数える
  function reduce(events, now, resolve) {
    // 未来の時刻をつけた出来事は数えない（時刻をずらして順番を横取りするのを防ぐ）
    const evs = events.filter(e => e.created_at <= now + R.futureSkew).slice().sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    const S = {users: {}, reqs: {}, links: {}, circles: {}, log: []};
    const pairs = new Set();    // 一度つながった持ち主どうし（同じ2人は1回だけ）
    const U = pk => S.users[pk] || (S.users[pk] = {pk, name: "", tickets: 0, starter: false, gifted: 0, gotGift: 0, gave: 0, helped: 0, got: 0, judged: 0, judgedOk: 0, flaggedAsks: 0, flaggedReviews: 0, linked: 0, lastReviewed: null, joined: null});
    const holding = pk => Object.values(S.reqs).filter(r => r.status === "taken" && r.taker === pk).length;
    const live = r => r && !["cancelled", "hidden"].includes(r.status);
    // 保険の借り：有効なときだけ。券が1枚未満で借りがなく、待っている依頼がどこにもないとき。券は負になり、次にもらう券で返る
    const canBorrow = u => R.borrow && u.tickets >= 0 && u.tickets < 1 && !Object.values(S.reqs).some(r => r.status === "open");
    const circleOf = id => Object.values(S.circles).find(c => c.reqs.includes(id));
    function tick(t) {   // 時間で決まる移り変わり
      for (const l of Object.values(S.links)) if (l.status === "pending" && t > l.at + R.linkDays * DAY) l.status = "expired";
      for (const r of Object.values(S.reqs)) {
        // 非公開で、持ち主から中身のかぎが届かないまま期限が来たら、引き受けた人に印をつけずに戻す
        if (r.status === "taken" && r.private && !r.shares[r.taker]) { if (t > r.takenAt + R.writeDays * DAY) { r.status = "open"; r.taker = null; } }
        else if (r.status === "taken" && t > (r.private ? r.sharedAt : r.takenAt) + R.writeDays * DAY) { (r.lapsedBy = r.lapsedBy || []).push(r.taker); U(r.taker).lapses = (U(r.taker).lapses || 0) + 1; r.status = "open"; r.taker = null; r.lapsed = (r.lapsed || 0) + 1; }
        else if (r.status === "given" && t > r.givenAt + R.judgeDays * DAY) finish(r, true, r.givenAt + R.judgeDays * DAY, true);
      }
    }
    function finish(r, ok, t, auto) {
      r.status = "done"; r.ok = ok; r.doneAt = t; r.auto = !!auto;
      const tk = U(r.taker), by = U(r.by);
      tk.gave++; by.got++;
      // 券は依頼のときに1枚なくなり、返事のときに新しく出る（譲り渡しではない）。
      // 役に立った → 書いた人に券1枚。いまひとつ → 書いた人と依頼した人に半券ずつ（半券2枚で券1枚）。
      // 危ない・ひどいレビュー → 書いた人には何もなし、依頼した人には半券（いまひとつと同じ。返事の選び方が券で左右されないように）
      if (ok) { tk.tickets++; tk.helped++; }
      else { by.tickets += 0.5; by.halfBack = (by.halfBack || 0) + 1; if (!r.flaggedReview) { tk.tickets += 0.5; tk.halves = (tk.halves || 0) + 1; } }
      if (!auto) { by.judged++; if (ok) by.judgedOk++; }
      tk.lastReviewed = r.by;
    }
    for (const e of evs) {
      let c; try { c = JSON.parse(e.content); } catch (x) { continue; }
      if (!c || typeof c !== "object") continue;
      tick(e.created_at);
      const signer = e.pubkey, who = (resolve && resolve(signer, e.created_at)) || signer;   // かぎが替わっても同じ人として数える
      const u = U(who);
      if (!u.joined) { u.joined = e.created_at; if (e.created_at <= R.starterUntil && (!STARTERS || STARTERS.includes(who))) { u.starter = true; u.tickets += R.start; } }
      const r = c.req && S.reqs[c.req];
      let ok = false;
      if (c.t === "hello" && typeof c.name === "string") { u.name = c.name.slice(0, 24); ok = true; }
      // 紹介：「役に立った」をもらったことのある人が、自分の券を1枚、ほかの人に贈る（券は増えない）
      else if (c.t === "gift" && isHex(c.to, 64) && c.to !== who && u.helped >= 1 && u.tickets >= 1) { u.tickets--; u.gifted++; const v = U(c.to); v.tickets++; v.gotGift++; ok = true; }
      else if (c.t === "ask" && (u.tickets >= 1 || canBorrow(u)) && genresOf(c).length && (c.private === true
                 ? isSealed(c.sealed) && isHex(c.n, 32) && String(c.hint || "").trim()
                 : /^https:\/\/\S+$/.test(c.link || "") && String(c.ask || "").trim())) {
        u.tickets--;
        const base = {id: e.id, by: who, at: e.created_at, genres: genresOf(c), want: WANTS.includes(c.want) ? c.want : "any", aiName: String(c.aiName || "").slice(0, 60), status: "open", taker: null};
        S.reqs[e.id] = c.private === true
          ? {...base, byKey: signer, private: true, hint: String(c.hint).trim().slice(0, 80), sealed: c.sealed, n: c.n, shares: {}, link: "", ask: ""}
          : {...base, byKey: signer, private: false, link: c.link.slice(0, 300), ask: String(c.ask).slice(0, 400)};
        ok = true;
      }
      // 取り下げ：待っている依頼だけ。集まりに入った依頼は、取り下げても券は戻らない
      // （依頼を出す→つないでもらう→取り下げて券を戻す、をくり返して、つないだ人の券を作り出すのを防ぐ）
      else if (c.t === "cancel" && r && r.by === who && r.status === "open") { r.status = "cancelled"; if (!circleOf(r.id)) u.tickets++; else r.noRefund = true; ok = true; }
      else if (c.t === "take" && r && r.status === "open" && r.by !== who && e.created_at >= r.at && U(r.by).lastReviewed !== who
               && !(r.lapsedBy || []).includes(who) && holding(who) < (u.helped >= 1 ? R.holdMax : R.newHoldMax)) {
        r.status = "taken"; r.taker = who; r.takerKey = signer; r.takenAt = e.created_at; r.sharedAt = null; ok = true;
      }
      // 非公開：持ち主が、引き受けた人だけに中身のかぎを渡す（ふたりのかぎで包んである）
      else if (c.t === "share" && r && r.private && r.by === who && r.status === "taken" && c.to === r.taker && !r.shares[c.to] && isSealed(c.key)) {
        r.shares[c.to] = c.key; (r.shareFrom = r.shareFrom || {})[c.to] = signer; r.sharedAt = e.created_at; ok = true;
      }
      // 非公開の依頼を公開する（持ち主だけ）。中身のかぎをそのまま出す
      else if (c.t === "reveal" && r && r.private && r.by === who && !r.revealed && live(r) && isHex(c.key, 64)) { r.revealed = true; r.openKey = c.key; ok = true; }
      // 非公開のレビューを公開する（書いた人だけ。依頼が公開されたあと）
      else if (c.t === "open-review" && r && r.private && r.revealed && r.taker === who && r.sealedReview && !r.reviewKey && isHex(c.key, 64)) { r.reviewKey = c.key; ok = true; }
      else if (c.t === "release" && r && r.status === "taken" && r.taker === who) { r.status = "open"; r.taker = null; ok = true; }
      else if (c.t === "give" && r && r.status === "taken" && r.taker === who
               && (r.private ? r.shares[who] && isSealed(c.sealed) && isSealed(c.keyFor) : c.body && typeof c.body === "object")) {
        r.status = "given"; r.givenAt = e.created_at; r.reviewId = e.id; ok = true;
        if (r.private) { r.sealedReview = c.sealed; r.keyFor = c.keyFor; r.giveKey = signer; r.giveTo = isHex(c.to, 64) ? c.to : r.byKey; r.body = null; r.used = ""; }
        else { r.used = String(c.used || "").slice(0, 60); r.body = c.body; }
      }
      else if (c.t === "judge" && r && r.status === "given" && r.by === who) { finish(r, !!c.ok, e.created_at); ok = true; }
      // つなぐ：「この依頼とこの依頼は合いそう」。提案できるのは「役に立った」をもらったことのある人で、どちらの持ち主でもない人。
      // 2つのうち少なくとも1つは、自分がレビューを届けたことのある依頼（中身をよく知っている人がつなぐ）
      else if (c.t === "link" && live(S.reqs[c.a]) && live(S.reqs[c.b]) && c.a !== c.b && u.helped >= 1 && (seen(S.reqs[c.a], who) || seen(S.reqs[c.b], who))) {
        const A = S.reqs[c.a], B = S.reqs[c.b], key = [A.by, B.by].sort().join(":");
        const ca = circleOf(A.id), cb = circleOf(B.id);
        if (A.by !== B.by && who !== A.by && who !== B.by && !pairs.has(key) && !(ca && ca === cb)) {
          S.links[e.id] = {id: e.id, by: who, at: e.created_at, a: A.id, b: B.id, owners: [A.by, B.by], why: String(c.why || "").slice(0, 300), yes: [], status: "pending"};
          ok = true;
        }
      }
      // 受ける・断る：両方の持ち主が受けると成立。つないだ人に券が1枚入り、集まりができる（すでにあれば広がる）
      else if (c.t === "answer" && S.links[c.link] && S.links[c.link].status === "pending" && S.links[c.link].owners.includes(who) && !S.links[c.link].yes.includes(who)) {
        const l = S.links[c.link]; ok = true;
        if (!c.ok) l.status = "declined";
        else {
          l.yes.push(who);
          if (l.yes.length === 2) {
            const key = l.owners.slice().sort().join(":");
            if (pairs.has(key)) l.status = "expired";
            else {
              pairs.add(key); l.status = "joined"; l.joinedAt = e.created_at;
              const p = U(l.by); p.tickets++; p.linked++;
              let ca = circleOf(l.a), cb = circleOf(l.b);
              if (!ca && !cb) { ca = S.circles[l.id] = {id: l.id, at: e.created_at, reqs: [], members: [], links: [], status: "active"}; }
              const C = ca || cb;
              if (ca && cb && ca !== cb) { for (const x of cb.reqs) C.reqs.includes(x) || C.reqs.push(x); for (const x of cb.members) C.members.includes(x) || C.members.push(x); C.links.push(...cb.links); delete S.circles[cb.id]; }
              for (const x of [l.a, l.b]) C.reqs.includes(x) || C.reqs.push(x);
              for (const x of [...l.owners, l.by]) C.members.includes(x) || C.members.push(x);
              C.links.push(l.id);
            }
          }
        }
      }
      // できた：集まりの仲間が、形になったもののリンクを出す。別の仲間が1人「確かに」と押せば完結
      else if (c.t === "made" && S.circles[c.circle] && S.circles[c.circle].status === "active" && S.circles[c.circle].members.includes(who) && /^https:\/\/\S+$/.test(c.url || "")) {
        Object.assign(S.circles[c.circle], {status: "made", madeBy: who, url: c.url.slice(0, 300), what: String(c.what || "").slice(0, 300), madeAt: e.created_at}); ok = true;
      }
      else if (c.t === "confirm" && S.circles[c.circle] && S.circles[c.circle].status === "made" && S.circles[c.circle].members.includes(who) && S.circles[c.circle].madeBy !== who) {
        Object.assign(S.circles[c.circle], {status: "complete", confirmedBy: who, doneAt: e.created_at}); ok = true;
      }
      // 危ない依頼（悪意のあるアプリへの誘導など）：「役に立った」をもらったことのある人が R.hideFlags 人つけると、だれの画面からも消える。券は戻らない
      // 非公開の依頼は中身を見られるのが引き受けた人だけなので、知らせられるのは、かぎを受け取った人（実績のある人）。
      // 公開と同じく R.hideFlags 人そろって消える。知らせた人が引き受け中なら手放したことにして、ほかの人が確かめられるようにする
      else if (c.t === "flag" && c.what === "ask" && r && r.by !== who && u.helped >= 1 && ["open", "taken"].includes(r.status) && !(r.flags || []).includes(who)
               && (!r.private || r.revealed || r.shares[who])) {
        (r.flags = r.flags || []).push(who); ok = true;
        if (r.status === "taken" && r.taker === who) { r.status = "open"; r.taker = null; }
        if (r.flags.length >= R.hideFlags) { r.status = "hidden"; r.taker = null; U(r.by).flaggedAsks++; }
      }
      // 危ない・ひどいレビュー：依頼した人がつける。券も半券も入らず、書いた人に印が残る
      else if (c.t === "flag" && c.what === "review" && r && r.status === "given" && r.by === who) {
        r.flaggedReview = true; finish(r, false, e.created_at); U(r.taker).flaggedReviews++; ok = true;
      }
      S.log.push({id: e.id, pk: who, at: e.created_at, t: c.t, req: c.req || (c.t === "ask" ? e.id : null), ok});
    }
    tick(now);
    return S;
  }

  // 集まりの貢献の記録：だれが、どの依頼を出し、どれを見て、どれをつないだか
  function contributions(S, cid) {
    const C = S.circles[cid]; if (!C) return [];
    const by = {};
    const add = (pk, k) => { (by[pk] = by[pk] || {pk, asked: 0, reviewed: 0, linked: 0, made: 0})[k]++; };
    for (const id of C.reqs) { const r = S.reqs[id]; if (!r) continue; add(r.by, "asked"); if (r.status === "done" && r.taker) add(r.taker, "reviewed"); }
    for (const id of C.links) { const l = S.links[id]; if (l) add(l.by, "linked"); }
    if (C.madeBy) add(C.madeBy, "made");
    return Object.values(by);
  }

  // pk がレビューを届けたことのある依頼か（つなぐの条件）
  const seen = (r, pk) => !!r && r.taker === pk && ["given", "done"].includes(r.status);
  const api = {STARTERS, seen, reduce, contributions, R, GENRES, WANTS, gen, genresOf, minutes, fields, DAY};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Rules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
