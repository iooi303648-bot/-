// 화면 검사: node test/e2e.js
// 먼저 저장소 맨 위 폴더를 8090 포트로 띄우고(python3 -m http.server 8090),
// 테스트용 연결 서버를 켜 둬요(node number-tiles/test/fake/server.js 8091).
// 진짜 Firebase 대신 이 테스트 서버로 브라우저 3개를 이어서 실제로 눌러 봐요.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const R = require("../rules.js");
const OUT = process.env.OUT || path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const URL_ = "http://localhost:8090/number-tiles/";
const FAKE = "http://localhost:8091";
const fakeApp = fs.readFileSync(path.join(__dirname, "fake/firebase-app.js"), "utf8");
const fakeDb = fs.readFileSync(path.join(__dirname, "fake/firebase-database.js"), "utf8");
const T = (c, n, copy = 0) => copy * 52 + R.COLORS.indexOf(c) * 13 + (n - 1);
const log = (...a) => console.log("•", ...a);
const errors = [];

async function newPlayer(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 650 }, ...opts });
  // 게임 파일은 디스크에서 바로 읽어 줘요 (웹 서버 대신)
  await ctx.route("http://localhost:8090/**", (route) => {
    const u = new URL(route.request().url());
    let file = path.join(__dirname, "..", "..", decodeURIComponent(u.pathname));
    if (file.endsWith("/")) file += "index.html";
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain" }[path.extname(file)] || "application/octet-stream";
    route.fulfill({ status: 200, contentType: type + "; charset=utf-8", body: fs.readFileSync(file) });
  });
  await ctx.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const body = route.request().url().includes("database") ? fakeDb : fakeApp;
    route.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
  });
  const page = await ctx.newPage();
  watchErrors(page);
  await page.goto(URL_);
  await page.waitForSelector("#mode-badge.online");
  return { ctx, page };
}
function watchErrors(page) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
}
const dump = async () => (await fetch(`${FAKE}/dump`)).json();
async function getRoom(code) {
  const r = await (await fetch(`${FAKE}/get?path=rooms/nt-${code}`)).json();
  return r.value ? JSON.parse(r.value.s) : null;
}
async function putRoom(code, s) {
  await fetch(`${FAKE}/set?path=rooms/nt-${code}`, { method: "POST", body: JSON.stringify({ value: { s: JSON.stringify(s), t: Date.now() } }) });
}
// 다른 사람 화면에 보이는 것 (시계 숫자는 빼고)
const visibleText = (page) => page.evaluate(() => {
  const t = document.querySelector("#game").innerText + "|" + document.querySelector("#opponents").innerText;
  const ids = [...document.querySelectorAll("#board .tile")].map((n) => n.dataset.id).join(",");
  return (t + "|" + ids).replace(/\d+:\d\d/g, "");
});

// 테스트 판 만들기: 어떤 사람의 받침대를 정해 줘요
function giveRack(s, player, rack) {
  const want = new Set(rack);
  const freed = player.rack.filter((t) => !want.has(t));
  s.players.forEach((p) => { p.rack = p.rack.filter((t) => !want.has(t)); });
  s.board = s.board.map((set) => set.filter((t) => !want.has(t))).filter((set) => set.length);
  s.pool = s.pool.filter((t) => !want.has(t)).concat(freed);
  player.rack = rack.slice();
}

