// build-local-preview.mjs로 생성. 직접 수정하지 마세요.
// file:// 미리보기는 Firebase를 사용하지 않는 연습 모드입니다.
(() => {
"use strict";
const G = (() => {
// 숨은 숫자 — 게임 규칙 (화면/네트워크와 상관없는 순수한 로직)
//
// 타일: 0~11 숫자가 검은색(dark)과 흰색(light) 두 색으로 하나씩, 모두 24장.
// 내 타일 줄은 항상 작은 숫자 → 큰 숫자 순서. 같은 숫자면 검은 타일이 왼쪽.
// 내 차례: 타일을 한 장 뽑고 → 다른 사람의 숨은 타일 하나를 골라 숫자를 맞힌다.
//   맞히면: 그 타일이 공개된다. 한 번 더 맞히거나, 멈출 수 있다(뽑은 타일은 숨긴 채 내 줄로).
//   틀리면: 뽑은 타일을 공개한 채 내 줄에 넣고 차례가 넘어간다.
// 타일이 모두 공개되면 탈락. 마지막까지 남은 사람이 승리.

const MAX_NUMBER = 11;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

const COLOR_ORDER = { dark: 0, light: 1 };

function compareTiles(a, b) {
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
const JOKER = "J";
const isJoker = (t) => Boolean(t && t.j);

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

function isOut(player) {
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
function createRoom(hostId, hostName) {
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
const CHAT_KEEP = 40;
function addChat(state, id, text) {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error("방에 있는 사람만 채팅할 수 있어요.");
  const clean = String(text ?? "").trim().slice(0, 60);
  if (!clean) throw new Error("메시지를 써 주세요.");
  const chat = Array.isArray(state.chat) ? state.chat : [];
  chat.push({ id, name: player.name, text: clean, t: Date.now() });
  state.chat = chat.slice(-CHAT_KEEP);
  return state;
}

function addPlayer(state, id, name) {
  if (state.players.some((p) => p.id === id)) return state;
  if (state.phase !== "lobby") throw new Error("이미 게임이 시작된 방이에요.");
  if (state.players.length >= MAX_PLAYERS) throw new Error(`방이 꽉 찼어요. (최대 ${MAX_PLAYERS}명)`);
  state.players.push({ id, name, hand: [] });
  return state;
}

function removePlayer(state, id) {
  if (state.phase !== "lobby") return state;
  state.players = state.players.filter((p) => p.id !== id);
  if (state.hostId === id && state.players.length) state.hostId = state.players[0].id;
  return state;
}

function startGame(state, byId, rng = Math.random) {
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
function markReady(state, byId) {
  if (state.phase !== "setup") throw new Error("지금은 준비 단계가 아니에요.");
  const player = state.players.find((p) => p.id === byId);
  if (!player) throw new Error("방에 없는 사람이에요.");
  if (player.pending?.length) throw new Error("조커 자리를 먼저 정해 주세요.");
  player.ready = true;
  if (allReady(state)) finishSetup(state);
  return state;
}

// 조커 자리 정하기. index = 내 받침대에서 놓을 칸 (0 = 맨 왼쪽)
function placeJoker(state, byId, index) {
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

function currentPlayer(state) {
  return state.players[state.turn];
}

// 숫자 맞히기
function guess(state, byId, targetId, tileIndex, number) {
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
function stop(state, byId) {
  const me = currentPlayer(state);
  if (state.phase !== "continue" || me.id !== byId) throw new Error("지금은 멈출 수 없어요.");
  if (state.drawn) insertSorted(me.hand, state.drawn);
  state.drawn = null;
  addLog(state, `✋ ${me.name} 멈춤`);
  nextTurn(state);
  return state;
}

// 정답을 맞힌 뒤 한 번 더 도전
function keepGoing(state, byId) {
  const me = currentPlayer(state);
  if (state.phase !== "continue" || me.id !== byId) throw new Error("지금은 할 수 없어요.");
  state.phase = "guess";
  return state;
}

// 방/게임에서 나가기 (처음으로 버튼)
// 대기실: 명단에서 빠짐. 게임 중: 타일을 모두 공개해서 탈락 처리하고 게임은 계속.
function leaveGame(state, id) {
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

// 같은 친구들끼리 다시 하기
function backToLobby(state, byId) {
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

return { MAX_NUMBER, MIN_PLAYERS, MAX_PLAYERS, compareTiles, JOKER, isJoker, isOut, createRoom, CHAT_KEEP, addChat, addPlayer, removePlayer, startGame, markReady, placeJoker, currentPlayer, guess, stop, keepGoing, leaveGame, backToLobby };
})();
const firebaseConfig = {};
// 손과 타일은 화면 위에서만 움직입니다. 게임 상태나 버튼 입력은 기다리지 않습니다.
function createMotionController() {
  const noop = { rect: () => null, play() {}, point() {}, demo() {}, cancel() {}, bind() {} };
  if (typeof document.createElement("div").animate !== "function") return noop;

  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let stored = null;
  try { stored = localStorage.getItem("hn-hand-motion"); } catch { /* 기본 설정 사용 */ }
  let enabled = stored === "on" || (stored !== "off" && !preference.matches);
  let sequence = 0;
  let animations = [];
  let concealed = [];
  let toggle = null;
  let demoButton = null;
  const layer = document.createElement("div");
  layer.className = "hand-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.state = "idle";
  document.body.append(layer);

  const images = new Map();
  function imageFor(pose) {
    if (!images.has(pose)) {
      const img = new Image();
      img.src = `assets/hand-${pose}-cute.png`;
      images.set(pose, img.decode().then(() => img).catch(() => null));
    }
    return images.get(pose);
  }
  imageFor("point");
  imageFor("pinch");

  function cancel() {
    sequence++;
    for (const animation of animations) animation.cancel();
    animations = [];
    for (const node of concealed) node.classList.remove("motion-arriving");
    concealed = [];
    layer.replaceChildren();
    layer.dataset.state = "idle";
  }

  function rect(node) {
    if (!node?.isConnected) return null;
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, scrollY: window.scrollY };
  }

  function visible(r) {
    return r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  }

  function anchor(r, carry) {
    return { x: r.left + r.width / 2, y: carry ? r.bottom - 6 : r.top + r.height * .42 };
  }

  function syncControls() {
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(enabled));
      toggle.textContent = enabled ? "손 연출 켜짐" : "손 연출 꺼짐";
    }
    if (demoButton) demoButton.disabled = !enabled;
  }

  async function gesture(step, token) {
    const carry = step.kind === "carry";
    const photo = await imageFor(carry ? "pinch" : "point");
    if (!photo || token !== sequence || !enabled || !step.to?.isConnected) return;
    const target = rect(step.to);
    if (!visible(target)) return;
    let source = step.from?.nodeType ? rect(step.from) : step.from;
    if (source && Number.isFinite(source.scrollY)) {
      const shift = source.scrollY - window.scrollY;
      source = { ...source, top: source.top + shift, bottom: source.bottom + shift };
    }
    if (carry && !visible(source)) return;
    const end = anchor(target, carry);
    const start = carry ? anchor(source, true) : end;
    const direction = step.mine === false ? -1 : 1;
    const ratio = photo.naturalHeight / photo.naturalWidth;
    // 타일 하나 정도의 작은 손. 화면 높이에 따라 커지지 않습니다.
    const width = Math.max(56, Math.min(innerWidth <= 600 ? 76 : 92, target.width * 1.35));
    const height = width * ratio;
    const group = document.createElement("div");
    group.className = "hand-gesture";
    const hand = photo.cloneNode();
    hand.className = "gesture-hand";
    hand.alt = "";
    hand.draggable = false;
    hand.style.width = `${width}px`;
    const fingertip = carry ? .15 : .12;
    hand.style.left = `${-width * .5}px`;
    hand.style.top = `${-height * fingertip}px`;
    hand.style.transformOrigin = `50% ${fingertip * 100}%`;
    hand.style.transform = `rotate(${direction === -1 ? 180 : 0}deg)`;
    group.append(hand);
    layer.append(group);
    layer.dataset.state = carry ? "carry" : "point";

    const transform = (x, y, turn = 0) => `translate3d(${x}px, ${y}px, 0) rotate(${turn}deg)`;
    const frames = carry ? [
      { transform: transform(start.x + 14, start.y + direction * 42, -8 * direction), opacity: 0, offset: 0 },
      { transform: transform(start.x, start.y), opacity: 1, offset: .22 },
      { transform: transform(start.x, start.y + direction * 3), opacity: 1, offset: .31 },
      { transform: transform((start.x + end.x) / 2, (start.y + end.y) / 2 - 16), opacity: 1, offset: .53 },
      { transform: transform(end.x, end.y), opacity: 1, offset: .72 },
      { transform: transform(end.x, end.y), opacity: 1, offset: .79 },
      { transform: transform(end.x + 18, end.y + direction * 48, 8 * direction), opacity: 0, offset: 1 },
    ] : [
      { transform: transform(end.x + 14, end.y + direction * 38, -8 * direction), opacity: 0, offset: 0 },
      { transform: transform(end.x, end.y - direction * 7), opacity: 1, offset: .3 },
      { transform: transform(end.x, end.y + direction * 2), opacity: 1, offset: .46 },
      { transform: transform(end.x, end.y - direction * 5), opacity: 1, offset: .64 },
      { transform: transform(end.x + 18, end.y + direction * 42, 8 * direction), opacity: 0, offset: 1 },
    ];
    const duration = step.duration || (carry ? 760 : 570);
    const timing = { duration, easing: "linear", fill: "both" };
    const handAnimation = group.animate(frames.map(frame => ({ ...frame, easing: "cubic-bezier(.25,.65,.3,1)" })), timing);
    animations.push(handAnimation);

    if (carry) {
      const ghost = step.to.cloneNode(true);
      ghost.classList.remove("selected", "flash-good", "flash-bad", "motion-arriving");
      ghost.classList.add("motion-tile");
      ghost.removeAttribute("aria-label");
      ghost.removeAttribute("id");
      ghost.tabIndex = -1;
      ghost.style.width = `${target.width}px`;
      ghost.style.height = `${target.height}px`;
      ghost.style.left = `${-target.width / 2}px`;
      ghost.style.top = `${-target.height + 6}px`;
      ghost.style.fontSize = `${target.width * .58}px`;
      ghost.querySelector(".mark")?.remove();
      ghost.querySelector("small")?.remove();
      group.prepend(ghost);
      step.to.classList.add("motion-arriving");
      concealed.push(step.to);
      const held = ghost.animate([
        { opacity: 0, transform: "rotate(-5deg)", offset: 0 },
        { opacity: 0, transform: "rotate(-5deg)", offset: .28 },
        { opacity: 1, transform: "rotate(-5deg)", offset: .32 },
        { opacity: 1, transform: "rotate(3deg)", offset: .53 },
        { opacity: 1, transform: "rotate(0deg)", offset: .73 },
        { opacity: 0, transform: "rotate(0deg)", offset: .77 },
        { opacity: 0, offset: 1 },
      ], timing);
      animations.push(held);
      const reveal = setTimeout(() => {
        if (token === sequence) step.to.classList.remove("motion-arriving");
      }, duration * .76);
      try { await handAnimation.finished; } catch { /* 다른 동작으로 전환 */ }
      clearTimeout(reveal);
      step.to.classList.remove("motion-arriving");
    } else {
      try { await handAnimation.finished; } catch { /* 다른 동작으로 전환 */ }
    }
    group.remove();
  }

  function play(steps) {
    cancel();
    if (!enabled || document.hidden) return;
    const token = sequence;
    (async () => {
      try {
        // 버튼 패널이 바뀔 때 발생하는 브라우저의 스크롤 보정 후에 좌표를 읽습니다.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        for (const step of steps) {
          if (token !== sequence) break;
          await gesture(step, token);
        }
      } finally {
        if (token === sequence) cancel();
      }
    })().catch(() => { if (token === sequence) cancel(); });
  }

  window.addEventListener("wheel", cancel, { passive: true });
  window.addEventListener("touchmove", cancel, { passive: true });
  window.addEventListener("keydown", event => {
    if (document.activeElement?.tagName === "INPUT") return;
    if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key)) cancel();
  });
  window.addEventListener("resize", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  preference.addEventListener("change", () => {
    if (stored === null) { enabled = !preference.matches; cancel(); syncControls(); }
  });

  return {
    rect, play, cancel,
    point: node => play([{ kind: "point", to: node, mine: true }]),
    demo: node => play([{ kind: "carry", from: node, to: node, mine: true, duration: 1100 }]),
    bind(button, preview) {
      toggle = button;
      demoButton = preview;
      toggle.addEventListener("click", () => {
        enabled = !enabled;
        stored = enabled ? "on" : "off";
        try { localStorage.setItem("hn-hand-motion", stored); } catch { /* 현재 창에만 적용 */ }
        cancel();
        syncControls();
      });
      syncControls();
    },
  };
}

// 효과음 — 소리 파일 없이 브라우저(Web Audio)가 직접 만들어요.
// 브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 막기 때문에, 첫 클릭 때 소리 장치를 켭니다.
function createSound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const noop = { play() {}, bind() {} };
  if (!AudioCtx) return noop;

  let stored = null;
  try { stored = localStorage.getItem("hn-sound"); } catch { /* 기본값 사용 */ }
  let enabled = stored !== "off";
  let ctx = null;
  let master = null;
  let toggle = null;

  function unlock() {
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
  }
  for (const type of ["pointerdown", "keydown", "touchstart"]) {
    window.addEventListener(type, unlock, { passive: true });
  }

  // 기본 음 하나: 주파수, 시작(초), 길이, 파형, 크기, 끝 주파수
  function tone(freq, at, dur, { type = "sine", gain = 0.3, to = null, attack = 0.008 } = {}) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // 종소리 느낌: 기본음 + 배음
  function bell(freq, at, dur, gain = 0.22) {
    tone(freq, at, dur, { gain });
    tone(freq * 2, at, dur * 0.6, { gain: gain * 0.35 });
    tone(freq * 3, at, dur * 0.3, { gain: gain * 0.12 });
  }

  // "스윽" 하는 바람 소리
  function swish(at, dur, gain = 0.25) {
    const t = ctx.currentTime + at;
    const length = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

  const sounds = {
    tap() { tone(1200, 0, 0.06, { type: "triangle", gain: 0.18, to: 900 }); },
    draw() {
      swish(0, 0.22, 0.18);
      tone(520, 0.16, 0.08, { type: "triangle", gain: 0.12, to: 380 });
    },
    correct() { bell(G5, 0, 0.35); bell(C6, 0.13, 0.6); },
    wrong() {
      tone(330, 0, 0.18, { type: "triangle", gain: 0.25, to: 280 });
      tone(250, 0.17, 0.35, { type: "triangle", gain: 0.25, to: 170 });
    },
    myturn() { bell(E5, 0, 0.3, 0.16); bell(G5 * 1.0, 0.12, 0.45, 0.16); },
    join() { tone(380, 0, 0.12, { gain: 0.25, to: 950 }); },
    start() {
      [C5, E5, G5, C6].forEach((f, i) => bell(f, i * 0.09, 0.4, 0.17));
    },
    win() {
      [C5, E5, G5].forEach((f, i) => bell(f, i * 0.12, 0.3, 0.2));
      bell(C6, 0.38, 0.9, 0.22);
      bell(E5 * 2, 0.38, 0.9, 0.12);
      bell(G5, 0.38, 0.9, 0.12);
    },
    lose() {
      [G5, E5, C5].forEach((f, i) => tone(f, i * 0.2, 0.32, { type: "triangle", gain: 0.2 }));
    },
    chat() { tone(880, 0, 0.07, { gain: 0.12 }); tone(1320, 0.07, 0.1, { gain: 0.1 }); },
    out() {
      tone(392, 0, 0.25, { type: "triangle", gain: 0.25, to: 330 });
      tone(311, 0.25, 0.5, { type: "triangle", gain: 0.25, to: 196 });
    },
  };

  function play(name) {
    if (!enabled || !ctx || ctx.state !== "running" || !sounds[name]) return;
    try { sounds[name](); } catch { /* 소리는 없어도 게임은 계속 */ }
  }

  function sync() {
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.textContent = enabled ? "소리 켜짐" : "소리 꺼짐";
  }

  return {
    play,
    bind(button) {
      toggle = button;
      button.addEventListener("click", () => {
        enabled = !enabled;
        try { localStorage.setItem("hn-sound", enabled ? "on" : "off"); } catch { /* 현재 창에만 적용 */ }
        sync();
        if (enabled) { unlock(); setTimeout(() => play("tap"), 30); }
      });
      sync();
    },
  };
}

// 채팅 비속어 가리기
// 흔한 욕설을 *** 로 바꿔요. 글자 사이에 띄어쓰기·숫자·기호를 넣어도 잡아요 (예: "시 1 발").
// 모든 나쁜 말을 막을 수는 없어요. 단어를 더 막고 싶으면 아래 목록에 추가하세요.
const BAD_WORDS = [
  "시발", "씨발", "씨빨", "씨바", "시바", "ㅅㅂ", "ㅆㅂ", "ㅅ ㅂ", "십새", "씹",
  "병신", "븅신", "빙신", "ㅂㅅ",
  "개새끼", "개새기", "새끼야", "새기야", "ㅅㄲ",
  "지랄", "ㅈㄹ", "좆", "존나", "졸라", "ㅈㄴ", "좃",
  "미친놈", "미친년", "미친새", "ㅁㅊ",
  "닥쳐", "꺼져", "엿먹", "썅", "쌍놈", "염병", "엠창", "니애미", "느금", "애미", "애비",
  "또라이", "찐따", "등신",
  "fuck", "shit", "bitch", "damn",
];

const escape = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 글자 사이에 공백·숫자·기호가 끼어 있어도 잡도록
const GAP = "[\\s\\d_\\-.,!?~*^'\"`·•/\\\\]*";
const PATTERNS = BAD_WORDS
  .map((w) => w.replace(/\s/g, ""))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length)
  .map((w) => new RegExp([...w].map(escape).join(GAP), "gi"));

const CHAT_MAX = 60;

function cleanText(text) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
  for (const re of PATTERNS) out = out.replace(re, (m) => "*".repeat(Math.min(m.length, 6)));
  return out;
}

// 게임 방 상태를 여러 기기가 함께 보도록 연결하는 부분.
// - firebase-config.js 가 채워져 있으면: Firebase 실시간 데이터베이스 (여러 크롬북용)
// - 비어 있으면: 연습 모드 (한 컴퓨터의 여러 탭끼리만 연결)


const FIREBASE_VERSION = "10.12.2";

function hasFirebaseConfig() {
  return Boolean(firebaseConfig && firebaseConfig.databaseURL && firebaseConfig.apiKey);
}

// 상태 변경 함수(fn)를 안전하게 실행. fn 이 오류를 던지면 변경을 취소하고 오류를 돌려준다.
function guarded(fn) {
  const box = { error: null };
  const run = (current) => {
    try {
      box.error = null;
      return fn(current);
    } catch (e) {
      box.error = e;
      return undefined;
    }
  };
  return { box, run };
}

async function firebaseBackend() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const { getDatabase, ref, onValue, runTransaction, set, remove, onDisconnect } = await import(`${base}/firebase-database.js`);
  const db = getDatabase(initializeApp(firebaseConfig));
  const roomRef = (code) => ref(db, `rooms/${code}`);
  const decode = (raw) => (raw && raw.s ? JSON.parse(raw.s) : null);

  return {
    mode: "online",
    subscribe(code, cb) {
      return onValue(roomRef(code), (snap) => cb(decode(snap.val())));
    },
    async update(code, fn) {
      const { box, run } = guarded(fn);
      const result = await runTransaction(roomRef(code), (raw) => {
        const next = run(decode(raw));
        if (next === undefined) return undefined;
        return { s: JSON.stringify(next), t: Date.now() };
      });
      if (box.error) throw box.error;
      return result.committed;
    },
    // 열려 있는 방 목록 (lobby/방번호 = { host, count, max, ts })
    watchLobby(cb, onError) {
      return onValue(ref(db, "lobby"), (snap) => cb(snap.val() || {}), (err) => onError && onError(err));
    },
    async setLobby(code, info) {
      const r = ref(db, `lobby/${code}`);
      if (info) {
        await set(r, info);
        onDisconnect(r).remove(); // 방장이 창을 닫으면 목록에서 사라짐
      } else {
        onDisconnect(r).cancel();
        await remove(r);
      }
    },
  };
}

function localBackend() {
  const key = (code) => `hidden-number-room-${code}`;
  const listeners = new Map();
  const read = (code) => {
    const raw = localStorage.getItem(key(code));
    return raw ? JSON.parse(raw) : null;
  };
  const notify = (code) => (listeners.get(code) || []).forEach((cb) => cb(read(code)));

  const LOBBY_KEY = "hidden-number-lobby";
  let lobbyListeners = [];
  const readLobby = () => {
    try { return JSON.parse(localStorage.getItem(LOBBY_KEY)) || {}; } catch { return {}; }
  };

  window.addEventListener("storage", (e) => {
    if (e.key === LOBBY_KEY) { const all = readLobby(); lobbyListeners.forEach((cb) => cb(all)); return; }
    if (!e.key || !e.key.startsWith("hidden-number-room-")) return;
    notify(e.key.slice("hidden-number-room-".length));
  });

  return {
    mode: "local",
    subscribe(code, cb) {
      const list = listeners.get(code) || [];
      list.push(cb);
      listeners.set(code, list);
      cb(read(code));
      return () => listeners.set(code, (listeners.get(code) || []).filter((x) => x !== cb));
    },
    async update(code, fn) {
      const { box, run } = guarded(fn);
      const next = run(read(code));
      if (box.error) throw box.error;
      if (next === undefined) return false;
      localStorage.setItem(key(code), JSON.stringify(next));
      notify(code);
      return true;
    },
    watchLobby(cb) {
      lobbyListeners.push(cb);
      cb(readLobby());
      return () => { lobbyListeners = lobbyListeners.filter((x) => x !== cb); };
    },
    async setLobby(code, info) {
      const all = readLobby();
      if (info) all[code] = info;
      else delete all[code];
      localStorage.setItem(LOBBY_KEY, JSON.stringify(all));
      lobbyListeners.forEach((cb) => cb(all));
    },
  };
}

async function connect() {
  if (hasFirebaseConfig()) {
    try {
      return await firebaseBackend();
    } catch (e) {
      console.error("Firebase 연결 실패, 연습 모드로 전환", e);
    }
  }
  return localBackend();
}

// 숨은 숫자 — 화면과 버튼을 연결하는 코드

const $ = (id) => document.getElementById(id);
const motion = createMotionController();
const sound = createSound();
let soundPrev = null;
let motionSnapshot = null;

// 탭마다 고유한 '나' (새로고침해도 유지)
function storageGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch { /* 저장 못 해도 게임은 진행 */ }
}

let myId = storageGet("hn-id");
if (!myId) {
  myId = Math.random().toString(36).slice(2, 10);
  storageSet("hn-id", myId);
}

let net = null;
let roomCode = null;
let unsubscribe = null;
let state = null;
let selected = null; // { targetId, index }
let lastLogLength = 0;
let selectedTurnKey = "";

// ---------- 작은 도우미 ----------
let toastTimer = null;
function toast(message, duration = 2600) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), duration);
}

