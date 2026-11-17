// 署名の正しさを、BIP340の公式の試験ベクトル（bitcoin/bips）で確かめる。使い方: node tests/sig.test.js
const fs = require("fs"), path = require("path");
const S = require("../app/sig.js");
(async () => {
  const rows = fs.readFileSync(path.join(__dirname, "bip340-vectors.csv"), "utf8").trim().split("\n").slice(1).map(l => l.split(","));
  let bad = 0;
  for (const [i, sk, pk, aux, msg, sig, ok] of rows) {
    const m = S.unhex(msg);
    if (sk) {
      const got = S.hex(await S.sign(m, S.unhex(sk), S.unhex(aux))).toUpperCase();
      if (got !== sig) { bad++; console.log("署名が違う", i); }
      if (S.hex(S.pubkey(S.unhex(sk))).toUpperCase() !== pk) { bad++; console.log("公開鍵が違う", i); }
    }
    const v = await S.verify(m, S.unhex(pk), S.unhex(sig));
    if (v !== (ok === "TRUE")) { bad++; console.log("確認が違う", i, v, ok); }
  }
  const k = S.newKey(), ev = await S.signEvent({kind: 7710, content: "テスト", tags: [["t", "x"]]}, k);
  if (!(await S.verifyEvent(ev))) { bad++; console.log("イベントの署名が通らない"); }
  ev.content = "書き換え"; if (await S.verifyEvent(ev)) { bad++; console.log("書き換えを見抜けない"); }
  console.log(bad ? `NG ${bad}件` : `OK 試験ベクトル${rows.length}件とイベントの署名`); if (bad) process.exitCode = 1;
})();
