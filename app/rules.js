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
  };
  const GENRES = [
    {id: "use", name: "使い心地", min: 30, fields: ["確かめた環境", "迷った・止まった所", "よかった所", "直すとよい所"]},
    {id: "code", name: "コード", min: 45, fields: ["読んだ範囲", "危ない・わかりにくい所", "よかった所", "直し方の提案"]},
    {id: "text", name: "文章", min: 30, fields: ["読んだもの", "わかりにくい・言い過ぎの所", "よかった所", "直すとよい所"]},
    {id: "look", name: "見た目", min: 20, fields: ["見た環境", "気になった所", "よかった所", "直すとよい所"]},
    {id: "idea", name: "考え", min: 30, fields: ["読んだもの", "穴や心配な所", "よかった所", "提案"]},
  ];
  // 依頼する人の希望（だれに見てほしいか）。届いたレビューの券の数は、だれが書いても同じ1枚
  const WANTS = ["any", "human", "ai"];
  const gen = id => GENRES.find(g => g.id === id);

  function reduce(events, now) {
    // 未来の時刻をつけた出来事は数えない（時刻をずらして順番を横取りするのを防ぐ）
    const evs = events.filter(e => e.created_at <= now + R.futureSkew).slice().sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    const S = {users: {}, reqs: {}, links: {}, circles: {}, log: []};
    const pairs = new Set();    // 一度つながった持ち主どうし（同じ2人は1回だけ）
    const U = pk => S.users[pk] || (S.users[pk] = {pk, name: "", tickets: R.start, gave: 0, helped: 0, got: 0, judged: 0, judgedOk: 0, flaggedAsks: 0, flaggedReviews: 0, linked: 0, lastReviewed: null, joined: null});
    const holding = pk => Object.values(S.reqs).filter(r => r.status === "taken" && r.taker === pk).length;
    const live = r => r && !["cancelled", "hidden"].includes(r.status);
    const circleOf = id => Object.values(S.circles).find(c => c.reqs.includes(id));
    function tick(t) {   // 時間で決まる移り変わり
      for (const l of Object.values(S.links)) if (l.status === "pending" && t > l.at + R.linkDays * DAY) l.status = "expired";
      for (const r of Object.values(S.reqs)) {
        if (r.status === "taken" && t > r.takenAt + R.writeDays * DAY) { (r.lapsedBy = r.lapsedBy || []).push(r.taker); U(r.taker).lapses = (U(r.taker).lapses || 0) + 1; r.status = "open"; r.taker = null; r.lapsed = (r.lapsed || 0) + 1; }
        else if (r.status === "given" && t > r.givenAt + R.judgeDays * DAY) finish(r, true, r.givenAt + R.judgeDays * DAY, true);
      }
    }
    function finish(r, ok, t, auto) {
      r.status = "done"; r.ok = ok; r.doneAt = t; r.auto = !!auto;
      const tk = U(r.taker), by = U(r.by);
      tk.gave++; by.got++;
      // 役に立った → 券1枚。いまひとつ → 半券（0.5枚）。半券2枚で券1枚になる。危ない・ひどい内容として知らされたものは何もなし
      if (ok) { tk.tickets++; tk.helped++; } else if (!r.flaggedReview) { tk.tickets += 0.5; tk.halves = (tk.halves || 0) + 1; }
      if (!auto) { by.judged++; if (ok) by.judgedOk++; }
      tk.lastReviewed = r.by;
    }
    for (const e of evs) {
      let c; try { c = JSON.parse(e.content); } catch (x) { continue; }
      if (!c || typeof c !== "object") continue;
      tick(e.created_at);
      const u = U(e.pubkey); if (!u.joined) u.joined = e.created_at;
      const r = c.req && S.reqs[c.req];
      let ok = false;
      if (c.t === "hello" && typeof c.name === "string") { u.name = c.name.slice(0, 24); ok = true; }
      else if (c.t === "ask" && u.tickets >= 1 && gen(c.genre) && /^https:\/\/\S+$/.test(c.link || "") && (c.ask || "").trim()) {
        u.tickets--;
        S.reqs[e.id] = {id: e.id, by: e.pubkey, at: e.created_at, link: c.link.slice(0, 300), genre: c.genre, ask: String(c.ask).slice(0, 400), want: WANTS.includes(c.want) ? c.want : "any", aiName: String(c.aiName || "").slice(0, 60), status: "open", taker: null};
        ok = true;
      }
      else if (c.t === "cancel" && r && r.by === e.pubkey && r.status === "open") { r.status = "cancelled"; u.tickets++; ok = true; }
      else if (c.t === "take" && r && r.status === "open" && r.by !== e.pubkey && e.created_at >= r.at && U(r.by).lastReviewed !== e.pubkey
               && !(r.lapsedBy || []).includes(e.pubkey) && holding(e.pubkey) < (u.helped >= 1 ? R.holdMax : R.newHoldMax)) {
        r.status = "taken"; r.taker = e.pubkey; r.takenAt = e.created_at; ok = true;
      }
      else if (c.t === "release" && r && r.status === "taken" && r.taker === e.pubkey) { r.status = "open"; r.taker = null; ok = true; }
      else if (c.t === "give" && r && r.status === "taken" && r.taker === e.pubkey && c.body && typeof c.body === "object") {
        r.status = "given"; r.givenAt = e.created_at; r.used = String(c.used || "").slice(0, 60); r.body = c.body; r.reviewId = e.id; ok = true;
      }
      else if (c.t === "judge" && r && r.status === "given" && r.by === e.pubkey) { finish(r, !!c.ok, e.created_at); ok = true; }
      // つなぐ：「この依頼とこの依頼は合いそう」。提案できるのは「役に立った」をもらったことのある人で、どちらの持ち主でもない人
      else if (c.t === "link" && live(S.reqs[c.a]) && live(S.reqs[c.b]) && c.a !== c.b && u.helped >= 1) {
        const A = S.reqs[c.a], B = S.reqs[c.b], key = [A.by, B.by].sort().join(":");
        const ca = circleOf(A.id), cb = circleOf(B.id);
        if (A.by !== B.by && e.pubkey !== A.by && e.pubkey !== B.by && !pairs.has(key) && !(ca && ca === cb)) {
          S.links[e.id] = {id: e.id, by: e.pubkey, at: e.created_at, a: A.id, b: B.id, owners: [A.by, B.by], why: String(c.why || "").slice(0, 300), yes: [], status: "pending"};
          ok = true;
        }
      }
      // 受ける・断る：両方の持ち主が受けると成立。つないだ人に券が1枚入り、集まりができる（すでにあれば広がる）
      else if (c.t === "answer" && S.links[c.link] && S.links[c.link].status === "pending" && S.links[c.link].owners.includes(e.pubkey) && !S.links[c.link].yes.includes(e.pubkey)) {
        const l = S.links[c.link]; ok = true;
        if (!c.ok) l.status = "declined";
        else {
          l.yes.push(e.pubkey);
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
      else if (c.t === "made" && S.circles[c.circle] && S.circles[c.circle].status === "active" && S.circles[c.circle].members.includes(e.pubkey) && /^https:\/\/\S+$/.test(c.url || "")) {
        Object.assign(S.circles[c.circle], {status: "made", madeBy: e.pubkey, url: c.url.slice(0, 300), what: String(c.what || "").slice(0, 300), madeAt: e.created_at}); ok = true;
      }
      else if (c.t === "confirm" && S.circles[c.circle] && S.circles[c.circle].status === "made" && S.circles[c.circle].members.includes(e.pubkey) && S.circles[c.circle].madeBy !== e.pubkey) {
        Object.assign(S.circles[c.circle], {status: "complete", confirmedBy: e.pubkey, doneAt: e.created_at}); ok = true;
      }
      // 危ない依頼（悪意のあるアプリへの誘導など）：「役に立った」をもらったことのある人が R.hideFlags 人つけると、だれの画面からも消える。券は戻らない
      else if (c.t === "flag" && c.what === "ask" && r && r.by !== e.pubkey && u.helped >= 1 && ["open", "taken"].includes(r.status) && !(r.flags || []).includes(e.pubkey)) {
        (r.flags = r.flags || []).push(e.pubkey); ok = true;
        if (r.flags.length >= R.hideFlags) { r.status = "hidden"; r.taker = null; U(r.by).flaggedAsks++; }
      }
      // 危ない・ひどいレビュー：依頼した人がつける。券も半券も入らず、書いた人に印が残る
      else if (c.t === "flag" && c.what === "review" && r && r.status === "given" && r.by === e.pubkey) {
        r.flaggedReview = true; finish(r, false, e.created_at); U(r.taker).flaggedReviews++; ok = true;
      }
      S.log.push({id: e.id, pk: e.pubkey, at: e.created_at, t: c.t, req: c.req || (c.t === "ask" ? e.id : null), ok});
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

  const api = {reduce, contributions, R, GENRES, WANTS, gen, DAY};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Rules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