let activeScreen = null;
function show(screenId) {
  $("home-btn")?.classList.toggle("hidden", screenId === "home");
  $("chat")?.classList.toggle("hidden", screenId === "home");
  for (const id of ["home", "lobby", "game"]) $(id).classList.toggle("hidden", id !== screenId);
  if (activeScreen !== screenId) {
    motion.cancel();
    if (screenId !== "game") motionSnapshot = null;
    activeScreen = screenId;
    window.scrollTo({ top: 0, behavior: "auto" });
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function myName() {
  return $("name").value.trim();
}

async function act(change) {
  try {
    await net.update(roomCode, (s) => {
      if (!s) throw new Error("방이 사라졌어요.");
      return change(s);
    });
  } catch (e) {
    toast(e.message || "문제가 생겼어요. 다시 해 주세요.");
  }
}

// ---------- 방 들어가기 / 나가기 ----------
function watch(code) {
  if (unsubscribe) unsubscribe();
  roomCode = code;
  lastLogLength = 0;
  soundPrev = null; // 방에 처음 들어올 때는 소리 없이 시작
  resetChat();
  return new Promise((resolve) => {
    let first = true;
    unsubscribe = net.subscribe(code, (s) => {
      state = s;
      if (first) {
        first = false;
        resolve(s);
      }
      render();
    });
  });
}

function leaveRoom() {
  unpublishLobby();
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  roomCode = null;
  state = null;
  storageSet("hn-room", null);
  show("home");
}

// 처음 화면으로: 게임 중이면 한 번 물어보고, 나간 사람은 탈락 처리
async function goHome() {
  if (!roomCode) return show("home");
  const me = state?.players.find((p) => p.id === myId);
  const playing = state && (state.phase === "guess" || state.phase === "continue") && me && !G.isOut(me);
  if (playing && !window.confirm("게임을 그만두고 처음 화면으로 갈까요?\n그만두면 내 타일이 모두 공개되고 탈락해요.")) return;
  unpublishLobby(); // 새 방장이 다시 올리기 전에 내 목록을 먼저 내림
  if (state) await act((s) => G.leaveGame(s, myId));
  leaveRoom();
}

async function createRoom() {
  const name = myName();
  if (!name) {
    $("name").focus();
    return toast("이름을 먼저 써 주세요.");
  }
  const button = $("create");
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "방 만드는 중…";
  try {
    storageSet("hn-name", name);
    for (let tries = 0; tries < 8; tries++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      let made = false;
      try {
        made = await net.update(code, (s) => (s ? undefined : G.createRoom(myId, name)));
      } catch (e) {
        console.error("방 만들기 실패", e);
        return toast(net.mode === "local"
          ? "브라우저 저장소에 방을 만들지 못했어요. 일반 브라우저 창에서 다시 열어 주세요."
          : "방을 만들지 못했어요. 인터넷 연결과 Firebase 데이터베이스 권한을 확인해 주세요.");
      }
      if (made) {
        storageSet("hn-room", code);
        await watch(code);
        return;
      }
    }
    toast("방을 만들지 못했어요. 다시 눌러 주세요.");
  } finally {
    button.disabled = false;
    button.textContent = "새 방 만들기";
  }
}

async function joinRoom(code, { silent = false } = {}) {
  const name = myName() || storageGet("hn-name");
  if (!name) return toast("이름을 먼저 써 주세요.");
  if (!/^\d{4}$/.test(code)) return toast("방 번호 4자리를 써 주세요.");
  storageSet("hn-name", name);

  const current = await watch(code);
  if (!current) {
    leaveRoom();
    if (!silent) toast("그런 방이 없어요. 번호를 다시 확인해 주세요.");
    return;
  }
  if (!current.players.some((p) => p.id === myId)) {
    try {
      await net.update(code, (s) => {
        if (!s) throw new Error("그런 방이 없어요.");
        return G.addPlayer(s, myId, name);
      });
    } catch (e) {
      leaveRoom();
      toast(e.message);
      return;
    }
  }
  storageSet("hn-room", code);
}

// ---------- 화면 그리기 ----------
// ---------- 효과음: 이전 상태와 비교해서 무슨 일이 생겼는지 알아내기 ----------
function soundSummary(s) {
  const me = s.players.find((p) => p.id === myId);
  return {
    phase: s.phase,
    count: s.players.length,
    guess: s.lastGuess ? `${JSON.stringify(s.lastGuess)}#${s.log.length}` : "",
    draw: s.drawn ? `${s.turn}-${s.drawn.n}-${s.drawn.c}` : "",
    turnId: s.phase === "lobby" ? null : s.players[s.turn]?.id,
    meOut: s.phase !== "lobby" && !!me && G.isOut(me),
  };
}

function playStateSounds(next) {
  const prev = soundPrev;
  const cur = soundSummary(next);
  soundPrev = cur;
  if (!prev) return;

  let delay = 0;
  const queue = (name) => {
    setTimeout(() => sound.play(name), delay);
    delay += 450;
  };

  if (cur.phase === "lobby") {
    if (prev.phase === "lobby" && cur.count > prev.count) queue("join");
    return;
  }
  if (prev.phase === "lobby") {
    // 순서는 게임 시작 때 무작위로 섞여요. 모두에게 알려 주기
    const order = next.players.map((p) => (p.id === myId ? `${p.name}(나)` : p.name)).join(" → ");
    const first = next.players[next.turn];
    toast(`🎲 순서를 섞었어요! ${first.id === myId ? "내가" : first.name + "이(가)"} 먼저 해요\n${order}`, 4500);
    queue("start");
    if (cur.turnId === myId) queue("myturn");
    return;
  }
  if (cur.guess && cur.guess !== prev.guess) queue(next.lastGuess.correct ? "correct" : "wrong");
  if (cur.phase === "over") {
    if (prev.phase !== "over") queue(next.winnerId === myId ? "win" : "lose");
    return;
  }
  if (cur.meOut && !prev.meOut) queue("out");
  if (cur.draw && cur.draw !== prev.draw) queue("draw");
  if (cur.turnId === myId && prev.turnId !== myId) queue("myturn");
}

function render() {
  if (!roomCode) return show("home");
  if (!state) {
    leaveRoom();
    return toast("방이 사라졌어요.");
  }
  playStateSounds(state);
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    // 대기실에서 빠졌거나, 게임이 이미 시작된 방
    if (state.phase === "lobby") return;
    leaveRoom();
    return toast("이미 게임이 시작된 방이에요.");
  }
  syncLobby();
  if (state.phase === "lobby") renderLobby();
  else renderGame(me);
  renderChat();
}

// ---------- 채팅 ----------
let chatSeen = -1;      // 지금까지 본 마지막 메시지 시각 (-1: 아직 처음)
let chatUnread = 0;
let chatLastSent = 0;
let peekTimer = null;

function resetChat() {
  chatSeen = -1;
  chatUnread = 0;
  $("chat-list")?.replaceChildren();
  setChatOpen(false);
  updateUnread();
}

function setChatOpen(open) {
  $("chat-panel").classList.toggle("hidden", !open);
  $("chat-toggle").setAttribute("aria-expanded", String(open));
  if (open) {
    chatUnread = 0;
    updateUnread();
    $("chat-peek").classList.add("hidden");
    const list = $("chat-list");
    list.scrollTop = list.scrollHeight;
    setTimeout(() => $("chat-input").focus(), 30);
  }
}

function updateUnread() {
  const badge = $("chat-unread");
  badge.textContent = chatUnread > 9 ? "9+" : String(chatUnread);
  badge.classList.toggle("hidden", chatUnread === 0);
}

function renderChat() {
  const chat = Array.isArray(state?.chat) ? state.chat : [];
  const list = $("chat-list");
  const open = !$("chat-panel").classList.contains("hidden");
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const fresh = chatSeen < 0 ? [] : chat.filter((m) => m.t > chatSeen && m.id !== myId);

  list.replaceChildren(
    ...(chat.length ? chat.map((m) => {
      const li = el("li", m.id === myId ? "chat-msg mine" : "chat-msg");
      if (m.id !== myId) li.append(el("span", "chat-name", m.name));
      li.append(el("span", "chat-text", cleanText(m.text)));
      return li;
    }) : [el("li", "chat-empty", "아직 메시지가 없어요. 인사해 볼까요?")]),
  );
  if (open ? atBottom || fresh.length : true) list.scrollTop = list.scrollHeight;

  if (fresh.length) {
    sound.play("chat");
    if (!open) {
      chatUnread += fresh.length;
      updateUnread();
      const last = fresh[fresh.length - 1];
      const peek = $("chat-peek");
      peek.textContent = `${last.name}: ${cleanText(last.text)}`;
      peek.classList.remove("hidden");
      clearTimeout(peekTimer);
      peekTimer = setTimeout(() => peek.classList.add("hidden"), 3500);
    }
  }
  chatSeen = chat.length ? chat[chat.length - 1].t : 0;
}

async function sendChat(event) {
  event.preventDefault();
  const input = $("chat-input");
  const text = cleanText(input.value);
  if (!text || !roomCode) return;
  const now = Date.now();
  if (now - chatLastSent < 1500) return toast("조금 천천히 보내 주세요.");
  const mine = (state?.chat || []).filter((m) => m.id === myId);
  if (mine.length && mine[mine.length - 1].text === text && now - mine[mine.length - 1].t < 10000) {
    return toast("같은 말을 연속으로 보낼 수 없어요.");
  }
  chatLastSent = now;
  input.value = "";
  await act((s) => G.addChat(s, myId, text));
}

// ---------- 열려 있는 방 목록 ----------
// 방장만 목록에 자기 방을 올리고, 게임이 시작되거나 꽉 차면 내린다.
let lobbyKey = "";
let lobbyCode = null;
let openRooms = {};
let lobbyError = false;

function syncLobby() {
  if (!net?.setLobby || !roomCode || !state) return;
  const host = state.players.find((p) => p.id === state.hostId);
  const open = state.hostId === myId && state.phase === "lobby" && state.players.length < G.MAX_PLAYERS && host;
  if (!open) {
    if (lobbyCode === roomCode) unpublishLobby();
    return;
  }
  const key = `${roomCode}|${host.name}|${state.players.length}`;
  if (key === lobbyKey) return;
  lobbyKey = key;
  lobbyCode = roomCode;
  net.setLobby(roomCode, { host: host.name, count: state.players.length, max: G.MAX_PLAYERS, ts: state.createdAt || Date.now() }).catch(() => {});
}

function unpublishLobby() {
  if (!lobbyCode || !net?.setLobby) return;
  net.setLobby(lobbyCode, null).catch(() => {});
  lobbyCode = null;
  lobbyKey = "";
}

// 목록 항목을 통째로 다시 그리지 않고, 바뀐 글자만 고쳐요 (방이 깜빡이거나 순서가 바뀌지 않게)
const roomNodes = new Map();

function roomItem(code) {
  const li = el("li", "room-item");
  const info = el("div", "room-info");
  const title = el("b");
  const meta = el("span");
  info.append(title, meta);
  const join = el("button", "room-join", "들어가기");
  join.addEventListener("click", () => {
    if (!myName()) {
      $("name").focus();
      return toast("이름을 먼저 써 주세요.");
    }
    joinRoom(code);
  });
  li.append(info, join);
  return { li, title, meta };
}

function renderOpenRooms() {
  const list = $("room-list");
  if (!list) return;
  const now = Date.now();
  // 만든 순서대로 고정 (새 방은 아래에 붙어요)
  const rooms = Object.entries(openRooms)
    .filter(([, r]) => r && r.count < (r.max || G.MAX_PLAYERS) && now - (r.ts || 0) < 3 * 60 * 60 * 1000)
    .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0) || a[0].localeCompare(b[0]));

  const message = lobbyError
    ? "방 목록을 불러오지 못했어요. 아래 방 번호로 들어가 주세요."
    : rooms.length ? "" : "아직 열린 방이 없어요. 새 방을 만들어 보세요!";
  if (lobbyError) $("code-join").open = true;
  if (message) {
    roomNodes.clear();
    const empty = list.querySelector(".room-empty");
    if (empty && list.children.length === 1) empty.textContent = message;
    else list.replaceChildren(el("li", "room-empty", message));
    return;
  }
  list.querySelector(".room-empty")?.remove();

  const keep = new Set(rooms.map(([code]) => code));
  for (const [code, node] of roomNodes) {
    if (!keep.has(code)) {
      node.li.remove();
      roomNodes.delete(code);
    }
  }
  for (const [code, r] of rooms) {
    let node = roomNodes.get(code);
    if (!node) {
      node = roomItem(code);
      roomNodes.set(code, node);
      list.append(node.li);
    }
    const title = `${r.host}의 방`;
    const meta = `${r.count}/${r.max || G.MAX_PLAYERS}명 · 기다리는 중`;
    if (node.title.textContent !== title) node.title.textContent = title;
    if (node.meta.textContent !== meta) node.meta.textContent = meta;
  }
}

