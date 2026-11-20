const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://relay.nostr.band"];
const all = {};
const one = url => new Promise(res => { let ws; try { ws = new WebSocket(url); } catch (e) { console.log(url, e.message); return res(0); }
  let n = 0; const to = setTimeout(() => { try { ws.close(); } catch (e) {} res(n); }, 15000);
  ws.onopen = () => ws.send(JSON.stringify(["REQ", "a", {kinds: [7710], "#t": ["sougo-review"], limit: 500}]));
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d[0] === "EVENT") { all[d[2].id] = d[2]; n++; } if (d[0] === "EOSE") { clearTimeout(to); ws.close(); res(n); } };
  ws.onerror = e => { console.log(url, "error", e.message || ""); clearTimeout(to); res(n); }; });
(async () => { const r = await Promise.all(relays.map(one)); console.log("per relay", r, "total", Object.keys(all).length);
  require("fs").writeFileSync("debug/events.json", JSON.stringify(Object.values(all))); process.exit(0); })();
