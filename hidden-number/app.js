// 숨은 숫자 — 화면과 버튼을 연결하는 코드
import * as G from "./game.js";
import { connect } from "./net.js";

const $ = (id) => document.getElementById(id);

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
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function show(screenId) {
  for (const id of ["home", "lobby", "game"]) $(id).classList.toggle("hidden", id !== screenId);
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
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  roomCode = null;
  state = null;
  storageSet("hn-room", null);
  show("home");
}

async function createRoom() {
  const name = myName();
  if (!name) return toast("이름을 먼저 써 주세요.");
  storageSet("hn-name", name);
  for (let tries = 0; tries < 8; tries++) {
    const code = String(1000 + Math.floor(Math.random() * 9000));
    let made = false;
    try {
      made = await net.update(code, (s) => (s ? undefined : G.createRoom(myId, name)));
    } catch (e) {
      return toast("방을 만들지 못했어요. 인터넷 연결을 확인해 주세요.");
    }
    if (made) {
      storageSet("hn-room", code);
      await watch(code);
      return;
    }
  }
  toast("방을 만들지 못했어요. 다시 눌러 주세요.");
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
function render() {
  if (!roomCode) return show("home");
  if (!state) {
    leaveRoom();
    return toast("방이 사라졌어요.");
  }
  const me = state.players.find((p) => p.id === myId);
  if (!me) {
    // 대기실에서 빠졌거나, 게임이 이미 시작된 방
    if (state.phase === "lobby") return;
    leaveRoom();
    return toast("이미 게임이 시작된 방이에요.");
  }
  if (state.phase === "lobby") renderLobby();
  else renderGame(me);
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
      const crown = p.id === state.hostId ? " 👑" : "";
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
  if (showNumber) {
    // 6과 9는 뒤집어 봐도 헷갈리지 않게 밑줄
    node.append(el("span", tile.n === 6 || tile.n === 9 ? "u" : "", String(tile.n)));
  } else {
    node.classList.add("back");
  }
  const colorName = tile.c === "dark" ? "검은" : "흰";
  node.setAttribute("aria-label", showNumber ? `${colorName} 타일 ${tile.n}` : `${colorName} 숨은 타일`);
  return node;
}

const AVATAR_COLORS = ["#e2574c", "#3e8ede", "#e0a93b", "#9b59b6"];

function avatarNode(player) {
  const index = state.players.findIndex((p) => p.id === player.id);
  const node = el("span", "avatar", [...player.name][0] || "?");
  node.style.background = AVATAR_COLORS[index % AVATAR_COLORS.length];
  return node;
}

function renderGame(me) {
  show("game");
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
    banner.textContent = winner ? (winner.id === myId ? "🏆 내가 이겼어요!" : `🏆 ${winner.name} 승리!`) : "게임 끝";
    banner.classList.add("over");
  } else if (G.isOut(me)) {
    banner.textContent = `탈락했어요. 구경 중 👀 (${turnPlayer.name}의 차례)`;
  } else if (myTurn) {
    banner.textContent = "🎯 내 차례!";
    banner.classList.add("my-turn");
  } else {
    banner.textContent = `${turnPlayer.name}의 차례`;
  }

  // 친구들 (내 다음 차례부터 순서대로)
  const myIndex = state.players.findIndex((p) => p.id === myId);
  const others = [];
  for (let i = 1; i < state.players.length; i++) others.push(state.players[(myIndex + i) % state.players.length]);

  $("opponents").replaceChildren(
    ...others.map((p) => {
      const box = el("div", "opponent");
      if (p.id === turnPlayer.id && state.phase !== "over") box.classList.add("active");
      const out = G.isOut(p);
      if (out) box.classList.add("out");
      const head = el("div", "seat-head");
      const hiddenCount = p.hand.filter((t) => !t.open).length;
      const nameBox = el("div");
      const thinking = p.id === turnPlayer.id && state.phase !== "over" ? " ⏳" : "";
      nameBox.append(
        el("div", "seat-name", p.name + thinking),
        el("div", "seat-info", out ? "💥 탈락" : `숨은 타일 ${hiddenCount}개`),
      );
      head.append(avatarNode(p), nameBox);
      box.append(head);
      const hand = el("div", "hand");
      p.hand.forEach((tile, index) => {
        const pickable = canPick && !tile.open && !out;
        const node = tileNode(tile, { showNumber: tile.open || state.phase === "over", asButton: pickable });
        if (tile.open) node.classList.add("revealed");
        if (pickable) {
          node.classList.add("pickable");
          node.addEventListener("click", () => {
            selected = { targetId: p.id, index };
            renderGame(me);
          });
        }
        if (selected && selected.targetId === p.id && selected.index === index) node.classList.add("selected");
        if (flash && flash.targetId === p.id && flash.tileIndex === index) {
          node.classList.add(flash.correct ? "flash-good" : "flash-bad");
        }
        hand.append(node);
      });
      box.append(hand);
      return box;
    }),
  );

  // 더미와 뽑은 타일
  $("pile-count").textContent = state.deck.length;
  const stack = $("stack");
  const stackSize = Math.min(3, state.deck.length);
  stack.replaceChildren(
    ...Array.from({ length: stackSize }, (_, i) => tileNode({ c: i % 2 ? "light" : "dark" }, { showNumber: false })),
  );
  const drawnBox = $("drawn-box");
  const drawnKey = state.drawn ? `${state.turn}-${state.drawn.n}-${state.drawn.c}-${state.phase === "over"}` : "";
  if (drawnBox.dataset.key !== drawnKey || !drawnKey) {
    drawnBox.dataset.key = drawnKey;
    drawnBox.replaceChildren();
    if (state.drawn && state.phase !== "over") {
      const mine = turnPlayer.id === myId;
      drawnBox.append(el("span", "drawn-label", mine ? "내가 뽑은 타일 →" : `${turnPlayer.name}가 뽑은 타일 →`));
      drawnBox.append(tileNode(state.drawn, { showNumber: mine, asButton: false }));
    } else if (state.phase !== "over" && state.deck.length === 0) {
      drawnBox.append(el("span", "drawn-label", "더미가 비었어요! 틀리면 내 타일 하나가 공개돼요."));
    }
  }

  renderPanel(me, myTurn);

  // 내 타일
  $("my-title").textContent = `내 타일 (${me.name})`;
  const myHand = $("my-hand");
  myHand.replaceChildren(
    ...me.hand.map((tile, index) => {
      const node = tileNode(tile, { showNumber: true, asButton: false });
      const mark = el("span", "mark", tile.open ? "👁" : "🔒");
      mark.title = tile.open ? "친구들도 볼 수 있어요" : "나만 볼 수 있어요";
      node.append(mark);
      if (tile.open) node.classList.add("open-mine");
      if (flash && flash.targetId === myId && flash.tileIndex === index) {
        node.classList.add(flash.correct ? "flash-good" : "flash-bad");
      }
      return node;
    }),
  );

  // 기록
  $("log").replaceChildren(...state.log.slice().reverse().map((line) => el("li", "", line)));
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
    leave.addEventListener("click", leaveRoom);
    row.append(leave);
    panel.append(row);
    return;
  }

  if (!myTurn) return;

  if (state.phase === "continue") {
    panel.append(el("p", "", "⭕ 정답! 한 번 더 맞혀 볼까요?"));
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
    panel.append(el("p", "", "👆 친구의 뒤집힌 타일을 하나 눌러 주세요"));
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
      act((s) => G.guess(s, myId, pick.targetId, pick.index, n));
    });
    pad.append(b);
  }
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
  $("name").value = storageGet("hn-name") || "";
  net = await connect();

  const badge = $("mode-badge");
  if (net.mode === "online") {
    badge.textContent = "🌐 온라인 모드: 다른 크롬북에서도 같이 할 수 있어요";
    badge.classList.add("online");
  } else {
    badge.textContent = "🧪 연습 모드: 이 컴퓨터의 다른 탭끼리만 같이 할 수 있어요";
    badge.classList.add("local");
  }

  $("create").addEventListener("click", createRoom);
  $("join").addEventListener("click", () => joinRoom($("code").value.trim()));
  $("code").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom($("code").value.trim());
  });
  $("start").addEventListener("click", () => act((s) => G.startGame(s, myId)));
  $("leave").addEventListener("click", async () => {
    if (roomCode) await act((s) => G.removePlayer(s, myId));
    leaveRoom();
  });

  // 새로고침했을 때 하던 방으로 돌아가기
  const savedRoom = storageGet("hn-room");
  if (savedRoom) await joinRoom(savedRoom, { silent: true });
  else show("home");
}

main();