function renderLobby() {
  show("lobby");
  const codeBox = $("lobby-code");
  codeBox.replaceChildren(
    ...[...roomCode].map((d, i) => tileNode({ n: Number(d), c: i % 2 ? "dark" : "light" }, { showNumber: true })),
  );
  codeBox.setAttribute("aria-label", `방 번호 ${roomCode}`);
  const list = $("lobby-players");
  list.replaceChildren(
    ...state.players.map((p) => {
      const li = el("li");
      const crown = p.id === state.hostId ? " · 방장" : "";
      const you = p.id === myId ? " (나)" : "";
      li.append(avatarNode(p), el("span", "", p.name + you + crown));
      return li;
    }),
  );
  const isHost = state.hostId === myId;
  const enough = state.players.length >= G.MIN_PLAYERS;
  $("start").classList.toggle("hidden", !isHost);
  $("start").disabled = !enough;
  $("lobby-hint").textContent = isHost
    ? enough
      ? `${state.players.length}명 모였어요. 준비되면 시작하세요! (최대 ${G.MAX_PLAYERS}명)`
      : "친구가 들어오길 기다리는 중..."
    : "방장이 시작하길 기다리는 중...";
}

function tileNode(tile, { showNumber, asButton }) {
  const node = el(asButton ? "button" : "div", `tile ${tile.c}`);
  if (showNumber && G.isJoker(tile)) {
    node.classList.add("joker");
    node.append(el("span", "joker-star", "★"));
  } else if (showNumber) {
    // 6과 9는 뒤집어 봐도 헷갈리지 않게 밑줄
    node.append(el("span", tile.n === 6 || tile.n === 9 ? "u" : "", String(tile.n)));
  } else {
    node.classList.add("back");
  }
  const colorName = tile.c === "dark" ? "검은" : "흰";
  const label = G.isJoker(tile) ? `${colorName} 조커` : `${colorName} 타일 ${tile.n}`;
  node.setAttribute("aria-label", showNumber ? label : `${colorName} 숨은 타일`);
  return node;
}