(async () => {
  const browser = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests"] });
  const A = await newPlayer(browser), B = await newPlayer(browser), C = await newPlayer(browser);
  await A.page.screenshot({ path: `${OUT}/01-home.png` });

  // 방 만들기
  await A.page.fill("#name", "하늘");
  await A.page.click("#create");
  await A.page.waitForSelector("#lobby:not(.hidden)");
  const code = await A.page.evaluate(() => document.querySelector("#lobby-code").getAttribute("aria-label").slice(-4));
  log("방 번호", code);
  // 방 목록에서 눌러서 들어가기
  for (const [P, name] of [[B, "바다"], [C, "구름"]]) {
    await P.page.fill("#name", name);
    await P.page.waitForSelector(".room-item button");
    await P.page.screenshot({ path: `${OUT}/02-home-roomlist.png` });
    await P.page.click(".room-item button");
    await P.page.waitForSelector("#lobby:not(.hidden)");
  }
  await A.page.waitForFunction(() => document.querySelectorAll("#lobby-players li").length === 3);
  await A.page.click("#set-time .seg-btn:nth-child(1)"); // 1분
  await B.page.waitForFunction(() => document.querySelector("#set-time [aria-pressed=true]").textContent === "1분");
  await A.page.screenshot({ path: `${OUT}/03-lobby-host.png` });
  await B.page.screenshot({ path: `${OUT}/04-lobby-guest.png` });
  log("열린 방 목록 항목", Object.keys(await dump()).filter((k) => k.startsWith("rooms/nt-lobby")));

  // 채팅 (비속어 가리기, 도배 막기)
  await B.page.click("#chat-toggle");
  await B.page.fill("#chat-input", "안녕 시발");
  await B.page.press("#chat-input", "Enter");
  await A.page.waitForSelector("#chat-peek:not(.hidden)");
  const peek = await A.page.textContent("#chat-peek");
  log("채팅 미리보기:", peek);
  if (peek.includes("시발")) throw new Error("비속어가 안 가려짐");
  await B.page.fill("#chat-input", "안녕 시발");
  await B.page.press("#chat-input", "Enter");
  log("도배 막기:", await B.page.textContent("#toast"));
  await B.page.click("#chat-close");

  // 시작 → 순서 알림
  await A.page.click("#start");
  for (const P of [A, B, C]) await P.page.waitForSelector("#order:not(.hidden)");
  await B.page.screenshot({ path: `${OUT}/05-order.png` });
  const orders = (await Promise.all([A, B, C].map((P) => P.page.textContent(".order-list")))).map((o) => o.replace(" (나)", ""));
  log("모두에게 같은 순서:", orders.every((o) => o === orders[0]), orders[0]);
  await A.page.waitForTimeout(4000);

  let s = await getRoom(code);
  const byName = { 하늘: A, 바다: B, 구름: C };
  const P1 = byName[s.players[0].name], P2 = byName[s.players[1].name];
  giveRack(s, s.players[0], [T("r", 10), T("b", 10), T("k", 10), T("y", 4), T("y", 5), T("r", 1), T("b", 13), 104]);
  s.board = [];
  await putRoom(code, s);
  await P1.page.waitForFunction(() => document.querySelectorAll("#rack .tile").length === 8);
  await P1.page.click("#sort-num");

  const before = await visibleText(P2.page);
  // 눌러서 고르기 → 새 줄
  for (const t of [T("r", 10), T("b", 10)]) await P1.page.click(`#rack .tile[data-id="${t}"]`);
  await P1.page.click(".newzone");
  log("2장 놓은 뒤 안내:", await P1.page.textContent("#board-note"));
  await P1.page.screenshot({ path: `${OUT}/06-my-turn-bad-set.png` });
  // 끌어서 놓기: 검정 10을 그 줄로
  const src = await P1.page.locator(`#rack .tile[data-id="${T("k", 10)}"]`).boundingBox();
  const dst = await P1.page.locator("#board .set").first().boundingBox();
  await P1.page.mouse.move(src.x + 20, src.y + 25);
  await P1.page.mouse.down();
  await P1.page.mouse.move(src.x + 60, src.y - 60, { steps: 5 });
  await P1.page.mouse.move(dst.x + dst.width - 5, dst.y + 20, { steps: 8 });
  await P1.page.screenshot({ path: `${OUT}/07-dragging.png` });
  await P1.page.mouse.up();
  log("3장 놓은 뒤 안내:", await P1.page.textContent("#board-note"));
  await P1.page.screenshot({ path: `${OUT}/08-my-turn-ok.png` });

  // 공정함 검사: '다 놓았어요' 전에는 다른 사람 화면과 저장소가 그대로여야 함
  await P2.page.waitForTimeout(800);
  const during = await visibleText(P2.page);
  log("놓는 중 다른 사람 화면 변화 없음:", before === during);
  if (before !== during) { console.log(before, "\n---\n", during); throw new Error("놓는 중인 타일이 새어 나감"); }
  const leaked = await P2.page.evaluate((ids) => ids.filter((t) => document.querySelector(`#board .tile[data-id="${t}"], #opponents [data-id="${t}"]`)), [T("r", 10), T("b", 10), T("k", 10), T("y", 4), T("y", 5), T("r", 1), T("b", 13), 104]);
  log("다른 사람 화면에 내 타일이 보이는 개수:", leaked.length);
  if (leaked.length) throw new Error("내 타일이 다른 화면에 보임");
  log("놓는 중 저장소의 판:", JSON.stringify((await getRoom(code)).board));
  await P2.page.screenshot({ path: `${OUT}/09-other-view-while-drafting.png` });

  await P1.page.click("#commit");
  await P2.page.waitForFunction(() => document.querySelectorAll("#board .tile").length === 3);
  await P2.page.waitForTimeout(300);
  await P2.page.screenshot({ path: `${OUT}/10-other-sees-new-set.png` });
  s = await getRoom(code);
  log("다 놓은 뒤 판:", JSON.stringify(s.board), "차례:", R.currentPlayer(s).name);

  // 두 번째 사람: 한 장 뽑기
  const c2 = s.players[1].rack.length;
  await P2.page.click("#draw");
  await P2.page.waitForTimeout(600);
  s = await getRoom(code);
  log("뽑은 뒤 장수:", c2, "→", s.players[1].rack.length);

  // 세 번째 사람: 탭 닫고 다시 열기 → 같은 자리
  const third = byName[s.players[2].name];
  const thirdName = s.players[2].name;
  await third.page.close();
  const p3 = await third.ctx.newPage();
  watchErrors(p3);
  await p3.goto(URL_);
  await p3.waitForSelector("#game:not(.hidden)");
  log("다시 열기 후 게임 복귀, 받침대", await p3.evaluate(() => document.querySelectorAll("#rack .tile").length), "장");
  third.page = p3;

  // 시간 초과: 차례인 사람 화면이 꺼져 있어도 다른 사람이 넘겨 줘요
  s = await getRoom(code);
  s.turnStart = Date.now() - 65000;
  await putRoom(code, s);
  await p3.close();
  const watcher = third === A ? B : A;
  await watcher.page.waitForFunction((n) => !document.querySelector("#opponents .opp.on")?.textContent.includes(n), thirdName, { timeout: 15000 });
  s = await getRoom(code);
  log("시간 초과 처리:", thirdName, "→ 다음 차례:", R.currentPlayer(s).name, JSON.stringify(s.lastMove));

  // 꺼진 화면 다시 열어 두기
  third.page = await third.ctx.newPage();
  watchErrors(third.page);
  await third.page.goto(URL_);
  await third.page.waitForSelector("#game:not(.hidden)");
  // 방장 내보내기 (사라진 친구 때문에 멈출 때): 방장이 아닌 사람 하나를 내보내요
  const host = byName[R.findPlayer(s, s.hostId).name];
  const targetName = s.players.find((p) => p.id !== s.hostId && byName[p.name] !== watcher)?.name || s.players.find((p) => p.id !== s.hostId).name;
  {
    const thirdName = targetName;
    host.page.once("dialog", (d) => d.accept());
    await host.page.click(`.opp:has-text("${thirdName}") .kick`);
    await host.page.waitForTimeout(700);
    s = await getRoom(code);
    log("내보내기 후 남은 사람:", R.activePlayers(s).map((p) => p.name), "단계:", s.phase);
  }

  // 남은 사람 중 차례인 사람이 받침대를 비우게 해서 끝내기
  s = await getRoom(code);
  const cur = R.currentPlayer(s);
  const W = byName[cur.name];
  const win = [T("y", 7), T("y", 8), T("y", 9)];
  giveRack(s, cur, win);
  cur.opened = true;
  s.turnStart = Date.now();
  await putRoom(code, s);
  await W.page.waitForFunction(() => document.querySelectorAll("#rack .tile").length === 3);
  for (const t of win) await W.page.click(`#rack .tile[data-id="${t}"]`);
  await W.page.click(".newzone");
  await W.page.click("#commit");
  const alive = R.activePlayers(s).map((p) => byName[p.name]);
  const other = alive.find((P) => P !== W);
  await other.page.waitForSelector("#result:not(.hidden)");
  await other.page.screenshot({ path: `${OUT}/11-result.png` });

  // 같은 친구들과 다시 하기
  s = await getRoom(code);
  const host2 = byName[R.findPlayer(s, s.hostId).name];
  await host2.page.click("#result .btn.primary");
  await other.page.waitForSelector("#lobby:not(.hidden)");
  log("다시 하기 → 대기실 인원:", await other.page.evaluate(() => document.querySelectorAll("#lobby-players li").length));

  // 중간에 나가도 남은 사람은 계속: 쫓겨났던 사람이 아닌 새 친구가 들어와서 3명으로 시작 후 한 명 나가기
  const D = await newPlayer(browser);
  await D.page.fill("#name", "별");
  await D.page.waitForSelector(".room-item button");
  await D.page.click(".room-item button");
  await D.page.waitForSelector("#lobby:not(.hidden)");
  await host2.page.click("#start");
  await other.page.waitForSelector("#game:not(.hidden)");
  await other.page.waitForTimeout(4200);
  other.page.once("dialog", (d) => d.accept());
  await other.page.click("#home-btn");
  await other.page.waitForSelector("#home:not(.hidden)");
  s = await getRoom(code);
  log("한 명이 나간 뒤:", s ? `${s.phase}, 남은 사람 ${R.activePlayers(s).map((p) => p.name)}` : "방 없음");

  console.log("페이지 오류:", errors.length ? errors : "없음");
  await browser.close();
})().catch((e) => { console.error("실패:", e); console.log("페이지 오류:", errors); process.exit(1); });
