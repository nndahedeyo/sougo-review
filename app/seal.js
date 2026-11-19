// 非公開のための暗号（AES-GCM 256 / WebCrypto）。かぎはすべて、その人のかぎから作り直せる。
// - 依頼の中身：持ち主のかぎ＋依頼ごとの乱数から作る「中身のかぎ」で閉じる
// - 中身のかぎを渡す：持ち主と引き受けた人の「ふたりのかぎ」（ECDH）で包んで渡す
// - レビュー：レビューごとの乱数のかぎで閉じ、そのかぎを「ふたりのかぎ」で包む
// - 公開するとき：中身のかぎ（またはレビューのかぎ）をそのまま出す
"use strict";
(function (root) {
  const Sig = root.Sig || require("./sig.js");
  const C = (root.crypto && root.crypto.subtle) ? root.crypto : require("crypto").webcrypto;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const cat = (...a) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const b64 = u => { let s = ""; for (const x of u) s += String.fromCharCode(x); return (root.btoa ? root.btoa(s) : Buffer.from(s, "binary").toString("base64")); };
  const unb64 = s => { const b = root.atob ? root.atob(s) : Buffer.from(s, "base64").toString("binary"); return Uint8Array.from(b, c => c.charCodeAt(0)); };
  const rand = n => C.getRandomValues(new Uint8Array(n));
  const derive = (label, ...parts) => Sig.sha(cat(enc.encode("sougo/" + label), ...parts));
  const contentKey = (skHex, nonceHex) => derive("content", Sig.unhex(skHex), Sig.unhex(nonceHex));
  const pairKey = (skHex, pkHex) => derive("pair", Sig.shared(skHex, pkHex));
  async function seal(key, obj, ad) {
    const k = await C.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]), iv = rand(12);
    const ct = new Uint8Array(await C.subtle.encrypt({name: "AES-GCM", iv, additionalData: enc.encode(ad)}, k, enc.encode(JSON.stringify(obj))));
    return "1:" + b64(iv) + ":" + b64(ct);
  }
  async function open(key, str, ad) {
    try {
      const [v, iv, ct] = String(str).split(":"); if (v !== "1") return null;
      const k = await C.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
      return JSON.parse(dec.decode(await C.subtle.decrypt({name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(ad)}, k, unb64(ct))));
    } catch (e) { return null; }
  }
  const api = {seal, open, contentKey, pairKey, rand, hex: Sig.hex, unhex: Sig.unhex};
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Seal = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
