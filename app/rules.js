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
    aiEarns: false,    // AIだけで書いたレビューで券が増えるか
  };
  const GENRES = [
    {id: "use", name: "使い心地", min: 30, fields: ["確かめた環境", "迷った・止まった所", "よかった所", "直すとよい所"]},
    {id: "code", name: "コード", min: 45, fields: ["読んだ範囲", "危ない・わかりにくい所", "よかった所", "直し方の提案"]},
    {id: "text", name: "文章", min: 30, fields: ["読んだもの", "わかりにくい・言い過ぎの所", "よかった所", "直すとよい所"]},
    {id: "look", name: "見た目", min: 20, fields: ["見た環境", "気になった所", "よかった所", "直すとよい所"]},
    {id: "idea", name: "考え", min: 30, fields: ["読んだもの", "穴や心配な所", "よかった所", "提案"]},
  ];
  const KINDS = ["人", "人+AI", "AI"];
  const gen = id => GENRES.find(g => g.id === id);

  function reduce(events, now) {
    const evs = events.slice().sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    const S = {users: {}, reqs: {}, log: []};
    const U = pk => S.users[pk] || (S.users[pk] = {pk, name: "", tickets: R.start, gave: 0, got: 0, lastReviewed: null, joined: null});
    const holding = pk => Object.values(S.reqs).filter(r => r.status === "taken" && r.taker === pk).length;
    function tick(t) {   // 時間で決まる移り変わり
      for (const r of Object.values(S.reqs)) {
        if (r.status === "taken" && t > r.takenAt + R.writeDays * DAY) { r.status = "open"; r.taker = null; r.lapsed = (r.lapsed || 0) + 1; }
        else if (r.status === "given" && t > r.givenAt + R.judgeDays * DAY) finish(r, true, r.givenAt + R.judgeDays * DAY, true);
      }
    }
    function finish(r, ok, t, auto) {
      r.status = "done"; r.ok = ok; r.doneAt = t; r.auto = !!auto;
      const tk = U(r.taker), by = U(r.by);
      tk.gave++; by.got++;
      if (ok && (r.kind !== "AI" || R.aiEarns)) tk.tickets++;
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
        S.reqs[e.id] = {id: e.id, by: e.pubkey, at: e.created_at, link: c.link.slice(0, 300), genre: c.genre, ask: String(c.ask).slice(0, 400), ai: c.ai !== false, status: "open", taker: null};
        ok = true;
      }
      else if (c.t === "cancel" && r && r.by === e.pubkey && r.status === "open") { r.status = "cancelled"; u.tickets++; ok = true; }
      else if (c.t === "take" && r && r.status === "open" && r.by !== e.pubkey && U(r.by).lastReviewed !== e.pubkey && holding(e.pubkey) < R.holdMax) {
        r.status = "taken"; r.taker = e.pubkey; r.takenAt = e.created_at; ok = true;
      }
      else if (c.t === "release" && r && r.status === "taken" && r.taker === e.pubkey) { r.status = "open"; r.taker = null; ok = true; }
      else if (c.t === "give" && r && r.status === "taken" && r.taker === e.pubkey && KINDS.includes(c.kind) && (r.ai || c.kind !== "AI") && c.body && typeof c.body === "object") {
        r.status = "given"; r.givenAt = e.created_at; r.kind = c.kind; r.body = c.body; r.reviewId = e.id; ok = true;
      }
      else if (c.t === "judge" && r && r.status === "given" && r.by === e.pubkey) { finish(r, !!c.ok, e.created_at); ok = true; }
      S.log.push({id: e.id, pk: e.pubkey, at: e.created_at, t: c.t, req: c.req || (c.t === "ask" ? e.id : null), ok});
    }
    tick(now);
    return S;
  }

  const api = {reduce, R, GENRES, KINDS, gen, DAY};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Rules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