// 자리마다 받침대 색깔: 파랑, 노랑, 빨강, 초록
const SEAT_COLORS = ["#587f91", "#a18446", "#ae6b54", "#728759"];

function seatColor(player) {
  const index = state.players.findIndex((p) => p.id === player.id);
  return SEAT_COLORS[index % SEAT_COLORS.length];
}

function avatarNode(player) {
  const node = el("span", "avatar", [...player.name][0] || "?");
  node.style.background = seatColor(player);
  return node;
}

function rackNode(hand) {
  const rack = el("div", "rack");
  rack.append(hand);
  return rack;
}

function renderGame(me) {
  show("game");
  const previousDrawRect = motion.rect($("drawn-box").lastElementChild);
  const playerTileNodes = new Map();
  const turnPlayer = G.currentPlayer(state);
  const myTurn = state.phase !== "over" && turnPlayer.id === myId;
  const canPick = myTurn && state.phase === "guess";

  // 차례가 바뀌면 고른 타일 초기화
  const turnKey = `${state.turn}-${state.log.length}`;
  if (turnKey !== selectedTurnKey) {
    selectedTurnKey = turnKey;
    selected = null;
  }

  const newEvent = state.log.length !== lastLogLength;
  lastLogLength = state.log.length;
  const flash = newEvent && state.lastGuess ? state.lastGuess : null;

  // 상단 안내
  const banner = $("banner");
  banner.className = "banner";
  if (state.phase === "over") {
    const winner = state.players.find((p) => p.id === state.winnerId);
    banner.textContent = winner ? (winner.id === myId ? "내가 이겼어요!" : `${winner.name} 승리!`) : "게임 끝";
    banner.classList.add("over");
  } else if (state.phase === "setup") {
    // 누가 조커를 받았는지 드러나지 않게 모두 같은 '타일 확인' 안내
    banner.textContent = "내 타일을 확인해요";
    if (!me.ready) banner.classList.add("my-turn");
  } else if (G.isOut(me)) {
    banner.textContent = `관전 중 · ${turnPlayer.name}의 차례`;
  } else if (myTurn) {
    banner.textContent = "내 차례예요";
    banner.classList.add("my-turn");
  } else {
    banner.textContent = `${turnPlayer.name}의 차례`;
  }

  // 다른 사람이 뽑아서 이미 받침대에 놓은 조커는, 그 차례가 끝날 때까지 내 화면에선
  // 평소처럼 '뽑은 타일' 자리에 둬요. (일찍 받침대로 옮겨지면 조커인 게 티 나니까)
  const inPlay = state.phase === "guess" || state.phase === "continue";
  const hideIndex = inPlay && state.drawnIndex != null && turnPlayer.id !== myId ? state.drawnIndex : -1;
  const shownDrawn = state.drawn || (hideIndex >= 0 ? turnPlayer.hand[hideIndex] : null);

  // 친구들 (내 다음 차례부터 순서대로)
  const myIndex = state.players.findIndex((p) => p.id === myId);
  const others = [];
  for (let i = 1; i < state.players.length; i++) others.push(state.players[(myIndex + i) % state.players.length]);

  $("opponents").replaceChildren(
    ...others.map((p) => {
      const box = el("div", "opponent");
      box.style.setProperty("--seat", seatColor(p));
      if (p.id === turnPlayer.id && state.phase !== "over") box.classList.add("active");
      const out = G.isOut(p);
      if (out) box.classList.add("out");
      const head = el("div", "seat-head");
      const skip = p.id === turnPlayer.id ? hideIndex : -1;
      const hiddenCount = p.hand.filter((t, i) => !t.open && i !== skip).length;
      const nameBox = el("div");
      const thinking = p.id === turnPlayer.id && state.phase !== "over" && state.phase !== "setup" ? " · 생각 중" : "";
      nameBox.append(
        el("div", "seat-name", p.name + thinking),
        el("div", "seat-info", state.phase === "setup" ? "타일 정리 중" : out ? "모두 공개 · 탈락" : `숨은 타일 ${hiddenCount}개`),
      );
      head.append(avatarNode(p), nameBox);
      box.append(head);
      if (state.phase === "setup") {
        // 시작 단계: 받침대를 천으로 덮어서 몇 장인지, 조커를 어디 놓는지 안 보이게
        const cover = el("div", "rack-cover");
        cover.append(el("span", "", "타일 정리 중…"));
        box.append(rackNode(cover));
        playerTileNodes.set(p.id, []);
        return box;
      }
      const hand = el("div", "hand");
      const byIndex = [];
      p.hand.forEach((tile, index) => {
        if (index === skip) return;
        const pickable = canPick && !tile.open && !out;
        const node = tileNode(tile, { showNumber: tile.open || state.phase === "over", asButton: pickable });
        node.dataset.index = index;
        if (tile.open) node.classList.add("revealed");
        if (pickable) {
          node.classList.add("pickable");
          node.addEventListener("click", () => {
            selected = { targetId: p.id, index };
            sound.play("tap");
            renderGame(me);
            motion.point(document.querySelector("#opponents .tile.selected"));
          });
        }
        if (selected && selected.targetId === p.id && selected.index === index) node.classList.add("selected");
        if (flash && flash.targetId === p.id && flash.tileIndex === index) {
          node.classList.add(flash.correct ? "flash-good" : "flash-bad");
        }
        hand.append(node);
      });
      box.append(rackNode(hand));
      [...hand.children].forEach((node) => { byIndex[Number(node.dataset.index)] = node; });
      playerTileNodes.set(p.id, byIndex);
      return box;
    }),
  );

  // 더미와 뽑은 타일
  $("pile-count").textContent = state.deck.length;
  // 가운데 판: 엎어 둔 타일들이 흩어져 있는 모습
  $("tray").replaceChildren(
    ...state.deck.map((t, i) => {
      const node = tileNode(t, { showNumber: false });
      node.style.setProperty("--tilt", `${((i * 37) % 23) - 11}deg`);
      return node;
    }),
  );
  const drawnBox = $("drawn-box");
  const setupJoker = state.phase === "setup" ? me.pending?.[0] : null;
  const drawnKey = shownDrawn ? `${state.turn}-${shownDrawn.n}-${shownDrawn.c}-${state.phase === "over"}`
    : setupJoker ? `setup-${setupJoker.c}-${me.pending.length}` : "";
  if (drawnBox.dataset.key !== drawnKey || !drawnKey) {
    drawnBox.dataset.key = drawnKey;
    drawnBox.replaceChildren();
    if (shownDrawn && state.phase !== "over") {
      const mine = turnPlayer.id === myId;
      drawnBox.append(el("span", "drawn-label", mine ? "이번에 뽑은 타일" : `${turnPlayer.name} · 뽑은 타일`));
      drawnBox.append(tileNode(shownDrawn, { showNumber: mine, asButton: false }));
    } else if (setupJoker) {
      drawnBox.append(el("span", "drawn-label", "놓을 조커"));
      drawnBox.append(tileNode(setupJoker, { showNumber: true, asButton: false }));
    } else if (state.phase !== "over" && state.deck.length === 0) {
      drawnBox.append(el("span", "drawn-label", "더미가 비었어요! 틀리면 내 타일 하나가 공개돼요."));
    }
  }

  renderPanel(me, myTurn);

  // 내 타일
  $("my-title").replaceChildren(avatarNode(me), el("span", "", `내 타일 (${me.name})`));
  document.querySelector("#game .me").style.setProperty("--seat", seatColor(me));
  const myHand = $("my-hand");
  const placing = (state.phase === "setup" && me.pending?.length) || (state.phase === "joker" && myTurn);
  const slot = (index) => {
    const b = el("button", "slot", "+");
    b.setAttribute("aria-label", `${index + 1}번째 자리에 조커 놓기`);
    b.addEventListener("click", () => {
      sound.play("tap");
      act((s) => G.placeJoker(s, myId, index));
    });
    return b;
  };
  const myTiles = me.hand.map((tile, index) => {
      const node = tileNode(tile, { showNumber: true, asButton: false });
      const mark = el("span", "mark", tile.open ? "공개" : "나만");
      mark.title = tile.open ? "친구들도 볼 수 있어요" : "나만 볼 수 있어요";
      node.append(mark);
      if (tile.open) node.classList.add("open-mine");
      if (flash && flash.targetId === myId && flash.tileIndex === index) {
        node.classList.add(flash.correct ? "flash-good" : "flash-bad");
      }
      return node;
    });
  myHand.classList.toggle("placing", Boolean(placing));
  myHand.replaceChildren(...(placing ? myTiles.flatMap((n, i) => [slot(i), n]).concat(slot(myTiles.length)) : myTiles));
  playerTileNodes.set(myId, myTiles);

  // 기록

  // 뽑은 패를 제자리에 내려놓은 다음, 다음 사람의 뽑기를 연출합니다.
  const drawKey = shownDrawn && state.phase !== "over"
    ? `${roomCode}-${turnPlayer.id}-${shownDrawn.n}-${shownDrawn.c}` : "";
  const old = motionSnapshot;
  const steps = [];
  if (old && old.room === roomCode && old.key !== drawKey && old.drawn) {
    const owner = state.players.find(p => p.id === old.playerId);
    const index = owner?.hand.findIndex(t => t.n === old.drawn.n && t.c === old.drawn.c) ?? -1;
    const destination = playerTileNodes.get(old.playerId)?.[index];
    if (destination && previousDrawRect) {
      steps.push({ kind: "carry", from: previousDrawRect, to: destination, mine: old.playerId === myId });
    }
  }
  if (drawKey && old?.key !== drawKey) {
    steps.push({ kind: "carry", from: $("tray"), to: $("drawn-box").lastElementChild, mine: myTurn });
  }
  motionSnapshot = { room: roomCode, key: drawKey, playerId: turnPlayer.id, drawn: shownDrawn ? { ...shownDrawn } : null };
  if (steps.length) motion.play(steps);
}

