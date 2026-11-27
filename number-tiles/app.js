// 줄줄이 숫자 — 화면과 버튼을 연결하는 코드
(function () {
  "use strict";
  const VERSION = "20261127-0440";
  const R = self.Rules;
  const Bot = self.Bot;
  const { cleanText } = self.ChatFilter;
  const $ = (id) => document.getElementById(id);
  const sound = self.createSound();

  // ---------- 저장소 (탭을 닫았다 열어도 같은 자리로) ----------
  function load(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function save(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch { /* 저장 못 해도 게임은 진행 */ }
  }
  let myId = load("nt-id");
  if (!myId) {
    myId = "u" + Math.random().toString(36).slice(2, 10);
    save("nt-id", myId);
  }

  let online = null;   // Firebase 연결 (없으면 null)
  let net = null;      // 지금 쓰는 연결 (online 또는 연습)
  let roomCode = null;
  let unsubscribe = null;
  let state = null;
  let practice = false;

  // 내 차례에만 쓰는 '그리는 중인 판' (다른 사람에게는 '다 놓았어요'를 누를 때까지 안 보여요)
  let draft = null;          // { turnNo, board: [[id]] }
  let rackOrder = [];        // 내 받침대 순서 (나만 아는 정보, 이 기기에만 저장)
  const selected = new Set();
  let highlight = { ids: new Set(), until: 0 };
  let newTiles = { ids: new Set(), until: 0 }; // 방금 뽑은 내 타일 (내 화면에만)
  let prevSummary = null;

  // ---------- 작은 도우미 ----------
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  let toastTimer = null;
  function toast(message, ms = 2800) {
    const t = $("toast");
    t.textContent = message;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }
  function myName() { return $("name").value.trim(); }
  const now = () => (net ? net.now() : Date.now());

  let activeScreen = "home";
  function show(id) {
    for (const s of ["home", "lobby", "game"]) $(s).classList.toggle("hidden", s !== id);
    $("home-btn").classList.toggle("hidden", id === "home");
    $("chat-toggle").classList.toggle("hidden", id === "home" || practice);
    if (id !== "game") $("opponents").replaceChildren();
    if (id === "home") { setChatOpen(false); $("order").classList.add("hidden"); }
    document.body.dataset.screen = id;
    activeScreen = id;
  }

  async function act(change) {
    try {
      await net.update(roomCode, (s) => {
        if (!s) throw new Error("방이 사라졌어요.");
        return change(s);
      });
      return true;
    } catch (e) {
      toast(e.message || "문제가 생겼어요. 다시 해 주세요.");
      sound.play("bad");
      return false;
    }
  }

  // ---------- 타일 그리기 ----------
  const SHAPES = { r: "●", b: "▲", y: "■", k: "◆" };
  const STAR_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3.5l4.9 10.6 11.6 1.3-8.6 7.9 2.4 11.4L20 28.9l-10.3 5.8 2.4-11.4-8.6-7.9 11.6-1.3z" fill="#f2bb3d" stroke="#9a6400" stroke-width="2.2" stroke-linejoin="round"/><circle cx="16" cy="19.5" r="1.9" fill="#3a2600"/><circle cx="24" cy="19.5" r="1.9" fill="#3a2600"/><path d="M15.5 24q4.5 3.6 9 0" stroke="#3a2600" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12.6" cy="23" r="1.6" fill="#e7836d" opacity=".7"/><circle cx="27.4" cy="23" r="1.6" fill="#e7836d" opacity=".7"/></svg>';

  function tileNode(id, extra = "") {
    const c = R.tileColor(id);
    const node = el("div", `tile ${c} ${extra}`.trim());
    node.dataset.id = id;
    if (R.isJoker(id)) {
      node.innerHTML = STAR_SVG;
    } else {
      node.append(el("b", "", String(R.tileNum(id))), el("i", "", SHAPES[c]));
    }
    node.setAttribute("aria-label", R.tileLabel(id));
    return node;
  }

  const SEAT_COLORS = ["#4d7fb8", "#b9604f", "#5f8d57", "#8a6aa8"];
  function seatColor(id) {
    const i = state ? state.players.findIndex((p) => p.id === id) : 0;
    return SEAT_COLORS[(i < 0 ? 0 : i) % SEAT_COLORS.length];
  }
  function avatar(p) {
    const a = el("span", "avatar", p.bot ? "🤖" : [...p.name][0] || "?");
    a.style.background = seatColor(p.id);
    return a;
  }

  // ---------- 방 들어가기 / 나가기 ----------
  function watch(code) {
    if (unsubscribe) unsubscribe();
    roomCode = code;
    prevSummary = null;
    draft = null;
    selected.clear();
    resetChat();
    return new Promise((resolve) => {
      let first = true;
      unsubscribe = net.subscribe(code, (s) => {
        state = s;
        if (first) { first = false; resolve(s); }
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
    draft = null;
    if (!practice) save("nt-room", null);
    practice = false;
    net = online;
    show("home");
    renderOpenRooms();
  }

  function leaveChange(s) {
    R.leaveGame(s, myId, now());
    const humans = s.players.filter((p) => !p.left && !p.bot);
    return humans.length ? s : null; // 아무도 없으면 방을 지워요
  }

  async function goHome() {
    if (!roomCode) return show("home");
    const me = state && R.findPlayer(state, myId);
    if (state && state.phase === "play" && me && !me.left && !practice) {
      if (!window.confirm("게임을 그만두고 처음 화면으로 갈까요?\n남은 친구들은 계속 게임을 해요.")) return;
    }
    unpublishLobby();
    if (state && me) await act(leaveChange);
    leaveRoom();
  }

  function needName() {
    const name = myName();
    if (!name) {
      $("name").focus();
      toast("이름을 먼저 써 주세요.");
      return null;
    }
    save("nt-name", name);
    return name;
  }

  async function createRoom() {
    const name = needName();
    if (!name || !online) return;
    const button = $("create");
    button.disabled = true;
    button.textContent = "방 만드는 중…";
    try {
      net = online;
      practice = false;
      for (let tries = 0; tries < 8; tries++) {
        const code = String(1000 + Math.floor(Math.random() * 9000));
        const made = await net.update(code, (s) => (s ? undefined : R.createRoom(myId, name, now())));
        if (made) {
          save("nt-room", code);
          await watch(code);
          return;
        }
      }
      toast("방을 만들지 못했어요. 다시 눌러 주세요.");
    } catch (e) {
      console.error(e);
      toast("방을 만들지 못했어요. 인터넷 연결을 확인해 주세요.");
    } finally {
      button.disabled = !online;
      button.textContent = "새 방 만들기";
    }
  }

  async function joinRoom(code, { silent = false } = {}) {
    const name = myName() || load("nt-name");
    if (!name) { $("name").focus(); return toast("이름을 먼저 써 주세요."); }
    if (!/^\d{4}$/.test(code)) return toast("방 번호 4자리를 써 주세요.");
    if (!online) return toast("지금은 온라인에 연결되지 않았어요.");
    save("nt-name", name);
    net = online;
    practice = false;
    const current = await watch(code);
    const fail = (msg) => { leaveRoom(); if (!silent) toast(msg); };
    if (!current) return fail("그런 방이 없어요. 번호를 다시 확인해 주세요.");
    const meNow = R.findPlayer(current, myId);
    if (meNow && meNow.left) return fail("이미 나온 방이에요.");
    if (!meNow) {
      if ((current.kicked || []).includes(myId)) return fail("이 방에는 다시 들어갈 수 없어요.");
      try {
        await net.update(code, (s) => {
          if (!s) throw new Error("그런 방이 없어요.");
          return R.addPlayer(s, myId, name);
        });
      } catch (e) {
        return fail(e.message);
      }
    }
    save("nt-room", code);
  }

  async function startPractice() {
    const name = myName() || "나";
    save("nt-name", myName() || load("nt-name") || "");
    unpublishLobby();
    if (unsubscribe) unsubscribe();
    practice = true;
    net = self.Net.memoryBackend();
    await net.update("연습", () => {
      const s = R.createRoom(myId, name, now());
      R.addBot(s, myId, "bot1", "로봇 하나");
      R.addBot(s, myId, "bot2", "로봇 둘");
      return s;
    });
    await watch("연습");
  }

  // ---------- 효과음과 알림: 바뀐 점 찾기 ----------
  function summary(s) {
    return {
      phase: s.phase,
      count: s.players.length,
      round: s.round || 0,
      turnNo: s.turnNo,
      turnId: s.phase === "play" ? R.currentPlayer(s).id : null,
      left: s.players.filter((p) => p.left).map((p) => p.id).join(","),
    };
  }

  function react(s) {
    const prev = prevSummary;
    const cur = summary(s);
    prevSummary = cur;
    if (!prev) return;
    if (cur.phase === "lobby") {
      if (prev.phase === "lobby" && cur.count > prev.count) sound.play("join");
      return;
    }
    if (cur.phase === "play" && (prev.phase !== "play" || cur.round !== prev.round)) {
      showOrder(s);
      sound.play("start");
      return;
    }
    if (cur.left !== prev.left) {
      const gone = s.players.filter((p) => p.left && !prev.left.split(",").includes(p.id));
      gone.forEach((p) => p.id !== myId && toast(`${p.name}이(가) 나갔어요. 남은 친구들끼리 계속해요.`));
    }
    if (cur.turnNo !== prev.turnNo && s.lastMove && s.lastMove.by !== myId) {
      const who = R.findPlayer(s, s.lastMove.by);
      const name = who ? who.name : "친구";
      if (s.lastMove.kind === "play") {
        sound.play("played");
        highlight = { ids: new Set(s.lastMove.tiles || []), until: Date.now() + 3500 };
        setTimeout(() => render(), 3600);
      } else if (s.lastMove.kind === "draw") {
        sound.play("draw");
        noteOnBoard(`${name}이(가) 한 장 뽑았어요`);
      } else if (s.lastMove.kind === "timeout") {
        noteOnBoard(`${name}의 시간이 다 됐어요`);
      } else {
        noteOnBoard(`${name}이(가) 넘겼어요`);
      }
    }
    if (cur.phase === "over" && prev.phase !== "over") {
      sound.play(s.winnerId === myId ? "win" : "lose");
      return;
    }
    if (cur.turnId === myId && prev.turnId !== myId) setTimeout(() => sound.play("myturn"), 350);
  }

  let noteTimer = null;
  let noteText = "";
  function noteOnBoard(text) {
    noteText = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { noteText = ""; render(); }, 2600);
  }

  function showOrder(s) {
    const box = $("order");
    const card = el("div", "order-card");
    card.append(el("h2", "", "순서를 무작위로 정했어요"));
    const list = el("ol", "order-list");
    s.players.forEach((p, i) => {
      const li = el("li");
      li.append(el("span", "order-no", String(i + 1)), avatar(p), el("span", "", p.name + (p.id === myId ? " (나)" : "")));
      list.append(li);
    });
    card.append(list);
    const first = s.players[0];
    card.append(el("p", "", first.id === myId ? "내가 먼저 해요!" : `${first.name}이(가) 먼저 해요`));
    box.replaceChildren(card);
    box.classList.remove("hidden");
    clearTimeout(showOrder.t);
    showOrder.t = setTimeout(() => box.classList.add("hidden"), 3800);
    box.onclick = () => box.classList.add("hidden");
  }

  // ---------- 화면 그리기 ----------
  function render() {
    if (!roomCode) return show("home");
    if (!state) {
      leaveRoom();
      return toast("방이 사라졌어요.");
    }
    const me = R.findPlayer(state, myId);
    if (!me || me.left) {
      if (!me && state.phase === "lobby" && !(state.kicked || []).includes(myId)) return; // 들어가는 중
      const kicked = (state.kicked || []).includes(myId);
      leaveRoom();
      return toast(kicked ? "방장이 나를 방에서 내보냈어요." : "이미 게임이 시작된 방이에요.");
    }
    react(state);
    syncLobby();
    if (state.phase === "lobby") renderLobby(me);
    else renderGame(me);
    renderChat();
    driveBots();
  }

  // ---------- 대기실 ----------
  function renderLobby(me) {
    show("lobby");
    const isHost = state.hostId === myId;
    $("lobby-title").textContent = practice ? "혼자 연습하기" : "친구를 기다리는 중";
    $("lobby-sub").textContent = practice ? "로봇과 함께 연습해요. 로봇 수를 정하고 시작하세요." : "친구들은 첫 화면의 방 목록에서 이 방을 눌러요";
    const codeBox = $("lobby-code");
    codeBox.classList.toggle("hidden", practice);
    if (!practice) {
      codeBox.replaceChildren(el("span", "code-label", "방 번호"), ...[...roomCode].map((d, i) => {
        const t = el("div", `tile ${R.COLORS[i]}`);
        t.append(el("b", "", d));
        return t;
      }));
      codeBox.setAttribute("aria-label", `방 번호 ${roomCode}`);
    }
    $("lobby-players").replaceChildren(...state.players.map((p) => {
      const li = el("li");
      li.append(avatar(p), el("span", "pname", p.name + (p.id === myId ? " (나)" : "")));
      if (p.id === state.hostId) li.append(el("span", "tag", "방장"));
      if (isHost && p.id !== myId && !p.bot) {
        const kick = el("button", "btn tiny", "내보내기");
        kick.addEventListener("click", () => {
          if (window.confirm(`${p.name}을(를) 방에서 내보낼까요?`)) act((s) => R.kick(s, myId, p.id, now()));
        });
        li.append(kick);
      }
      return li;
    }));
    $("bot-row").classList.toggle("hidden", !practice);
    $("bot-add").disabled = state.players.length >= R.MAX_PLAYERS;
    $("bot-remove").disabled = !state.players.some((p) => p.bot) || state.players.length <= 2;

    renderSeg($("set-meld"), [[30, "30점 이상"], [0, "제한 없음"]], state.settings.firstMeld, isHost, (v) => ({ firstMeld: v }));
    renderSeg($("set-time"), [[60, "1분"], [120, "2분"], [180, "3분"], [0, "없음"]], state.settings.turnSec, isHost, (v) => ({ turnSec: v }));
    $("settings-note").textContent = state.settings.firstMeld
      ? "처음엔 내 타일로만 숫자 합 30 이상을 내야 해요."
      : "처음부터 아무 줄이나 낼 수 있어요.";
    if (!isHost) $("settings-note").textContent += " (방장이 정해요)";

    const enough = state.players.length >= R.MIN_PLAYERS;
    $("start").classList.toggle("hidden", !isHost);
    $("start").disabled = !enough;
    $("lobby-hint").textContent = isHost
      ? enough ? `${state.players.length}명 모였어요. 준비되면 시작하세요!` : "친구가 들어오길 기다리는 중…"
      : "방장이 시작하길 기다리는 중…";
  }

  function renderSeg(box, options, value, enabled, toSettings) {
    box.replaceChildren(...options.map(([v, label]) => {
      const b = el("button", "seg-btn", label);
      b.setAttribute("aria-pressed", String(v === value));
      b.disabled = !enabled;
      b.addEventListener("click", () => {
        if (v === value) return;
        sound.play("tap");
        act((s) => R.setSettings(s, myId, toSettings(v)));
      });
      return b;
    }));
  }

  // ---------- 게임 ----------
  function myTurn() {
    return state && state.phase === "play" && R.currentPlayer(state).id === myId;
  }

  function ensureDraft(me) {
    if (myTurn()) {
      if (!draft || draft.turnNo !== state.turnNo || draft.round !== state.round) {
        draft = { turnNo: state.turnNo, round: state.round, board: state.board.map((s) => s.slice()) };
        selected.clear();
      }
    } else if (draft) {
      draft = null;
      selected.clear();
    }
    // 받침대 순서: 새로 받은 타일은 뒤에 붙이고, 없어진 타일은 빼요
    const key = `nt-rack-${roomCode}-${state.round}-${myId}`;
    if (!rackOrder.length || rackOrder.key !== key) {
      let saved = [];
      try { saved = JSON.parse(load(key) || "[]"); } catch { saved = []; }
      rackOrder = saved;
      rackOrder.key = key;
    }
    const mine = new Set(me.rack);
    const next = rackOrder.filter((t) => mine.has(t));
    const added = me.rack.filter((t) => !next.includes(t));
    if (added.length && next.length) newTiles = { ids: new Set(added), until: Date.now() + 4000 };
    for (const t of added) next.push(t);
    next.key = key;
    rackOrder = next;
    save(key, JSON.stringify(rackOrder));
  }

  function currentBoard() { return draft ? draft.board : state.board; }

  function rackTilesShown(me) {
    const onBoard = new Set(draft ? draft.board.flat() : []);
    return rackOrder.filter((t) => !onBoard.has(t));
  }

  function lockedTiles(me) {
    // 처음 등록 전에는 판에 원래 있던 타일을 못 움직여요
    if (!draft) return new Set(state.board.flat());
    if (me.opened || state.settings.firstMeld === 0) return new Set();
    return new Set(state.board.flat());
  }

  function renderGame(me) {
    show("game");
    ensureDraft(me);
    renderOpponents(me);
    renderBoard(me);
    renderRack(me);
    renderActions(me);
    renderResult(me);
    tickTimer();
  }

  function renderOpponents(me) {
    const box = $("opponents");
    const idx = state.players.findIndex((p) => p.id === myId);
    const list = [];
    for (let i = 0; i < state.players.length; i++) list.push(state.players[(idx + i) % state.players.length]);
    const turnId = state.phase === "play" ? R.currentPlayer(state).id : null;
    box.replaceChildren(...list.map((p) => {
      const chip = el("div", "opp");
      if (p.id === turnId) chip.classList.add("on");
      if (p.left) chip.classList.add("gone");
      if (p.id === myId) chip.classList.add("me");
      chip.append(avatar(p));
      const text = el("span", "opp-text");
      text.append(el("b", "", p.id === myId ? "나" : p.name));
      text.append(el("small", "", p.left ? "나감" : `${p.rack.length}장`));
      chip.append(text);
      if (p.id === turnId) chip.append(el("span", "opp-timer", ""));
      if (state.hostId === myId && p.id !== myId && !p.left && !p.bot && state.phase === "play") {
        const kick = el("button", "kick", "×");
        kick.title = "내보내기";
        kick.setAttribute("aria-label", `${p.name} 내보내기`);
        kick.addEventListener("click", () => {
          if (window.confirm(`${p.name}을(를) 게임에서 내보낼까요?\n(화면이 꺼져서 게임이 멈출 때 써요)`)) act((s) => R.kick(s, myId, p.id, now()));
        });
        chip.append(kick);
      }
      return chip;
    }));
  }

  function renderBoard(me) {
    const board = $("board");
    const sets = currentBoard();
    const editing = Boolean(draft);
    const locked = lockedTiles(me);
    const fromRack = new Set(me.rack);
    const hl = Date.now() < highlight.until ? highlight.ids : new Set();
    board.classList.toggle("editing", editing);
    board.classList.toggle("has-selection", editing && selected.size > 0);
    const nodes = sets.map((set, i) => {
      const box = el("div", "set");
      box.dataset.set = i;
      if (!R.isValidSet(set)) box.classList.add("bad");
      for (const t of set) {
        const n = tileNode(t);
        if (editing && fromRack.has(t)) n.classList.add("placed");
        if (editing && !locked.has(t)) n.classList.add("movable");
        if (selected.has(t)) n.classList.add("sel");
        if (hl.has(t)) n.classList.add("fresh");
        box.append(n);
      }
      if (editing && selected.size) {
        const plus = el("button", "set-plus", "+");
        plus.setAttribute("aria-label", "고른 타일을 이 줄에 놓기");
        plus.addEventListener("click", (e) => { e.stopPropagation(); moveSelected({ type: "set", index: i, pos: set.length }); });
        box.append(plus);
      }
      return box;
    });
    if (editing) {
      const zone = el("button", "newzone", selected.size ? "여기에 새 줄" : "새 줄은 여기로");
      zone.addEventListener("click", () => { if (selected.size) moveSelected({ type: "new" }); });
      nodes.push(zone);
    }
    if (!sets.length && !editing) nodes.push(el("p", "board-empty", "아직 판이 비어 있어요"));
    board.replaceChildren(...nodes);
    fitTiles(board, "--bt", 46, 24);

    const note = $("board-note");
    let text = noteText;
    if (!text && state.phase === "play" && !draft) {
      const cur = R.currentPlayer(state);
      text = `${cur.name}의 차례예요`;
    }
    note.textContent = text;
    note.classList.toggle("hidden", !text);
  }

  // 타일 크기를 줄여 가며 판/받침대 안에 다 들어가게
  function fitTiles(box, varName, max, min) {
    let size = max;
    box.style.setProperty(varName, size + "px");
    while (size > min && box.scrollHeight > box.clientHeight + 1) {
      size -= 2;
      box.style.setProperty(varName, size + "px");
    }
  }

  function renderRack(me) {
    const rack = $("rack");
    const tiles = rackTilesShown(me);
    rack.replaceChildren(...tiles.map((t) => {
      const n = tileNode(t, "movable");
      if (selected.has(t)) n.classList.add("sel");
      if (Date.now() < newTiles.until && newTiles.ids.has(t)) n.classList.add("fresh");
      return n;
    }));
    if (!tiles.length) rack.append(el("p", "rack-empty", draft ? "받침대를 다 비웠어요! 다 놓았어요를 누르세요" : ""));
    fitTiles(rack, "--rt", 54, 26);
  }

  function renderActions(me) {
    const commit = $("commit"), undo = $("undo"), draw = $("draw");
    const hint = $("board-note");
    const over = state.phase !== "play";
    const mine = myTurn();
    for (const b of [commit, undo, draw]) b.disabled = !mine;
    $("sort-num").disabled = over;
    $("sort-color").disabled = over;
    draw.textContent = state.pool.length ? "한 장 뽑기" : "넘기기";
    if (over) { commit.disabled = true; return; }
    if (!mine) return;
    hint.className = "board-note";
    hint.classList.remove("hidden");
    const changed = JSON.stringify(draft.board) !== JSON.stringify(state.board);
    undo.disabled = !changed;
    const check = R.checkTurn(state.board, me.rack, me.opened, state.settings.firstMeld, draft.board);
    commit.disabled = !check.ok;
    if (noteText) {
      hint.textContent = noteText;
    } else if (!changed) {
      hint.textContent = me.opened || !state.settings.firstMeld
        ? "내 차례예요! 타일을 판으로 옮기거나, 한 장 뽑아요."
        : `내 차례예요! 처음엔 내 타일로만 합 ${state.settings.firstMeld} 이상을 내요.`;
      hint.classList.add("go");
    } else if (check.ok) {
      hint.textContent = "좋아요! '다 놓았어요'를 누르세요.";
      hint.classList.add("good");
    } else {
      hint.textContent = check.reason;
      hint.classList.add("warn");
    }
  }

  function renderResult(me) {
    const box = $("result");
    if (state.phase !== "over") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const winner = R.findPlayer(state, state.winnerId);
    const card = el("div", "result-card");
    card.append(el("h2", "", !winner ? "게임 끝" : winner.id === myId ? "내가 이겼어요!" : `${winner.name} 승리!`));
    const emptied = winner && winner.rack.length === 0;
    card.append(el("p", "muted", emptied ? "받침대를 다 비웠어요." : "더미가 다 떨어져서, 남은 숫자 합이 가장 적은 사람이 이겼어요."));
    const list = el("ol", "result-list");
    for (const r of state.results || []) {
      const li = el("li");
      const p = R.findPlayer(state, r.id);
      li.append(avatar(p || r), el("span", "pname", r.name + (r.id === myId ? " (나)" : "")));
      li.append(el("span", "muted", r.left ? "나감" : `남은 타일 ${r.count}장 · 합 ${r.points}`));
      list.append(li);
    }
    card.append(list);
    const row = el("div", "row");
    if (state.hostId === myId) {
      const again = el("button", "btn primary", "같은 친구들과 다시 하기");
      again.addEventListener("click", () => act((s) => R.backToLobby(s, myId)));
      row.append(again);
    } else {
      card.append(el("p", "muted", "방장이 다시 시작할 수 있어요."));
    }
    const leave = el("button", "btn", "처음으로");
    leave.addEventListener("click", goHome);
    row.append(leave);
    card.append(row);
    box.replaceChildren(card);
  }

  // ---------- 타일 옮기기 ----------
  function cleanBoard(board) {
    return board.filter((s) => s.length).map((s) => (R.isValidSet(s) ? R.arrangeSet(s) : s));
  }

  // ids 를 dest 로 옮겨요. dest: {type:"set", index, pos} | {type:"new"} | {type:"rack", pos}
  function moveTiles(ids, dest) {
    const me = R.findPlayer(state, myId);
    const mineSet = new Set(me.rack);
    if (dest.type === "rack") {
      ids = ids.filter((t) => mineSet.has(t)); // 판에 원래 있던 타일은 받침대로 못 와요
      if (!ids.length) { toast("판에 있던 타일은 받침대로 가져올 수 없어요."); sound.play("bad"); return; }
    } else if (!draft) {
      return;
    }
    const locked = lockedTiles(me);
    if (ids.some((t) => locked.has(t) && !(dest.type === "rack" && mineSet.has(t)))) {
      toast("처음 낼 때는 판에 있던 줄을 건드릴 수 없어요.");
      sound.play("bad");
      return;
    }
    // 빼기
    let targetSet = dest.type === "set" ? draft.board[dest.index] : null;
    if (draft) {
      draft.board = draft.board.map((set) => {
        if (set === targetSet) {
          // 같은 줄 안에서 옮길 때 위치 보정
          const before = set.slice(0, dest.pos).filter((t) => ids.includes(t)).length;
          dest = { ...dest, pos: dest.pos - before };
        }
        const out = set.filter((t) => !ids.includes(t));
        if (set === targetSet) targetSet = out;
        return out;
      });
    }
    let rackPos = dest.type === "rack" ? dest.pos : -1;
    if (rackPos >= 0) {
      const shown = rackTilesShown(me);
      const anchor = shown.filter((t) => !ids.includes(t))[rackPos - shown.slice(0, rackPos).filter((t) => ids.includes(t)).length];
      rackOrder = rackOrder.filter((t) => !ids.includes(t));
      const at = anchor === undefined ? rackOrder.length : rackOrder.indexOf(anchor);
      rackOrder.splice(at, 0, ...ids);
      rackOrder.key = `nt-rack-${roomCode}-${state.round}-${myId}`;
      save(rackOrder.key, JSON.stringify(rackOrder));
    }
    // 넣기
    if (draft) {
      if (dest.type === "set" && targetSet) {
        const i = draft.board.indexOf(targetSet);
        targetSet.splice(Math.max(0, Math.min(dest.pos, targetSet.length)), 0, ...ids);
        draft.board[i] = targetSet;
      } else if (dest.type === "new") {
        draft.board.push(ids.slice());
      }
      draft.board = cleanBoard(draft.board);
    }
    selected.clear();
    sound.play("place");
    renderGame(me);
  }

  function moveSelected(dest) {
    moveTiles([...selected], dest);
  }

  function sortRack(byColor) {
    const me = R.findPlayer(state, myId);
    const key = (t) => (R.isJoker(t) ? 999 : byColor ? R.COLORS.indexOf(R.tileColor(t)) * 20 + R.tileNum(t) : R.tileNum(t) * 10 + R.COLORS.indexOf(R.tileColor(t)));
    const k = rackOrder.key;
    rackOrder = rackOrder.slice().sort((a, b) => key(a) - key(b));
    rackOrder.key = k;
    save(k, JSON.stringify(rackOrder));
    sound.play("tap");
    renderGame(me);
  }

  // 끌어서 놓기 (마우스, 터치 모두)
  let drag = null;
  function canGrab(id) {
    if (!state || state.phase !== "play") return false;
    const me = R.findPlayer(state, myId);
    const inRack = rackTilesShown(me).includes(id);
    if (inRack) return true;
    if (!draft) return false;
    return !lockedTiles(me).has(id);
  }

  function onPointerDown(e) {
    const tile = e.target.closest(".tile[data-id]");
    if (!tile || !tile.closest("#board, #rack")) return;
    const id = Number(tile.dataset.id);
    if (!canGrab(id)) {
      if (draft && tile.closest("#board")) { toast("처음 낼 때는 판에 있던 줄을 건드릴 수 없어요."); }
      return;
    }
    e.preventDefault();
    drag = { id, x: e.clientX, y: e.clientY, started: false, pointerId: e.pointerId, ghost: null, ids: null };
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
      drag.started = true;
      drag.ids = selected.has(drag.id) ? [...selected] : [drag.id];
      const ghost = el("div", "ghost");
      drag.ids.forEach((t) => ghost.append(tileNode(t)));
      document.body.append(ghost);
      drag.ghost = ghost;
      document.body.classList.add("dragging");
      document.querySelectorAll(".tile[data-id]").forEach((n) => { if (drag.ids.includes(Number(n.dataset.id))) n.classList.add("lifted"); });
      sound.play("pick");
    }
    drag.ghost.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 30}px)`;
    const target = dropTarget(e.clientX, e.clientY);
    document.querySelectorAll(".drop-on").forEach((n) => n.classList.remove("drop-on"));
    if (target && target.node) target.node.classList.add("drop-on");
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    document.body.classList.remove("dragging");
    document.querySelectorAll(".drop-on").forEach((n) => n.classList.remove("drop-on"));
    if (!d.started) {
      // 눌러서 고르기
      if (selected.has(d.id)) selected.delete(d.id);
      else selected.add(d.id);
      sound.play("tap");
      return renderGame(R.findPlayer(state, myId));
    }
    d.ghost.remove();
    document.querySelectorAll(".lifted").forEach((n) => n.classList.remove("lifted"));
    const target = dropTarget(e.clientX, e.clientY);
    if (!target) return renderGame(R.findPlayer(state, myId));
    moveTiles(d.ids, target.dest);
  }

  function indexByPosition(container, x, y) {
    const tiles = [...container.querySelectorAll(".tile[data-id]:not(.lifted)")];
    for (let i = 0; i < tiles.length; i++) {
      const r = tiles[i].getBoundingClientRect();
      if (y < r.top) return i;
      if (y <= r.bottom && x < r.left + r.width / 2) return i;
    }
    return tiles.length;
  }

  function dropTarget(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    const rackArea = hit.closest("#rack-wrap");
    if (rackArea) return { node: rackArea, dest: { type: "rack", pos: indexByPosition($("rack"), x, y) } };
    if (!draft) return null;
    const set = hit.closest(".set");
    if (set) {
      const tiles = [...set.querySelectorAll(".tile[data-id]")];
      let pos = tiles.length;
      for (let i = 0; i < tiles.length; i++) {
        const r = tiles[i].getBoundingClientRect();
        if (x < r.left + r.width / 2) { pos = i; break; }
      }
      return { node: set, dest: { type: "set", index: Number(set.dataset.set), pos } };
    }
    if (hit.closest("#board-wrap")) return { node: document.querySelector(".newzone") || $("board"), dest: { type: "new" } };
    return null;
  }

  // ---------- 차례 끝내기 ----------
  async function commit() {
    if (!draft) return;
    const board = draft.board.map((s) => s.slice());
    const ok = await act((s) => R.commitTurn(s, myId, board, now()));
    if (ok) sound.play("played");
  }

  async function drawOne() {
    if (!myTurn()) return;
    draft = null;
    const ok = await act((s) => R.drawTile(s, myId, now()));
    if (ok) sound.play("draw");
  }

  // ---------- 시간 ----------
  let lastTickSecond = -1;
  let timeoutAsked = "";
  function tickTimer() {
    if (!state || state.phase !== "play" || !state.settings.turnSec) {
      document.querySelectorAll(".opp-timer").forEach((n) => (n.textContent = ""));
      return;
    }
    const left = Math.max(0, state.turnStart + state.settings.turnSec * 1000 - now());
    const sec = Math.ceil(left / 1000);
    const text = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    document.querySelectorAll(".opp-timer").forEach((n) => {
      n.textContent = text;
      n.classList.toggle("hurry", sec <= 10);
    });
    if (myTurn() && sec <= 10 && sec > 0 && sec !== lastTickSecond) { lastTickSecond = sec; sound.play("tick"); }
    const turnKey = `${roomCode}-${state.round}-${state.turnNo}`;
    if (left <= 0 && timeoutAsked !== turnKey) {
      // 내 차례면 바로, 친구 차례면 조금 더 기다렸다가 (그 친구 화면이 꺼졌을 때를 위해)
      const grace = myTurn() ? 0 : 8000;
      if (now() >= state.turnStart + state.settings.turnSec * 1000 + grace) {
        timeoutAsked = turnKey;
        const turnNo = state.turnNo;
        if (myTurn()) { draft = null; toast("시간이 다 됐어요. 놓던 타일은 되돌리고 한 장 뽑았어요."); }
        net.update(roomCode, (s) => (s ? R.timeOut(s, turnNo, now(), grace) : undefined)).catch(() => {});
      }
    }
  }

  // ---------- 연습 모드 로봇 ----------
  let botTurnKey = "";
  function driveBots() {
    if (!practice || !state || state.phase !== "play") return;
    const cur = R.currentPlayer(state);
    if (!cur.bot) return;
    const key = `${state.round}-${state.turnNo}`;
    if (botTurnKey === key) return;
    botTurnKey = key;
    setTimeout(() => {
      net.update(roomCode, (s) => {
        if (!s || s.phase !== "play" || `${s.round}-${s.turnNo}` !== key) return undefined;
        const move = Bot.decide(s, cur.id);
        if (move.kind === "play") return R.commitTurn(s, cur.id, move.board, now());
        return R.drawTile(s, cur.id, now());
      }).catch((e) => console.error(e));
    }, 1100 + Math.random() * 900);
  }

  // ---------- 채팅 ----------
  let chatSeen = -1;
  let chatUnread = 0;
  let chatLastSent = 0;
  let peekTimer = null;
  function resetChat() {
    chatSeen = -1;
    chatUnread = 0;
    $("chat-list").replaceChildren();
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
    const b = $("chat-unread");
    b.textContent = chatUnread > 9 ? "9+" : String(chatUnread);
    b.classList.toggle("hidden", chatUnread === 0);
  }
  function renderChat() {
    const chat = Array.isArray(state && state.chat) ? state.chat : [];
    const list = $("chat-list");
    const open = !$("chat-panel").classList.contains("hidden");
    const fresh = chatSeen < 0 ? [] : chat.filter((m) => m.t > chatSeen && m.id !== myId);
    list.replaceChildren(...(chat.length ? chat.map((m) => {
      const li = el("li", m.id === myId ? "chat-msg mine" : "chat-msg");
      if (m.id !== myId) li.append(el("span", "chat-name", m.name));
      li.append(el("span", "chat-text", cleanText(m.text)));
      return li;
    }) : [el("li", "chat-empty", "아직 메시지가 없어요. 인사해 볼까요?")]));
    list.scrollTop = list.scrollHeight;
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
  async function sendChat(e) {
    e.preventDefault();
    const input = $("chat-input");
    const text = cleanText(input.value);
    if (!text || !roomCode) return;
    const t = Date.now();
    if (t - chatLastSent < 1500) return toast("조금 천천히 보내 주세요.");
    const mine = ((state && state.chat) || []).filter((m) => m.id === myId);
    const last = mine[mine.length - 1];
    if (last && last.text === text && t - last.t < 10000) return toast("같은 말을 연속으로 보낼 수 없어요.");
    const recent = mine.filter((m) => t - m.t < 20000).length;
    if (recent >= 5) return toast("잠깐 쉬었다가 보내 주세요.");
    chatLastSent = t;
    input.value = "";
    await act((s) => R.addChat(s, myId, text, now()));
  }

  // ---------- 열려 있는 방 목록 ----------
  let lobbyKey = "";
  let lobbyCode = null;
  let openRooms = {};
  let lobbyError = false;
  function syncLobby() {
    if (practice || !online || !roomCode || !state) return;
    const host = R.findPlayer(state, state.hostId);
    const open = state.hostId === myId && state.phase === "lobby" && state.players.length < R.MAX_PLAYERS && host;
    if (!open) {
      if (lobbyCode === roomCode) unpublishLobby();
      return;
    }
    const key = `${roomCode}|${host.name}|${state.players.length}`;
    if (key === lobbyKey) return;
    lobbyKey = key;
    lobbyCode = roomCode;
    online.setLobby(roomCode, { host: host.name, count: state.players.length, max: R.MAX_PLAYERS, ts: state.createdAt || Date.now() }).catch(() => {});
  }
  function unpublishLobby() {
    if (!lobbyCode || !online) return;
    online.setLobby(lobbyCode, null).catch(() => {});
    lobbyCode = null;
    lobbyKey = "";
  }
  const roomNodes = new Map();
  function roomItem(code) {
    const li = el("li", "room-item");
    const info = el("div", "room-info");
    const title = el("b");
    const meta = el("span");
    info.append(title, meta);
    const join = el("button", "btn small", "들어가기");
    join.addEventListener("click", () => { if (needName()) joinRoom(code); });
    li.append(info, join);
    return { li, title, meta };
  }
  function renderOpenRooms() {
    const list = $("room-list");
    const t = Date.now();
    const rooms = Object.entries(openRooms)
      .filter(([code, r]) => /^\d{4}$/.test(code) && r && r.count < (r.max || R.MAX_PLAYERS) && t - (r.ts || 0) < 3 * 60 * 60 * 1000)
      .sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0) || a[0].localeCompare(b[0]));
    const message = !online ? "온라인에 연결되지 않았어요. '혼자 연습하기'는 할 수 있어요."
      : lobbyError ? "방 목록을 불러오지 못했어요. 방 번호로 들어가 주세요."
      : rooms.length ? "" : "아직 열린 방이 없어요. 새 방을 만들어 보세요!";
    if (message) {
      roomNodes.clear();
      const empty = list.querySelector(".room-empty");
      if (empty && list.children.length === 1) empty.textContent = message;
      else list.replaceChildren(el("li", "room-empty", message));
      return;
    }
    list.querySelector(".room-empty")?.remove();
    const keep = new Set(rooms.map(([c]) => c));
    for (const [c, node] of roomNodes) if (!keep.has(c)) { node.li.remove(); roomNodes.delete(c); }
    for (const [c, r] of rooms) {
      let node = roomNodes.get(c);
      if (!node) { node = roomItem(c); roomNodes.set(c, node); list.append(node.li); }
      const title = `${r.host}의 방`;
      const meta = `${r.count}/${r.max || R.MAX_PLAYERS}명 · 기다리는 중`;
      if (node.title.textContent !== title) node.title.textContent = title;
      if (node.meta.textContent !== meta) node.meta.textContent = meta;
    }
  }

  // ---------- 옛 버전 막기 ----------
  async function checkVersion() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch(`version.txt?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const latest = (await res.text()).trim();
      if (latest && latest !== VERSION) {
        const tried = sessionStorage.getItem("nt-reloaded");
        if (tried !== latest) {
          sessionStorage.setItem("nt-reloaded", latest);
          location.reload();
        } else {
          toast("새 버전이 있어요. 키보드에서 Ctrl+Shift+R (맥은 Cmd+Shift+R)을 눌러 주세요.", 8000);
        }
      }
    } catch { /* 확인 못 해도 게임은 진행 */ }
  }

  // ---------- 시작 ----------
  async function main() {
    sound.bind($("sound-toggle"));
    checkVersion();
    $("home-btn").addEventListener("click", goHome);
    $("chat-toggle").addEventListener("click", () => setChatOpen($("chat-panel").classList.contains("hidden")));
    $("chat-close").addEventListener("click", () => setChatOpen(false));
    $("chat-form").addEventListener("submit", sendChat);
    $("name").value = load("nt-name") || "";
    $("create").addEventListener("click", createRoom);
    $("join").addEventListener("click", () => { if (needName()) joinRoom($("code").value.trim()); });
    $("code").addEventListener("keydown", (e) => { if (e.key === "Enter" && needName()) joinRoom($("code").value.trim()); });
    $("practice").addEventListener("click", startPractice);
    $("start").addEventListener("click", () => act((s) => R.startGame(s, myId, Math.random, now())));
    $("leave").addEventListener("click", goHome);
    $("bot-add").addEventListener("click", () => act((s) => {
      const n = s.players.filter((p) => p.bot).length;
      const names = ["로봇 하나", "로봇 둘", "로봇 셋"];
      const id = ["bot1", "bot2", "bot3"].find((b) => !R.findPlayer(s, b));
      return R.addBot(s, myId, id, names[["bot1", "bot2", "bot3"].indexOf(id)] || `로봇 ${n + 1}`);
    }));
    $("bot-remove").addEventListener("click", () => act((s) => {
      const bots = s.players.filter((p) => p.bot);
      if (bots.length && s.players.length > 2) s.players = s.players.filter((p) => p !== bots[bots.length - 1]);
      return s;
    }));
    $("commit").addEventListener("click", commit);
    $("undo").addEventListener("click", () => {
      if (!draft) return;
      draft.board = state.board.map((s) => s.slice());
      selected.clear();
      sound.play("tap");
      renderGame(R.findPlayer(state, myId));
    });
    $("draw").addEventListener("click", drawOne);
    $("sort-num").addEventListener("click", () => sortRack(false));
    $("sort-color").addEventListener("click", () => sortRack(true));
    $("rack-wrap").addEventListener("click", (e) => {
      if (selected.size && !e.target.closest(".tile")) moveSelected({ type: "rack", pos: rackTilesShown(R.findPlayer(state, myId)).length });
    });
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", (e) => { if (drag) { drag.started && drag.ghost && drag.ghost.remove(); drag = null; document.body.classList.remove("dragging"); document.querySelectorAll(".lifted").forEach((n) => n.classList.remove("lifted")); } });
    window.addEventListener("resize", () => { if (state && activeScreen === "game") renderGame(R.findPlayer(state, myId)); });
    setInterval(() => { if (activeScreen === "game") tickTimer(); }, 250);
    show("home");

    online = await self.Net.connect(self.FIREBASE_CONFIG);
    net = online;
    const badge = $("mode-badge");
    if (online) {
      badge.textContent = "온라인 · 다른 기기와 함께할 수 있어요";
      badge.classList.add("online");
      $("create").disabled = false;
      online.watchLobby(
        (all) => { openRooms = all; lobbyError = false; renderOpenRooms(); },
        () => { lobbyError = true; renderOpenRooms(); },
      );
      const savedRoom = load("nt-room");
      if (savedRoom) await joinRoom(savedRoom, { silent: true });
    } else {
      badge.textContent = location.protocol === "file:"
        ? "파일로 열었어요 · 혼자 연습하기만 할 수 있어요"
        : "온라인에 연결하지 못했어요 · 혼자 연습하기는 할 수 있어요";
      badge.classList.add("offline");
      renderOpenRooms();
    }
  }

  main().catch((e) => {
    console.error("게임 시작 실패", e);
    $("mode-badge").textContent = "게임을 시작하지 못했어요. 새로고침해 주세요.";
  });

  // 테스트용 (화면 검사 스크립트가 읽어요)
  self.__nt = { get state() { return state; }, get draft() { return draft; }, myId };
})();
