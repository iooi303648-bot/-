// 숨은 숫자 — 화면과 버튼을 연결하는 코드
import * as G from "./game.js?v=20261127-0317";
import { connect } from "./net.js?v=20261127-0317";
import { createMotionController } from "./motion.js?v=20261127-0317";
import { cleanText } from "./chat-filter.js?v=20261127-0317";
import { createSound } from "./sound.js?v=20261127-0317";

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
  } else if (G.isOut(me)) {
    banner.textContent = `관전 중 · ${turnPlayer.name}의 차례`;
  } else if (myTurn) {
    banner.textContent = "내 차례예요";
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
      box.style.setProperty("--seat", seatColor(p));
      if (p.id === turnPlayer.id && state.phase !== "over") box.classList.add("active");
      const out = G.isOut(p);
      if (out) box.classList.add("out");
      const head = el("div", "seat-head");
      const hiddenCount = p.hand.filter((t) => !t.open).length;
      const nameBox = el("div");
      const thinking = p.id === turnPlayer.id && state.phase !== "over" ? " · 생각 중" : "";
      nameBox.append(
        el("div", "seat-name", p.name + thinking),
        el("div", "seat-info", out ? "모두 공개 · 탈락" : `숨은 타일 ${hiddenCount}개`),
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
      playerTileNodes.set(p.id, [...hand.children]);
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
  const drawnKey = state.drawn ? `${state.turn}-${state.drawn.n}-${state.drawn.c}-${state.phase === "over"}` : "";
  if (drawnBox.dataset.key !== drawnKey || !drawnKey) {
    drawnBox.dataset.key = drawnKey;
    drawnBox.replaceChildren();
    if (state.drawn && state.phase !== "over") {
      const mine = turnPlayer.id === myId;
      drawnBox.append(el("span", "drawn-label", mine ? "이번에 뽑은 타일" : `${turnPlayer.name} · 뽑은 타일`));
      drawnBox.append(tileNode(state.drawn, { showNumber: mine, asButton: false }));
    } else if (state.phase !== "over" && state.deck.length === 0) {
      drawnBox.append(el("span", "drawn-label", "더미가 비었어요! 틀리면 내 타일 하나가 공개돼요."));
    }
  }

  renderPanel(me, myTurn);

  // 내 타일
  $("my-title").replaceChildren(avatarNode(me), el("span", "", `내 타일 (${me.name})`));
  document.querySelector("#game .me").style.setProperty("--seat", seatColor(me));
  const myHand = $("my-hand");
  myHand.replaceChildren(
    ...me.hand.map((tile, index) => {
      const node = tileNode(tile, { showNumber: true, asButton: false });
      const mark = el("span", "mark", tile.open ? "공개" : "나만");
      mark.title = tile.open ? "친구들도 볼 수 있어요" : "나만 볼 수 있어요";
      node.append(mark);
      if (tile.open) node.classList.add("open-mine");
      if (flash && flash.targetId === myId && flash.tileIndex === index) {
        node.classList.add(flash.correct ? "flash-good" : "flash-bad");
      }
      return node;
    }),
  );
  playerTileNodes.set(myId, [...myHand.children]);

  // 기록

  // 뽑은 패를 제자리에 내려놓은 다음, 다음 사람의 뽑기를 연출합니다.
  const drawKey = state.drawn && state.phase !== "over"
    ? `${roomCode}-${turnPlayer.id}-${state.drawn.n}-${state.drawn.c}` : "";
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
  motionSnapshot = { room: roomCode, key: drawKey, playerId: turnPlayer.id, drawn: state.drawn ? { ...state.drawn } : null };
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