function renderPanel(me, myTurn) {
  const panel = $("panel");
  panel.replaceChildren();

  if (state.phase === "over") {
    const isHost = state.hostId === myId;
    panel.append(el("p", "", isHost ? "한 판 더 할까요?" : "방장이 다시 시작할 수 있어요."));
    const row = el("div", "row");
    if (isHost) {
      const again = el("button", "primary", "같은 친구들과 다시 하기");
      again.addEventListener("click", () => act((s) => G.backToLobby(s, myId)));
      row.append(again);
    }
    const leave = el("button", "", "나가기");
    leave.addEventListener("click", goHome);
    row.append(leave);
    panel.append(row);
    return;
  }

  if (state.phase === "setup" || state.phase === "joker") {
    const mustPlace = (state.phase === "setup" && me.pending?.length) || (state.phase === "joker" && myTurn);
    if (mustPlace) {
      panel.append(el("p", "", "★ 조커를 놓을 자리를 골라 주세요"));
      panel.append(el("span", "panel-hint", "내 받침대의 + 를 누르면 그 자리에 고정돼요. 조커는 어디에 놓아도 돼요."));
    } else if (state.phase === "setup" && !me.ready) {
      panel.append(el("p", "", "내 타일을 확인했으면 준비 완료를 눌러요"));
      const ready = el("button", "primary", "준비 완료");
      ready.addEventListener("click", () => act((s) => G.markReady(s, myId)));
      panel.append(ready);
    } else if (state.phase === "setup") {
      const live = state.players.filter((p) => !p.left);
      const done = live.filter((p) => p.ready && !p.pending?.length).length;
      panel.append(el("p", "", `친구들을 기다리는 중이에요… (${done}/${live.length} 준비)`));
    }
    // 다른 사람이 조커를 뽑은 경우(joker 단계)는 평소 차례와 똑같이 아무것도 안 보여 줘요
    return;
  }

  if (!myTurn) return;

  if (state.phase === "continue") {
    panel.append(el("p", "", "맞혔어요! 한 번 더 도전할까요?"));
    const row = el("div", "row");
    const more = el("button", "primary", "한 번 더 맞히기");
    more.addEventListener("click", () => act((s) => G.keepGoing(s, myId)));
    const stop = el("button", "", "여기서 멈추기");
    stop.addEventListener("click", () => act((s) => G.stop(s, myId)));
    row.append(more, stop);
    panel.append(row);
    return;
  }

  if (!selected) {
    panel.append(el("p", "", "친구의 숨은 타일을 하나 골라 주세요."));
    return;
  }

  const target = state.players.find((p) => p.id === selected.targetId);
  const color = target.hand[selected.index].c;
  panel.append(el("p", "", `${target.name}의 ${selected.index + 1}번째 타일은 몇일까요?`));
  const pad = el("div", "numpad");
  for (let n = 0; n <= G.MAX_NUMBER; n++) {
    const b = tileNode({ n, c: color }, { showNumber: true, asButton: true });
    b.addEventListener("click", () => {
      const pick = selected;
      selected = null;
      sound.play("tap");
      act((s) => G.guess(s, myId, pick.targetId, pick.index, n));
    });
    pad.append(b);
  }
  const jokerBtn = tileNode({ n: null, c: color, j: true }, { showNumber: true, asButton: true });
  jokerBtn.classList.add("numpad-joker");
  jokerBtn.setAttribute("aria-label", "조커");
  jokerBtn.addEventListener("click", () => {
    const pick = selected;
    selected = null;
    sound.play("tap");
    act((s) => G.guess(s, myId, pick.targetId, pick.index, G.JOKER));
  });
  pad.append(jokerBtn);
  panel.append(pad);
  const cancel = el("button", "", "다른 타일 고르기");
  cancel.style.marginTop = "10px";
  cancel.addEventListener("click", () => {
    selected = null;
    renderGame(me);
  });
  panel.append(cancel);
}

