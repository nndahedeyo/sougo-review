"""毎日1回、相互レビューのすべての出来事をビットコインに刻む（OpenTimestamps、無料）。

1. 中継（Nostrのリレー）から、相互レビューの出来事をすべて集める
2. まだ刻んでいない出来事の番号（イベントID）を、その日のファイル stamps/YYYY-MM-DD.txt に書く
3. そのファイルを `ots stamp` で刻む（証明書 .ots ができる。ビットコインに入るまで数時間かかる）
4. 前に刻んだ証明書を `ots upgrade` で完成させる

ある出来事が、その日より前に存在したことは「その日のファイルにその番号がある」＋「.ots の証明」で、だれでも確かめられる。
イベントIDは出来事の中身の指紋（SHA-256）なので、中身を1文字でも変えると番号が変わる。
"""
import asyncio
import datetime as dt
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "stamps"
RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.nostr.band"]
# 相互レビューの出来事と、共通のアカウント（パスキー・持ち替え・取り戻し）の出来事
FILTERS = [{"kinds": [7710], "#t": ["sougo-review"]}, {"kinds": [7720], "#t": ["kasou-account"]}]


def event_id(ev):
    s = json.dumps([0, ev["pubkey"], ev["created_at"], ev["kind"], ev["tags"], ev["content"]], separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(s.encode()).hexdigest()


async def fetch(url, found):
    ok = True
    for flt in FILTERS:
        ok = await fetch_one(url, found, flt) and ok
    return ok


async def fetch_one(url, found, FILTER):
    try:
        async with websockets.connect(url, open_timeout=15, close_timeout=5, max_size=2 ** 23) as ws:
            until, page = None, 0
            while page < 60:
                f = dict(FILTER, limit=500)
                if until:
                    f["until"] = until
                sub = f"s{page}"
                await ws.send(json.dumps(["REQ", sub, f]))
                n, oldest = 0, None
                while True:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                    if msg[0] == "EVENT" and msg[1] == sub:
                        ev = msg[2]
                        if isinstance(ev, dict) and ev.get("id") == event_id(ev):   # 中身と番号が合うものだけ
                            found[ev["id"]] = ev["created_at"]
                            n += 1
                            oldest = ev["created_at"] if oldest is None else min(oldest, ev["created_at"])
                    elif msg[0] in ("EOSE", "CLOSED") and msg[1] == sub:
                        break
                await ws.send(json.dumps(["CLOSE", sub]))
                if n < 500 or oldest is None:
                    return True
                until, page = oldest - 1, page + 1
            return True
    except Exception as e:
        print(f"{url}: {e}", file=sys.stderr)
        return False


def stamped_ids():
    ids = set()
    for f in OUT.glob("*.txt"):
        ids.update(l.strip() for l in f.read_text().splitlines() if l.strip())
    return ids


def main():
    OUT.mkdir(exist_ok=True)
    found = {}
    async def run_all():
        return await asyncio.wait_for(asyncio.gather(*(fetch(u, found) for u in RELAYS)), timeout=600)
    ok = asyncio.run(run_all())
    print(f"relays ok: {sum(ok)}/{len(RELAYS)}, events: {len(found)}")
    new = sorted(set(found) - stamped_ids())
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if new:
        f = OUT / f"{today}.txt"
        old = f.read_text().splitlines() if f.exists() else []
        if f.exists():
            # 同じ日に2回目：別のファイルにする（刻んだファイルは書き換えない）
            i = 2
            while (OUT / f"{today}-{i}.txt").exists():
                i += 1
            f = OUT / f"{today}-{i}.txt"
        f.write_text("\n".join(new) + "\n")
        subprocess.run(["ots", "stamp", str(f)], check=True)
        print(f"stamped {len(new)} events -> {f.name}")
    else:
        print("no new events")
    for p in sorted(OUT.glob("*.ots")):
        r = subprocess.run(["ots", "upgrade", str(p)], capture_output=True, text=True)
        print(p.name, (r.stdout + r.stderr).strip().splitlines()[-1:] or "")
    if sum(ok) == 0:
        sys.exit("どの中継にもつながりませんでした")


if __name__ == "__main__":
    main()
