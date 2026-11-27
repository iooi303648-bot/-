// 연습 모드 + 휴대폰 화면 검사: node test/practice.js
const { chromium, devices } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const OUT = process.env.OUT || path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const errors = [];

async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route("http://localhost:8090/**", (route) => {
    const u = new URL(route.request().url());
    let file = path.join(__dirname, "..", "..", decodeURIComponent(u.pathname));
    if (file.endsWith("/")) file += "index.html";
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain" }[path.extname(file)] || "application/octet-stream";
    route.fulfill({ status: 200, contentType: type + "; charset=utf-8", body: fs.readFileSync(file) });
  });
  // 진짜 Firebase는 여기서 닿지 않으니 막아 둬요 → 오프라인 안내 + 연습 모드 확인
  await ctx.route("https://www.gstatic.com/**", (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:8090/number-tiles/");
  await page.waitForSelector("#mode-badge.offline");
  return page;
}

async function playPractice(page, label, turns) {
  await page.fill("#name", "연습생");
  await page.click("#practice");
  await page.waitForSelector("#lobby:not(.hidden)");
  await page.screenshot({ path: `${OUT}/${label}-practice-lobby.png` });
  await page.click("#start");
  await page.waitForSelector("#game:not(.hidden)");
  await page.waitForTimeout(4000);
  for (let i = 0; i < turns; i++) {
    const over = await page.evaluate(() => self.__nt.state.phase === "over");
    if (over) break;
    const mine = await page.evaluate(() => { const s = self.__nt.state; return s.phase === "play" && s.players[s.turn].id === self.__nt.myId; });
    if (mine) {
      // 로봇과 같은 방법으로 놓을 수 있으면 화면을 눌러서 놓고, 아니면 뽑기
      const plan = await page.evaluate(() => {
        const s = self.__nt.state; const d = self.Bot.decide(s, self.__nt.myId);
        if (d.kind !== "play") return null;
        const old = new Set(s.board.flat());
        return d.board.filter((set) => set.every((t) => !old.has(t)));
      });
      if (plan && plan.length) {
        for (const set of plan) {
          for (const t of set) await page.click(`#rack .tile[data-id="${t}"]`);
          await page.click(".newzone");
        }
        if (await page.isEnabled("#commit")) { await page.click("#commit"); }
        else { await page.click("#undo"); await page.click("#draw"); }
      } else {
        await page.click("#draw");
      }
    }
    await page.waitForTimeout(700);
  }
  await page.screenshot({ path: `${OUT}/${label}-practice-game.png` });
  return page.evaluate(() => ({ phase: self.__nt.state.phase, board: self.__nt.state.board.length, pool: self.__nt.state.pool.length }));
}

(async () => {
  const browser = await chromium.launch();
  const cb = await open(browser, { viewport: { width: 1366, height: 650 } });
  await cb.screenshot({ path: `${OUT}/20-home-offline.png` });
  console.log("크롬북 연습:", await playPractice(cb, "21", 40));
  const fits = await cb.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth);
  console.log("크롬북 화면 스크롤 없음:", fits);
  const phone = await open(browser, { ...devices["iPhone 13"] });
  await phone.screenshot({ path: `${OUT}/30-phone-home.png` });
  console.log("휴대폰 연습:", await playPractice(phone, "31", 20));
  const pfits = await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  console.log("휴대폰 가로 넘침 없음:", pfits);
  console.log("페이지 오류:", errors.length ? errors : "없음");
  await browser.close();
})().catch((e) => { console.error("실패:", e, errors); process.exit(1); });
