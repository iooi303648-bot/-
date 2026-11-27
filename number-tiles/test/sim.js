// 자동 대결: node test/sim.js [판 수]
// 로봇끼리 수천 판을 돌리면서 규칙이 깨지는지(타일이 사라지거나 늘어나는지 등) 검사해요.
const R = require("../rules.js");
const Bot = require("../bot.js");
const assert = require("node:assert");

function rngFrom(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function checkInvariants(s) {
  const all = s.pool.concat(s.board.flat(), ...s.players.map((p) => p.rack));
  if (s.phase === "play") {
    assert.strictEqual(all.length, 106, "타일 수가 106이 아님");
    assert.strictEqual(new Set(all).size, 106, "같은 타일이 두 번 있음");
  }
  for (const set of s.board) assert.ok(R.isValidSet(set), "판에 틀린 줄: " + set);
  if (s.phase === "play") assert.ok(!R.currentPlayer(s).left, "나간 사람 차례");
}

// ---- 작은 규칙 확인 ----
const T = (c, n, copy = 0) => copy * 52 + R.COLORS.indexOf(c) * 13 + (n - 1);
const J1 = 104, J2 = 105;
assert.ok(R.isValidSet([T("r", 3), T("r", 4), T("r", 5)]));
assert.ok(R.isValidSet([T("r", 3), J1, T("r", 5)]));
assert.ok(!R.isValidSet([T("r", 3), T("b", 4), T("r", 5)]));
assert.ok(R.isValidSet([T("r", 7), T("b", 7), T("k", 7)]));
assert.ok(!R.isValidSet([T("r", 7), T("r", 7, 1), T("k", 7)]));
assert.ok(!R.isValidSet([T("r", 12), T("r", 13), T("r", 1)]), "13 다음 1은 안 이어져요");
assert.ok(R.isValidSet([T("r", 12), T("r", 13), J1]));
assert.deepStrictEqual(R.arrangeSet([T("r", 12), T("r", 13), J1]), [J1, T("r", 12), T("r", 13)]);
assert.strictEqual(R.setPoints([T("r", 12), T("r", 13), J1]), 36);
assert.strictEqual(R.setPoints([T("r", 10), T("b", 10), T("k", 10)]), 30);
assert.ok(!R.isValidSet([T("r", 1), T("b", 1), T("k", 1), T("y", 1), J1]), "같은 숫자 줄은 4장까지");
// 처음 등록 30점
let chk = R.checkTurn([], [T("r", 9), T("b", 9), T("k", 9), T("r", 1)], false, 30, [[T("r", 9), T("b", 9), T("k", 9)]]);
assert.ok(!chk.ok && chk.meldPoints === 27);
chk = R.checkTurn([], [T("r", 10), T("b", 10), T("k", 10)], false, 30, [[T("r", 10), T("b", 10), T("k", 10)]]);
assert.ok(chk.ok);
// 처음엔 판의 줄을 못 건드림
const old = [[T("y", 1), T("y", 2), T("y", 3)]];
chk = R.checkTurn(old, [T("y", 4), T("r", 11), T("b", 11), T("k", 11)], false, 30,
  [[T("y", 1), T("y", 2), T("y", 3), T("y", 4)], [T("r", 11), T("b", 11), T("k", 11)]]);
assert.ok(!chk.ok);
// 등록 뒤에는 고쳐도 됨
chk = R.checkTurn(old, [T("y", 4)], true, 30, [[T("y", 1), T("y", 2), T("y", 3), T("y", 4)]]);
assert.ok(chk.ok);
// 판의 타일을 받침대로 가져가면 안 됨
chk = R.checkTurn(old, [T("y", 4), T("y", 5)], true, 30, [[T("y", 2), T("y", 3), T("y", 4), T("y", 5)]]);
assert.ok(!chk.ok);
// 판에서 별을 빼 와서 다른 줄에 쓰기
const old2 = [[T("b", 5), J1, T("b", 7)]];
chk = R.checkTurn(old2, [T("b", 6), T("r", 2), T("k", 2)], true, 30, [[T("b", 5), T("b", 6), T("b", 7)], [T("r", 2), T("k", 2), J1]]);
assert.ok(chk.ok, chk.reason);
console.log("규칙 확인 통과");

// ---- 자동 대결 ----
const games = Number(process.argv[2] || 3000);
const stats = { wins: 0, blocked: 0, turns: 0, leaves: 0, kicks: 0, timeouts: 0, rejected: 0 };
for (let g = 0; g < games; g++) {
  const rng = rngFrom(g + 7);
  let now = 1_000_000;
  const n = 2 + (g % 3);
  let s = R.createRoom("p0", "p0", now);
  for (let i = 1; i < n; i++) R.addPlayer(s, "p" + i, "p" + i);
  R.setSettings(s, "p0", { firstMeld: g % 4 === 3 ? 0 : 30, turnSec: 60 });
  R.startGame(s, "p0", rng, now);
  checkInvariants(s);
  let steps = 0;
  while (s.phase === "play") {
    if (++steps > 3000) throw new Error("게임이 끝나지 않음 " + g);
    now += 1000;
    const cur = R.currentPlayer(s);
    const roll = rng();
    // 가끔 나가기 / 내보내기 / 시간 초과
    if (roll < 0.002) {
      R.leaveGame(s, R.activePlayers(s)[Math.floor(rng() * R.activePlayers(s).length)].id, now); stats.leaves++;
    } else if (roll < 0.003 && R.activePlayers(s).length > 2) {
      const host = s.hostId;
      const t = R.activePlayers(s).find((p) => p.id !== host);
      if (t) { R.kick(s, host, t.id, now); stats.kicks++; }
    } else if (roll < 0.01) {
      assert.strictEqual(R.timeOut(s, s.turnNo, now, 0), undefined, "시간 전 초과 처리됨");
      now += 61000;
      R.timeOut(s, s.turnNo, now, 0); stats.timeouts++;
    } else {
      // 남의 차례에 하면 막혀야 함
      const other = s.players.find((p) => p.id !== cur.id && !p.left);
      assert.throws(() => R.drawTile(s, other.id, now));
      const move = Bot.decide(s, cur.id);
      if (move.kind === "play") R.commitTurn(s, cur.id, move.board, now);
      else R.drawTile(s, cur.id, now);
      // 일부러 틀린 판 내기 (반드시 거절)
      if (s.phase === "play" && rng() < 0.05) {
        const c2 = R.currentPlayer(s);
        const bad = s.board.map((x) => x.slice()).concat([[c2.rack[0]]]);
        const before = JSON.stringify(s);
        assert.throws(() => R.commitTurn(s, c2.id, bad, now));
        assert.strictEqual(JSON.stringify(s), before, "거절됐는데 상태가 바뀜");
        stats.rejected++;
      }
    }
    checkInvariants(s);
    stats.turns++;
  }
  assert.ok(s.results && s.results.length === s.players.length);
  if (s.players.find((p) => p.id === s.winnerId)?.rack.length === 0) stats.wins++;
  else stats.blocked++;
  // 다시 하기
  if (g % 50 === 0 && !R.findPlayer(s, s.hostId).left) {
    R.backToLobby(s, s.hostId);
    assert.strictEqual(s.phase, "lobby");
    if (s.players.length >= 2) { R.startGame(s, s.hostId, rng, now); checkInvariants(s); }
  }
}
console.log(`${games}판 완료`, stats);
