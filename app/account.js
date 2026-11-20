// アカウント（がまぐちにあたる部分、jeni のプロフィールカード）の決まり。
// 署名つきの出来事の並びから、だれが計算しても同じ「アカウントの今」になる。運営もサーバーもいない。
//
// - アカウントの番号は、はじめに使ったかぎの番号（ずっと変わらない）
// - いま使うかぎは「持ち替え」や「取り戻し」で変わる
// - 名前（@なまえ）は早い者勝ちで1つのアカウントに1つ。名前で送り先を探せる
// - 信頼できる人を決めておくと、かぎをなくしても、その人たちの承認で新しいかぎに取り戻せる。
//   取り戻しは承認がそろってから3日待って効く。そのあいだに今のかぎで取り消せる（信頼した人が勝手に乗っ取れないように）
// - かぎを盗まれたとき：盗んだ人は信頼できる人をすぐには替えられない（替えるのは3日後に効く。そのあいだは前の人たちで取り戻せる）。
//   信頼できる人（2人以上）が「全員」承認した取り戻しは、今のかぎでも取り消せない（盗んだ人に取り消されないように）。
//   承認がそろった時点で、待っている「信頼できる人の替え」は取りやめになる
// - 名前（@なまえ）はあとからでも決められる（相互レビューのように呼び名だけで始める場所があるため）
"use strict";
(function (root) {
  const DAY = 86400;
  const R = {wait: 3 * DAY, futureSkew: 600, maxGuardians: 5, askDays: 30};
  const KIND = 7720, TAG = "kasou-account";
  const HANDLE = /^[a-z0-9][a-z0-9-]{1,19}$/;
  const isHex = (s, n) => typeof s === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(s);
  const str = (v, n) => String(v == null ? "" : v).slice(0, n);
  const links = v => (Array.isArray(v) ? v : []).filter(u => /^https:\/\/\S+$/.test(String(u))).slice(0, 5).map(u => str(u, 200));

  function reduce(events, now) {
    const evs = events.filter(e => e.created_at <= now + R.futureSkew).slice().sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
    const S = {accounts: {}, byHandle: {}, byKey: {}, log: []};
    const used = new Set();   // 一度でも使われたかぎ（使い回させない）
    function setKey(A, k, t, why) {
      delete S.byKey[A.key]; A.key = k; S.byKey[k] = A.id; used.add(k);
      A.keys.push({key: k, at: t, why}); A.recovery = {};
    }
    function tick(t) {
      for (const A of Object.values(S.accounts)) if (A.pendingGuard && t >= A.pendingGuard.at + R.wait) {
        A.guard = {list: A.pendingGuard.list, need: A.pendingGuard.need}; A.pendingGuard = null; A.recovery = {};
      }
      for (const A of Object.values(S.accounts)) for (const [to, r] of Object.entries(A.recovery)) {
        if (r.since != null && t >= r.since + R.wait && !used.has(to)) { setKey(A, to, r.since + R.wait, "recover"); break; }
        else if (r.since == null && t > r.at + R.askDays * DAY) delete A.recovery[to];   // 頼んだまま承認がそろわなければ消える
      }
    }
    for (const e of evs) {
      let c; try { c = JSON.parse(e.content); } catch (x) { continue; }
      if (!c || typeof c !== "object") continue;
      tick(e.created_at);
      const me = S.byKey[e.pubkey] && S.accounts[S.byKey[e.pubkey]];
      let ok = false;
      if (c.t === "open" && !me && !used.has(e.pubkey) && (c.handle == null || c.handle === "" || (HANDLE.test(c.handle) && !S.byHandle[c.handle]))) {
        const A = S.accounts[e.pubkey] = {id: e.pubkey, handle: c.handle || "", display: str(c.display, 24), line: str(c.line, 80), links: links(c.links),
          key: null, keys: [], guard: {list: [], need: 0}, pendingGuard: null, recovery: {}, at: e.created_at};
        if (A.handle) S.byHandle[A.handle] = A.id;
        setKey(A, e.pubkey, e.created_at, "open"); ok = true;
      }
      // 名前をあとから決める（まだ名前のないアカウントだけ。決めた名前は変えられない）
      else if (c.t === "name" && me && !me.handle && HANDLE.test(c.handle || "") && !S.byHandle[c.handle]) { me.handle = c.handle; S.byHandle[c.handle] = me.id; ok = true; }
      else if (c.t === "card" && me) {
        if ("display" in c) me.display = str(c.display, 24);
        if ("line" in c) me.line = str(c.line, 80);
        if ("links" in c) me.links = links(c.links);
        ok = true;
      }
      // 信頼できる人：ほかのアカウントの番号を1〜5人、そのうち何人の承認で取り戻せるか
      else if (c.t === "guard" && me && Array.isArray(c.list)) {
        const list = [...new Set(c.list)].filter(id => S.accounts[id] && id !== me.id).slice(0, R.maxGuardians);
        const need = Math.floor(Number(c.need));
        if (list.length === c.list.length && (list.length === 0 || (need >= 1 && need <= list.length))) {
          const g = {list, need: list.length ? need : 0};
          // まだだれもいないときはすぐ決まる。替えるときは3日後に効く（盗んだ人がすぐ自分の仲間に替えられないように）
          if (!me.guard.list.length) { me.guard = g; me.pendingGuard = null; me.recovery = {}; } else me.pendingGuard = {...g, at: e.created_at};
          ok = true;
        }
      }
      // 持ち替え：今のかぎで、新しいかぎに替える（端末を替えるとき）
      else if (c.t === "rotate" && me && isHex(c.to, 64) && !used.has(c.to) && !S.byKey[c.to]) { setKey(me, c.to, e.created_at, "rotate"); ok = true; }
      // 取り戻しを頼む：新しいかぎで「このアカウントを取り戻したい」と出す
      else if (c.t === "ask" && !me && !used.has(e.pubkey) && S.accounts[c.account] && S.accounts[c.account].guard.list.length) {
        const A = S.accounts[c.account];
        if (!A.recovery[e.pubkey]) { A.recovery[e.pubkey] = {at: e.created_at, ok: [], since: null}; ok = true; }
      }
      // 承認：信頼できる人（のアカウントの今のかぎ）が、頼まれた取り戻しを認める
      else if (c.t === "approve" && me && S.accounts[c.account] && isHex(c.to, 64)) {
        const A = S.accounts[c.account], r = A.recovery[c.to];
        if (r && A.guard.list.includes(me.id) && !r.ok.includes(me.id)) {
          r.ok.push(me.id); ok = true;
          // 承認がそろった：待っている「信頼できる人の替え」は取りやめる（盗んだ人の替えより、今の信頼できる人を優先する）
          if (r.since == null && r.ok.length >= A.guard.need) { r.since = e.created_at; A.pendingGuard = null; }
          // 2人以上の全員が承認：今のかぎでも取り消せない（1人だけの承認で乗っ取れないよう、2人以上のとき）
          if (A.guard.list.length >= 2 && r.ok.length === A.guard.list.length) r.all = true;
        }
      }
      // 取り消し：今のかぎを持っている本人が、頼まれている取り戻しを止める
      else if (c.t === "cancel" && me && isHex(c.to, 64) && me.recovery[c.to] && !me.recovery[c.to].all) { delete me.recovery[c.to]; ok = true; }
      S.log.push({id: e.id, pk: e.pubkey, at: e.created_at, t: c.t, ok, account: (me && me.id) || c.account || (c.t === "open" ? e.pubkey : null)});
    }
    tick(now);
    return S;
  }
  // ある時刻に、そのかぎがどのアカウントのかぎだったか（相互レビューなどが、かぎが替わっても同じ人として数えるため）
  function ownerAt(S, pk, t) {
    for (const A of Object.values(S.accounts)) for (let i = 0; i < A.keys.length; i++)
      if (A.keys[i].key === pk && t >= A.keys[i].at && (i + 1 >= A.keys.length || t < A.keys[i + 1].at)) return A.id;
    return null;
  }
  // 何度も引くとき用（相互レビューの出来事を1つずつ数えるとき）。使われなくなったかぎで出したものは、だれのものにもしない
  // （持ち替え・取り戻しのあとに、古いかぎや盗まれたかぎで出したものが、アカウントの分として数えられないように）
  function resolver(S) {
    const idx = {};
    for (const A of Object.values(S.accounts)) A.keys.forEach((k, i) => (idx[k.key] = idx[k.key] || []).push({id: A.id, from: k.at, to: i + 1 < A.keys.length ? A.keys[i + 1].at : Infinity}));
    return (pk, t) => { const xs = idx[pk]; if (!xs) return null;
      for (const x of xs) if (t >= x.from && t < x.to) return x.id;
      return t >= xs[0].from ? "retired:" + pk : null; };
  }
  const byHandle = (S, h) => S.byHandle[String(h || "").replace(/^@/, "").toLowerCase()] ? S.accounts[S.byHandle[String(h).replace(/^@/, "").toLowerCase()]] : null;
  const api = {reduce, byHandle, ownerAt, resolver, R, KIND, TAG, HANDLE, DAY};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Account = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
