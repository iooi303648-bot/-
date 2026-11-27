// 줄줄이 숫자 — 게임 규칙 (화면/네트워크와 상관없는 순수한 로직)
//
// 타일 106장: 1~13 숫자 × 4가지 색 × 2벌 = 104장 + 웃는 별(조커) 2장.
// 한 사람에게 14장씩. 내 차례에 할 수 있는 일:
//   - 판에 타일을 놓기(판의 줄을 자유롭게 고쳐도 됨) → 모든 줄이 맞으면 "다 놓았어요"
//   - 놓을 게 없으면 한 장 뽑고 차례를 넘김
// 맞는 줄: ① 같은 색 이어지는 숫자 3장 이상  ② 같은 숫자 다른 색 3~4장
// 처음 놓을 때는(방장 설정) 내 타일만으로 숫자 합 30 이상이어야 해요. 그 전엔 판의 타일을 못 건드려요.
// 판에 있던 타일은 내 받침대로 가져올 수 없어요.
// 받침대를 다 비우면 승리. 더미가 비고 모두 한 번씩 넘기면, 남은 숫자 합이 가장 적은 사람이 승리.
(function (root) {
  "use strict";

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 4;
  const HAND_SIZE = 14;
  const TILE_COUNT = 106;
  const JOKER_POINTS = 30;
  const COLORS = ["r", "b", "y", "k"]; // 빨강, 파랑, 노랑, 검정
  const COLOR_NAMES = { r: "빨강", b: "파랑", y: "노랑", k: "검정" };
  const FIRST_MELD_OPTIONS = [30, 0];
  const TURN_OPTIONS = [60, 120, 180, 0];
  const CHAT_KEEP = 40;

  // ---------- 타일 ----------
  function isJoker(id) { return id >= 104; }
  function tileColor(id) { return isJoker(id) ? "j" : COLORS[Math.floor((id % 52) / 13)]; }
  function tileNum(id) { return isJoker(id) ? 0 : (id % 13) + 1; }
  function tilePoints(id) { return isJoker(id) ? JOKER_POINTS : tileNum(id); }
  function tileLabel(id) { return isJoker(id) ? "웃는 별" : `${COLOR_NAMES[tileColor(id)]} ${tileNum(id)}`; }

  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 줄 검사 ----------
  // 같은 색으로 이어지는 줄이 될 수 있으면 { start } 를, 아니면 null
  function runInfo(set) {
    const len = set.length;
    if (len < 3 || len > 13) return null;
    const real = set.filter((t) => !isJoker(t));
    if (real.length === 0) return null;
    const color = tileColor(real[0]);
    const nums = new Set();
    for (const t of real) {
      if (tileColor(t) !== color) return null;
      const n = tileNum(t);
      if (nums.has(n)) return null;
      nums.add(n);
    }
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    if (max - min + 1 > len) return null;
    // 남는 별은 뒤(큰 쪽)에 붙이고, 13을 넘으면 앞으로
    let start = min;
    if (start + len - 1 > 13) start = 14 - len;
    return { start };
  }

  function groupInfo(set) {
    const len = set.length;
    if (len < 3 || len > 4) return null;
    const real = set.filter((t) => !isJoker(t));
    if (real.length === 0) return null;
    const n = tileNum(real[0]);
    const colors = new Set();
    for (const t of real) {
      if (tileNum(t) !== n) return null;
      const c = tileColor(t);
      if (colors.has(c)) return null;
      colors.add(c);
    }
    return { n };
  }

  function isValidSet(set) {
    return Boolean(runInfo(set) || groupInfo(set));
  }

  // 화면에 보기 좋게 정리 (맞는 줄이면 숫자 순서/색 순서로, 아니면 그대로)
  function arrangeSet(set) {
    const run = runInfo(set);
    const group = groupInfo(set);
    if (run) {
      const real = set.filter((t) => !isJoker(t));
      const jokers = set.filter(isJoker);
      const byNum = new Map(real.map((t) => [tileNum(t), t]));
      const out = [];
      for (let v = run.start; v < run.start + set.length; v++) {
        out.push(byNum.has(v) ? byNum.get(v) : jokers.shift());
      }
      return out;
    }
    if (group) {
      const real = set.filter((t) => !isJoker(t)).sort((a, b) => COLORS.indexOf(tileColor(a)) - COLORS.indexOf(tileColor(b)));
      return real.concat(set.filter(isJoker));
    }
    return set.slice();
  }

  // 줄의 숫자 합 (별은 대신하는 숫자). 이어지는 줄이 되면 그 값, 아니면 같은 숫자 줄 값.
  function setPoints(set) {
    const run = runInfo(set);
    if (run) {
      const len = set.length;
      return len * run.start + (len * (len - 1)) / 2;
    }
    const group = groupInfo(set);
    if (group) return group.n * set.length;
    return 0;
  }

  function rackPoints(rack) {
    return rack.reduce((sum, t) => sum + tilePoints(t), 0);
  }

  const setKey = (set) => set.slice().sort((a, b) => a - b).join(",");

  // 내 차례에 만든 판(draft)이 규칙에 맞는지 검사.
  // 결과: { ok, reason, played: [ids], meldPoints }
  function checkTurn(oldBoard, rack, opened, firstMeld, newBoard) {
    const res = { ok: false, reason: "", played: [], meldPoints: 0, badSets: [] };
    const seen = new Set();
    for (const set of newBoard) {
      for (const t of set) {
        if (!Number.isInteger(t) || t < 0 || t >= TILE_COUNT || seen.has(t)) {
          res.reason = "타일이 잘못됐어요. 되돌리기를 눌러 주세요.";
          return res;
        }
        seen.add(t);
      }
    }
    const oldTiles = new Set(oldBoard.flat());
    for (const t of oldTiles) {
      if (!seen.has(t)) {
        res.reason = "판에 있던 타일은 받침대로 가져올 수 없어요.";
        return res;
      }
    }
    const rackSet = new Set(rack);
    for (const t of seen) {
      if (oldTiles.has(t)) continue;
      if (!rackSet.has(t)) {
        res.reason = "타일이 잘못됐어요. 되돌리기를 눌러 주세요.";
        return res;
      }
      res.played.push(t);
    }
    newBoard.forEach((set, i) => { if (!isValidSet(set)) res.badSets.push(i); });
    if (res.played.length === 0) {
      res.reason = "받침대의 타일을 한 장 이상 놓아야 해요.";
      return res;
    }
    if (res.badSets.length) {
      res.reason = "점선 줄을 고쳐 주세요. 같은 색 이어지는 숫자 3장, 또는 같은 숫자 다른 색 3~4장이어야 해요.";
      return res;
    }
    if (!opened && firstMeld > 0) {
      // 처음 놓을 때: 판에 있던 줄은 그대로, 새 줄은 내 타일로만
      const oldKeys = new Map();
      for (const set of oldBoard) {
        const k = setKey(set);
        oldKeys.set(k, (oldKeys.get(k) || 0) + 1);
      }
      let points = 0;
      for (const set of newBoard) {
        const k = setKey(set);
        if (oldKeys.get(k)) {
          oldKeys.set(k, oldKeys.get(k) - 1);
          continue;
        }
        if (set.some((t) => oldTiles.has(t))) {
          res.reason = `처음에는 판에 있던 줄을 고칠 수 없어요. 내 타일로만 새 줄을 만들어 주세요.`;
          return res;
        }
        points += setPoints(set);
      }
      res.meldPoints = points;
      if (points < firstMeld) {
        res.reason = `처음에는 내 타일로만 숫자 합 ${firstMeld} 이상을 놓아야 해요. (지금 ${points})`;
        return res;
      }
    }
    res.ok = true;
    return res;
  }

  // ---------- 방 상태 ----------
  function createRoom(hostId, hostName, now = Date.now()) {
    return {
      v: 1,
      phase: "lobby",
      hostId,
      players: [{ id: hostId, name: hostName, rack: [], opened: false }],
      settings: { firstMeld: 30, turnSec: 120 },
      pool: [],
      board: [],
      turn: 0,
      turnNo: 0,
      turnStart: 0,
      passes: 0,
      lastMove: null,
      winnerId: null,
      results: null,
      round: 0,
      chat: [],
      createdAt: now,
    };
  }

  function findPlayer(state, id) {
    return state.players.find((p) => p.id === id);
  }

  function activePlayers(state) {
    return state.players.filter((p) => !p.left);
  }

  function currentPlayer(state) {
    return state.players[state.turn];
  }

  function addPlayer(state, id, name) {
    const existing = findPlayer(state, id);
    if (existing) {
      if (state.phase === "lobby") existing.name = name;
      return state;
    }
    if (state.phase !== "lobby") throw new Error("이미 게임이 시작된 방이에요.");
    if (state.players.length >= MAX_PLAYERS) throw new Error(`방이 꽉 찼어요. (최대 ${MAX_PLAYERS}명)`);
    state.players.push({ id, name, rack: [], opened: false });
    return state;
  }

  function addBot(state, byId, id, name) {
    if (byId !== state.hostId) throw new Error("방장만 할 수 있어요.");
    addPlayer(state, id, name);
    findPlayer(state, id).bot = true;
    return state;
  }

  function setSettings(state, byId, settings) {
    if (byId !== state.hostId) throw new Error("방장만 바꿀 수 있어요.");
    if (state.phase !== "lobby") throw new Error("게임 중에는 바꿀 수 없어요.");
    const next = { ...state.settings };
    if (settings.firstMeld !== undefined && FIRST_MELD_OPTIONS.includes(settings.firstMeld)) next.firstMeld = settings.firstMeld;
    if (settings.turnSec !== undefined && TURN_OPTIONS.includes(settings.turnSec)) next.turnSec = settings.turnSec;
    state.settings = next;
    return state;
  }

  function startGame(state, byId, rng = Math.random, now = Date.now()) {
    if (byId !== state.hostId) throw new Error("방장만 시작할 수 있어요.");
    if (state.phase !== "lobby") throw new Error("이미 시작했어요.");
    if (state.players.length < MIN_PLAYERS) throw new Error(`${MIN_PLAYERS}명 이상 모여야 해요.`);
    const tiles = shuffle([...Array(TILE_COUNT).keys()], rng);
    state.players = shuffle(state.players, rng).map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.bot ? { bot: true } : {}),
      rack: tiles.splice(0, HAND_SIZE),
      opened: state.settings.firstMeld === 0,
    }));
    state.pool = tiles;
    state.board = [];
    state.phase = "play";
    state.turn = 0;
    state.turnNo = 1;
    state.turnStart = now;
    state.passes = 0;
    state.lastMove = null;
    state.winnerId = null;
    state.results = null;
    state.round = (state.round || 0) + 1;
    return state;
  }

  function finish(state, winnerId) {
    state.phase = "over";
    state.winnerId = winnerId;
    state.results = state.players
      .map((p) => ({ id: p.id, name: p.name, left: Boolean(p.left), count: p.rack.length, points: rackPoints(p.rack) }))
      .sort((a, b) => (a.id === winnerId ? -1 : b.id === winnerId ? 1 : 0) || a.left - b.left || a.points - b.points);
    return state;
  }

  function nextTurn(state, now) {
    const n = state.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (state.turn + i) % n;
      if (!state.players[idx].left) {
        state.turn = idx;
        break;
      }
    }
    state.turnNo += 1;
    state.turnStart = now;
  }

  function requireTurn(state, id) {
    if (state.phase !== "play") throw new Error("지금은 게임 중이 아니에요.");
    const p = currentPlayer(state);
    if (!p || p.id !== id) throw new Error("내 차례가 아니에요.");
    return p;
  }

  function commitTurn(state, id, newBoard, now = Date.now()) {
    const p = requireTurn(state, id);
    const check = checkTurn(state.board, p.rack, p.opened, state.settings.firstMeld, newBoard);
    if (!check.ok) throw new Error(check.reason);
    const played = new Set(check.played);
    p.rack = p.rack.filter((t) => !played.has(t));
    p.opened = true;
    state.board = newBoard.map(arrangeSet);
    state.passes = 0;
    state.lastMove = { by: id, kind: "play", tiles: check.played, turnNo: state.turnNo };
    if (p.rack.length === 0) return finish(state, id);
    nextTurn(state, now);
    return state;
  }

  // 한 장 뽑고 넘기기 (더미가 비었으면 그냥 넘기기). kind: "draw" | "timeout"
  function drawTile(state, id, now = Date.now(), kind = "draw") {
    const p = requireTurn(state, id);
    if (state.pool.length) {
      p.rack.push(state.pool.pop());
      state.passes = 0;
      state.lastMove = { by: id, kind, turnNo: state.turnNo };
    } else {
      state.passes += 1;
      state.lastMove = { by: id, kind: kind === "timeout" ? "timeout" : "pass", empty: true, turnNo: state.turnNo };
      if (state.passes >= activePlayers(state).length) {
        // 아무도 더 못 놓아요: 남은 숫자 합이 가장 적은 사람이 승리
        const best = activePlayers(state).slice().sort((a, b) => rackPoints(a.rack) - rackPoints(b.rack) || a.rack.length - b.rack.length)[0];
        return finish(state, best.id);
      }
    }
    nextTurn(state, now);
    return state;
  }

  // 시간이 다 됐을 때: 누구나 부를 수 있어요. (그 사람 화면이 꺼져 있어도 게임이 멈추지 않게)
  function timeOut(state, turnNo, now = Date.now(), graceMs = 0) {
    if (state.phase !== "play" || state.turnNo !== turnNo) return undefined;
    const sec = state.settings.turnSec;
    if (!sec) return undefined;
    if (now < state.turnStart + sec * 1000 + graceMs) return undefined;
    return drawTile(state, currentPlayer(state).id, now, "timeout");
  }

  function removeFromGame(state, id, now) {
    const index = state.players.findIndex((p) => p.id === id);
    if (index === -1) return state;
    if (state.phase === "lobby") {
      state.players.splice(index, 1);
      if (state.hostId === id) {
        const next = state.players.find((p) => !p.bot);
        if (next) state.hostId = next.id;
        else state.players = []; // 사람이 없으면 방 정리
      }
      return state;
    }
    const player = state.players[index];
    if (player.left) return state;
    player.left = true;
    if (state.hostId === id) {
      const next = state.players.find((p) => !p.left && !p.bot);
      if (next) state.hostId = next.id;
    }
    if (state.phase !== "play") return state;
    // 나간 사람 타일은 더미로 돌려놓아요
    state.pool = shuffle(state.pool.concat(player.rack), Math.random);
    player.rack = [];
    const left = activePlayers(state);
    if (left.length <= 1 || left.every((p) => p.bot)) {
      return finish(state, left[0] ? left[0].id : null);
    }
    if (state.turn === index) {
      state.turn = index; // nextTurn 이 다음 사람을 찾아요
      nextTurn(state, now);
      state.passes = 0;
    }
    return state;
  }

  function leaveGame(state, id, now = Date.now()) {
    return removeFromGame(state, id, now);
  }

  function kick(state, byId, targetId, now = Date.now()) {
    if (byId !== state.hostId) throw new Error("방장만 내보낼 수 있어요.");
    if (byId === targetId) throw new Error("나 자신은 내보낼 수 없어요.");
    if (!findPlayer(state, targetId)) return state;
    removeFromGame(state, targetId, now);
    state.kicked = (state.kicked || []).concat(targetId).slice(-20);
    return state;
  }

  function backToLobby(state, byId) {
    if (byId !== state.hostId) throw new Error("방장만 할 수 있어요.");
    state.phase = "lobby";
    state.players = state.players.filter((p) => !p.left).map((p) => ({ id: p.id, name: p.name, ...(p.bot ? { bot: true } : {}), rack: [], opened: false }));
    state.pool = [];
    state.board = [];
    state.turn = 0;
    state.turnNo = 0;
    state.passes = 0;
    state.lastMove = null;
    state.winnerId = null;
    state.results = null;
    return state;
  }

  function addChat(state, id, text, now = Date.now()) {
    const p = findPlayer(state, id);
    if (!p) throw new Error("방에 있는 사람만 말할 수 있어요.");
    state.chat = (state.chat || []).concat({ id, name: p.name, text: String(text).slice(0, 60), t: now }).slice(-CHAT_KEEP);
    return state;
  }

  const api = {
    MIN_PLAYERS, MAX_PLAYERS, HAND_SIZE, TILE_COUNT, JOKER_POINTS, COLORS, COLOR_NAMES, FIRST_MELD_OPTIONS, TURN_OPTIONS,
    isJoker, tileColor, tileNum, tilePoints, tileLabel, shuffle,
    runInfo, groupInfo, isValidSet, arrangeSet, setPoints, rackPoints, checkTurn,
    createRoom, findPlayer, activePlayers, currentPlayer, addPlayer, addBot, setSettings, startGame,
    commitTurn, drawTile, timeOut, leaveGame, kick, backToLobby, addChat,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Rules = api;
})(typeof self !== "undefined" ? self : this);
