// 숨은 숫자 — 게임 규칙 (화면/네트워크와 상관없는 순수한 로직)
//
// 타일: 0~11 숫자가 검은색(dark)과 흰색(light) 두 색으로 하나씩, 모두 24장.
// 내 타일 줄은 항상 작은 숫자 → 큰 숫자 순서. 같은 숫자면 검은 타일이 왼쪽.
// 내 차례: 타일을 한 장 뽑고 → 다른 사람의 숨은 타일 하나를 골라 숫자를 맞힌다.
//   맞히면: 그 타일이 공개된다. 한 번 더 맞히거나, 멈출 수 있다(뽑은 타일은 숨긴 채 내 줄로).
//   틀리면: 뽑은 타일을 공개한 채 내 줄에 넣고 차례가 넘어간다.
// 타일이 모두 공개되면 탈락. 마지막까지 남은 사람이 승리.

export const MAX_NUMBER = 11;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

const COLOR_ORDER = { dark: 0, light: 1 };

export function compareTiles(a, b) {
  return a.n - b.n || COLOR_ORDER[a.c] - COLOR_ORDER[b.c];
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 조커: 숫자가 없는 타일 (j: true). 검은 조커 1장 + 흰 조커 1장.
export const JOKER = "J";
export const isJoker = (t) => Boolean(t && t.j);

function makeDeck(rng) {
  const tiles = [];
  for (let n = 0; n <= MAX_NUMBER; n++) {
    tiles.push({ n, c: "dark" }, { n, c: "light" });
  }
  tiles.push({ n: null, c: "dark", j: true }, { n: null, c: "light", j: true });
  return shuffle(tiles, rng);
}

// 숫자 타일 넣기: 조커는 자리가 고정이라 건너뛰고, 숫자 타일끼리만 순서를 맞춰요.
function insertSorted(hand, tile) {
  const i = hand.findIndex((t) => !isJoker(t) && compareTiles(tile, t) < 0);
  if (i === -1) hand.push(tile);
  else hand.splice(i, 0, tile);
}

export function isOut(player) {
  return player.hand.every((t) => t.open);
}

function alivePlayers(state) {
  return state.players.filter((p) => !isOut(p));
}

function addLog(state, text) {
  state.log.push(text);
  if (state.log.length > 30) state.log.shift();
}

// 새 방(대기실) 상태
export function createRoom(hostId, hostName) {
  return {
    phase: "lobby",
    hostId,
    players: [{ id: hostId, name: hostName, hand: [] }],
    deck: [],
    turn: 0,
    drawn: null,
    lastGuess: null,
    winnerId: null,
    log: [],
    chat: [],
    createdAt: Date.now(),
  };
}

// 채팅 한 줄 추가 (최근 40개만 보관). 글 다듬기·비속어 가리기는 보내는 쪽에서 해요.
export const CHAT_KEEP = 40;
export function addChat(state, id, text) {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error("방에 있는 사람만 채팅할 수 있어요.");
  const clean = String(text ?? "").trim().slice(0, 60);
  if (!clean) throw new Error("메시지를 써 주세요.");
  const chat = Array.isArray(state.chat) ? state.chat : [];
  chat.push({ id, name: player.name, text: clean, t: Date.now() });
  state.chat = chat.slice(-CHAT_KEEP);
  return state;
}

export function addPlayer(state, id, name) {
  if (state.players.some((p) => p.id === id)) return state;
  if (state.phase !== "lobby") throw new Error("이미 게임이 시작된 방이에요.");
  if (state.players.length >= MAX_PLAYERS) throw new Error(`방이 꽉 찼어요. (최대 ${MAX_PLAYERS}명)`);
  state.players.push({ id, name, hand: [] });
  return state;
}

export function removePlayer(state, id) {
  if (state.phase !== "lobby") return state;
  state.players = state.players.filter((p) => p.id !== id);
  if (state.hostId === id && state.players.length) state.hostId = state.players[0].id;
  return state;
}

export function startGame(state, byId, rng = Math.random) {
  if (byId !== state.hostId) throw new Error("방장만 시작할 수 있어요.");
  if (state.players.length < MIN_PLAYERS) throw new Error(`${MIN_PLAYERS}명 이상 모여야 시작할 수 있어요.`);
  const deck = makeDeck(rng);
  const handSize = state.players.length >= 4 ? 3 : 4;
  state.players = shuffle(state.players, rng).map((p) => {
    const hand = [];
    const pending = [];
    for (let i = 0; i < handSize; i++) {
      const tile = { ...deck.pop(), open: false };
      if (isJoker(tile)) pending.push(tile);
      else insertSorted(hand, tile);
    }
    return pending.length ? { ...p, hand, pending } : { ...p, hand };
  });
  state.deck = deck;
  state.phase = "guess";
  state.turn = 0;
  state.winnerId = null;
  state.lastGuess = null;
  state.log = [];
  addLog(state, `게임 시작! 첫 차례는 ${state.players[0].name}`);
  state.drawnIndex = null;
  // 모두 '타일 확인' 단계부터. 조커가 있는 사람은 자리를 정하고, 없는 사람은 준비 완료를 눌러요.
  // (누가 조커를 받았는지 다른 사람이 알 수 없게, 조커가 없어도 항상 이 단계를 거쳐요)
  state.phase = "setup";
  state.drawn = null;
  state.players.forEach((p) => { p.ready = false; });
  return state;
}

function allReady(state) {
  return state.players.every((p) => p.left || (p.ready && !p.pending?.length));
}

function finishSetup(state) {
  state.players.forEach((p) => { delete p.ready; });
  if (isOut(currentPlayer(state))) nextTurn(state);
  else beginTurn(state);
}

// 타일 확인 끝 (조커가 없는 사람). 조커가 있으면 다 놓아야 준비돼요.
export function markReady(state, byId) {
  if (state.phase !== "setup") throw new Error("지금은 준비 단계가 아니에요.");
  const player = state.players.find((p) => p.id === byId);
  if (!player) throw new Error("방에 없는 사람이에요.");
  if (player.pending?.length) throw new Error("조커 자리를 먼저 정해 주세요.");
  player.ready = true;
  if (allReady(state)) finishSetup(state);
  return state;
}

// 조커 자리 정하기. index = 내 받침대에서 놓을 칸 (0 = 맨 왼쪽)
export function placeJoker(state, byId, index) {
  const player = state.players.find((p) => p.id === byId);
  if (!player) throw new Error("방에 없는 사람이에요.");
  const at = (hand) => Math.max(0, Math.min(Number(index) || 0, hand.length));

  if (state.phase === "setup") {
    if (!player.pending?.length) throw new Error("놓을 조커가 없어요.");
    const tile = player.pending.shift();
    if (!player.pending.length) delete player.pending;
    player.hand.splice(at(player.hand), 0, { ...tile, open: false, fixed: true });
    if (!player.pending) player.ready = true; // 조커를 다 놓으면 자동으로 준비 완료
    if (allReady(state)) finishSetup(state);
    return state;
  }
  if (state.phase === "joker") {
    if (currentPlayer(state).id !== byId) throw new Error("내 차례가 아니에요.");
    const i = at(player.hand);
    player.hand.splice(i, 0, { ...state.drawn, open: false, fixed: true });
    state.drawn = null;
    state.drawnIndex = i; // 틀리면 이 조커가 공개돼요
    state.phase = "guess";
    return state;
  }
  throw new Error("지금은 조커를 놓을 수 없어요.");
}

function beginTurn(state) {
  state.drawn = state.deck.length ? { ...state.deck.pop(), open: false } : null;
  state.drawnIndex = null;
  state.phase = isJoker(state.drawn) ? "joker" : "guess";
}

function nextTurn(state) {
  const count = state.players.length;
  for (let step = 1; step <= count; step++) {
    const idx = (state.turn + step) % count;
    if (!isOut(state.players[idx])) {
      state.turn = idx;
      beginTurn(state);
      return;
    }
  }
}

function checkWinner(state) {
  for (const p of state.players) {
    if (isOut(p) && !p.outLogged) {
      p.outLogged = true;
      addLog(state, `💥 ${p.name} 탈락!`);
    }
  }
  const alive = alivePlayers(state);
  if (alive.length <= 1) {
    state.phase = "over";
    state.winnerId = alive[0]?.id ?? null;
    if (alive[0]) addLog(state, `🏆 ${alive[0].name} 승리!`);
    return true;
  }
  return false;
}

export function currentPlayer(state) {
  return state.players[state.turn];
}

// 숫자 맞히기
export function guess(state, byId, targetId, tileIndex, number) {
  const me = currentPlayer(state);
  if (state.phase !== "guess") throw new Error("지금은 맞힐 수 없어요.");
  if (me.id !== byId) throw new Error("내 차례가 아니에요.");
  const target = state.players.find((p) => p.id === targetId);
  if (!target || target.id === byId) throw new Error("다른 친구의 타일을 골라 주세요.");
  const tile = target.hand[tileIndex];
  if (!tile || tile.open) throw new Error("이미 공개된 타일이에요.");

  const saysJoker = number === JOKER;
  const correct = isJoker(tile) ? saysJoker : !saysJoker && tile.n === number;
  const said = saysJoker ? "조커" : number;
  state.lastGuess = { byId, targetId, tileIndex, number, correct };

  if (correct) {
    tile.open = true;
    addLog(state, `⭕ ${me.name} → ${target.name}의 타일은 ${said}! 정답`);
    if (checkWinner(state)) {
      if (state.drawn) insertSorted(me.hand, state.drawn);
      state.drawn = null;
      return state;
    }
    state.phase = "continue";
  } else {
    addLog(state, `❌ ${me.name} → ${target.name}의 타일이 ${said}? 틀렸어요`);
    if (state.drawnIndex != null && me.hand[state.drawnIndex]) {
      // 이번에 뽑아서 놓은 조커를 공개
      me.hand[state.drawnIndex].open = true;
      state.drawnIndex = null;
    } else if (state.drawn) {
      insertSorted(me.hand, { ...state.drawn, open: true });
      state.drawn = null;
    } else {
      // 더미가 비었으면 내 숨은 타일 하나를 공개
      const hidden = me.hand.filter((t) => !t.open);
      if (hidden.length) hidden[Math.floor(Math.random() * hidden.length)].open = true;
    }
    if (!checkWinner(state)) nextTurn(state);
  }
  return state;
}

// 정답을 맞힌 뒤 멈추기
export function stop(state, byId) {
  const me = currentPlayer(state);
  if (state.phase !== "continue" || me.id !== byId) throw new Error("지금은 멈출 수 없어요.");
  if (state.drawn) insertSorted(me.hand, state.drawn);
  state.drawn = null;
  addLog(state, `✋ ${me.name} 멈춤`);
  nextTurn(state);
  return state;
}

// 정답을 맞힌 뒤 한 번 더 도전
export function keepGoing(state, byId) {
  const me = currentPlayer(state);
  if (state.phase !== "continue" || me.id !== byId) throw new Error("지금은 할 수 없어요.");
  state.phase = "guess";
  return state;
}

// 방/게임에서 나가기 (처음으로 버튼)
// 대기실: 명단에서 빠짐. 게임 중: 타일을 모두 공개해서 탈락 처리하고 게임은 계속.
export function leaveGame(state, id) {
  if (state.phase === "lobby") return removePlayer(state, id);
  const index = state.players.findIndex((p) => p.id === id);
  if (index === -1) return state;
  const player = state.players[index];
  if (player.left) return state;
  player.left = true;
  if (state.hostId === id) {
    const next = state.players.find((p) => !p.left);
    if (next) state.hostId = next.id;
  }
  if (state.phase === "over") return state;

  const wasTurn = state.turn === index;
  if (player.pending?.length) {
    player.hand.push(...player.pending);
    delete player.pending;
  }
  const alreadyOut = isOut(player);
  player.hand.forEach((t) => { t.open = true; });
  player.outLogged = true;
  addLog(state, `🚪 ${player.name} 나감${alreadyOut ? "" : " (탈락)"}`);

  // 나간 사람이 뽑아 둔 타일은 더미로 되돌림
  if (wasTurn && state.drawn) {
    const { open, fixed, ...tile } = state.drawn; // 조커 표시(j)는 그대로
    state.deck.splice(Math.floor(Math.random() * (state.deck.length + 1)), 0, tile);
    state.drawn = null;
  }
  if (checkWinner(state)) {
    if (state.drawn) insertSorted(currentPlayer(state).hand, state.drawn);
    state.drawn = null;
    return state;
  }
  if (state.phase === "setup") {
    // 남은 사람들이 모두 준비됐으면 시작
    if (allReady(state)) finishSetup(state);
    return state;
  }
  if (wasTurn) nextTurn(state);
  return state;
}

// 방장이 다른 사람 내보내기 (탭을 닫고 사라진 '유령' 자리 때문에 게임이 멈출 때)
export function kickPlayer(state, byId, targetId) {
  if (byId !== state.hostId) throw new Error("방장만 내보낼 수 있어요.");
  if (byId === targetId) throw new Error("나는 내보낼 수 없어요.");
  if (!state.players.some((p) => p.id === targetId)) return state;
  return leaveGame(state, targetId);
}

// 같은 친구들끼리 다시 하기
export function backToLobby(state, byId) {
  if (byId !== state.hostId) throw new Error("방장만 할 수 있어요.");
  state.phase = "lobby";
  state.players = state.players.filter((p) => !p.left).map(({ id, name }) => ({ id, name, hand: [] }));
  state.drawnIndex = null;
  state.deck = [];
  state.drawn = null;
  state.lastGuess = null;
  state.winnerId = null;
  state.log = [];
  return state;
}
