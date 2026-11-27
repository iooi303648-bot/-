// 테스트용 가짜 firebase-database (진짜와 쓰는 법이 같아요)
const BASE = "http://localhost:8091";
export function getDatabase(app) { return { app }; }
export function ref(db, path) { return { path }; }
export function onValue(r, cb) {
  if (r.path === ".info/serverTimeOffset") { setTimeout(() => cb({ val: () => 0 }), 0); return () => {}; }
  if (r.path === ".info/connected") { setTimeout(() => cb({ val: () => true }), 0); return () => {}; }
  const es = new EventSource(`${BASE}/events?path=${encodeURIComponent(r.path)}`);
  es.onmessage = (e) => { const v = JSON.parse(e.data); cb({ val: () => v }); };
  return () => es.close();
}
export async function runTransaction(r, fn) {
  for (let i = 0; i < 30; i++) {
    const cur = await (await fetch(`${BASE}/get?path=${encodeURIComponent(r.path)}`)).json();
    const next = fn(cur.value);
    if (next === undefined) return { committed: false };
    const res = await (await fetch(`${BASE}/tx?path=${encodeURIComponent(r.path)}`, { method: "POST", body: JSON.stringify({ v: cur.v, value: next }) })).json();
    if (res.ok) return { committed: true };
  }
  throw new Error("transaction failed");
}
export async function set(r, value) { await fetch(`${BASE}/set?path=${encodeURIComponent(r.path)}`, { method: "POST", body: JSON.stringify({ value }) }); }
export async function remove(r) { await set(r, null); }
export function onDisconnect() { return { remove() {}, cancel() {} }; }
