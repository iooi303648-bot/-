// 테스트용 가짜 Firebase 서버 (진짜 Firebase 대신 여러 브라우저를 이어 줘요)
const http = require("node:http");
const store = new Map(); // path -> { v, value }
const subs = new Map();  // path -> Set(res)
let version = 0;
const get = (p) => {
  if (store.has(p)) return store.get(p).value;
  // 하위 경로 모으기 (목록용)
  const out = {}; let any = false;
  for (const [k, e] of store) if (k.startsWith(p + "/")) { const rest = k.slice(p.length + 1); if (!rest.includes("/")) { out[rest] = e.value; any = true; } }
  return any ? out : null;
};
const ver = (p) => (store.get(p) || {}).v || 0;
function notify(p) {
  const parts = p.split("/");
  for (let i = parts.length; i >= 1; i--) {
    const q = parts.slice(0, i).join("/");
    for (const res of subs.get(q) || []) res.write(`data: ${JSON.stringify(get(q))}\n\n`);
  }
}
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url, "http://x");
  const p = url.searchParams.get("path");
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "Access-Control-Allow-Origin": "*" });
    res.write(`data: ${JSON.stringify(get(p))}\n\n`);
    if (!subs.has(p)) subs.set(p, new Set());
    subs.get(p).add(res);
    req.on("close", () => subs.get(p).delete(res));
    return;
  }
  if (url.pathname === "/get") return res.end(JSON.stringify({ value: get(p), v: ver(p) }));
  if (url.pathname === "/dump") return res.end(JSON.stringify(Object.fromEntries(store)));
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const msg = JSON.parse(body || "{}");
    if (url.pathname === "/tx" && msg.v !== ver(p)) return res.end(JSON.stringify({ ok: false }));
    if (msg.value === null || msg.value === undefined) store.delete(p);
    else store.set(p, { v: ++version, value: msg.value });
    notify(p);
    res.end(JSON.stringify({ ok: true }));
  });
}).listen(Number(process.argv[2] || 8091), () => console.log("fake firebase ready"));
