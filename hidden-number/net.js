// 게임 방 상태를 여러 기기가 함께 보도록 연결하는 부분.
// - firebase-config.js 가 채워져 있으면: Firebase 실시간 데이터베이스 (여러 크롬북용)
// - 비어 있으면: 연습 모드 (한 컴퓨터의 여러 탭끼리만 연결)

import { firebaseConfig } from "./firebase-config.js";

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
  const { getDatabase, ref, onValue, runTransaction } = await import(`${base}/firebase-database.js`);
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

  window.addEventListener("storage", (e) => {
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
  };
}

export async function connect() {
  if (hasFirebaseConfig()) {
    try {
      return await firebaseBackend();
    } catch (e) {
      console.error("Firebase 연결 실패, 연습 모드로 전환", e);
    }
  }
  return localBackend();
}