// ---------- 시작 ----------
async function main() {
  motion.bind($("motion-toggle"), $("demo-hand"));
  sound.bind($("sound-toggle"));
  $("home-btn").addEventListener("click", goHome);
  $("chat-toggle").addEventListener("click", () => setChatOpen($("chat-panel").classList.contains("hidden")));
  $("chat-close").addEventListener("click", () => setChatOpen(false));
  $("chat-form").addEventListener("submit", sendChat);
  $("demo-hand")?.addEventListener("click", () => motion.demo(document.querySelector(".hero-mystery")));
  $("name").value = storageGet("hn-name") || "";
  net = await connect();

  const badge = $("mode-badge");
  if (net.mode === "online") {
    badge.textContent = "온라인 · 다른 기기에서도 함께할 수 있어요.";
    badge.classList.add("online");
  } else {
    badge.textContent = location.protocol === "file:"
      ? "파일 미리보기 · 이 컴퓨터에서 연습할 수 있어요."
      : "연습 모드 · 이 컴퓨터에서 탭을 하나 더 열어 함께해요.";
    badge.classList.add("local");
  }

  $("create").addEventListener("click", createRoom);
  $("join").addEventListener("click", () => joinRoom($("code").value.trim()));
  $("code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom($("code").value.trim());
  });
  $("start").addEventListener("click", () => act((s) => G.startGame(s, myId)));
  $("leave").addEventListener("click", async () => {
    unpublishLobby();
    if (roomCode) await act((s) => G.leaveGame(s, myId));
    leaveRoom();
  });
  $("create").disabled = false;
  $("join").disabled = false;

  // 열려 있는 방 목록 받아 오기
  if (net.watchLobby) {
    net.watchLobby(
      (all) => { openRooms = all; lobbyError = false; renderOpenRooms(); },
      () => { lobbyError = true; renderOpenRooms(); },
    );
  }

  // 새로고침했을 때 하던 방으로 돌아가기
  const savedRoom = storageGet("hn-room");
  if (savedRoom) await joinRoom(savedRoom, { silent: true });
  else show("home");
}

main().catch((error) => {
  console.error("게임 시작 실패", error);
  const message = "게임을 시작하지 못했어요. 페이지를 새로고침하고, 모든 게임 파일이 같은 폴더에 있는지 확인해 주세요.";
  $("mode-badge").textContent = message;
  toast(message);
});

})();
