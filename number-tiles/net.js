// 여러 기기를 연결하는 부분
// - firebase-config.js 가 채워져 있으면: Firebase 실시간 데이터베이스 (여러 크롬북용)
// - 연습 모드: 이 기기 안에서만 (로봇과 함께)
// 저장 위치: rooms/nt-방번호 (방), rooms/nt-lobby/방번호 (열린 방 목록)
//  → 숨은 숫자 게임과 같은 Firebase 규칙을 그대로 써요.
(function (root) {
  "use strict";
  const FIREBASE_VERSION = "10.12.2";
  const ROOM_PREFIX = "nt-";
  const LOBBY_PATH = "rooms/nt-lobby";

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

  async function firebaseBackend(config) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const { initializeApp } = await import(`${base}/firebase-app.js`);
    const db_ = await import(`${base}/firebase-database.js`);
    const { getDatabase, ref, onValue, runTransaction, set, remove, onDisconnect } = db_;
    const db = getDatabase(initializeApp(config, "number-tiles"));
    const roomRef = (code) => ref(db, `rooms/${ROOM_PREFIX}${code}`);
    const decode = (raw) => (raw && raw.s ? JSON.parse(raw.s) : null);
    let offset = 0;
    onValue(ref(db, ".info/serverTimeOffset"), (snap) => { offset = Number(snap.val()) || 0; });
    let connected = true;
    const connListeners = [];
    onValue(ref(db, ".info/connected"), (snap) => {
      connected = Boolean(snap.val());
      connListeners.forEach((cb) => cb(connected));
    });

    // 상태 확인용: 첫 연결이 되는지 몇 초 기다려 봐요
    return {
      mode: "online",
      now: () => Date.now() + offset,
      onConnection(cb) { connListeners.push(cb); },
      subscribe(code, cb) {
        return onValue(roomRef(code), (snap) => cb(decode(snap.val())));
      },
      async update(code, fn) {
        const { box, run } = guarded(fn);
        const result = await runTransaction(roomRef(code), (raw) => {
          const next = run(decode(raw));
          if (next === undefined) return undefined;
          if (next === null) return null;
          return { s: JSON.stringify(next), t: Date.now() };
        }, { applyLocally: false });
        if (box.error) throw box.error;
        return result.committed;
      },
      watchLobby(cb, onError) {
        return onValue(ref(db, LOBBY_PATH), (snap) => cb(snap.val() || {}), (err) => onError && onError(err));
      },
      async setLobby(code, info) {
        const r = ref(db, `${LOBBY_PATH}/${code}`);
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

  // 이 기기 안에서만 도는 방 (연습 모드). 화면을 새로고침하면 사라져요.
  function memoryBackend() {
    const rooms = new Map();
    const listeners = new Map();
    const notify = (code) => {
      const raw = rooms.get(code);
      (listeners.get(code) || []).forEach((cb) => cb(raw ? JSON.parse(raw) : null));
    };
    return {
      mode: "practice",
      now: () => Date.now(),
      onConnection() {},
      subscribe(code, cb) {
        const list = listeners.get(code) || [];
        list.push(cb);
        listeners.set(code, list);
        setTimeout(() => cb(rooms.has(code) ? JSON.parse(rooms.get(code)) : null), 0);
        return () => listeners.set(code, (listeners.get(code) || []).filter((x) => x !== cb));
      },
      async update(code, fn) {
        const { box, run } = guarded(fn);
        const next = run(rooms.has(code) ? JSON.parse(rooms.get(code)) : null);
        if (box.error) throw box.error;
        if (next === undefined) return false;
        if (next === null) rooms.delete(code);
        else rooms.set(code, JSON.stringify(next));
        setTimeout(() => notify(code), 0);
        return true;
      },
      watchLobby(cb) { cb({}); return () => {}; },
      async setLobby() {},
    };
  }

  async function connect(config) {
    if (config && config.databaseURL && config.apiKey && location.protocol !== "file:") {
      try {
        return await firebaseBackend(config);
      } catch (e) {
        console.error("Firebase 연결 실패", e);
      }
    }
    return null;
  }

  root.Net = { connect, memoryBackend };
})(self);
