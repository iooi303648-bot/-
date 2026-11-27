// 연습 모드 로봇 — 간단한 방법으로 놓을 수 있는 줄을 찾아요.
// 1) 내 받침대에서 이어지는 줄/같은 숫자 줄을 찾아 놓기
// 2) (처음 등록을 마쳤으면) 판의 줄 끝에 한 장씩 붙이기
(function (root) {
  "use strict";
  const R = typeof module !== "undefined" && module.exports ? require("./rules.js") : root.Rules;

  // 받침대에서 만들 수 있는 줄 후보들
  function candidates(rack) {
    const jokers = rack.filter(R.isJoker);
    const real = rack.filter((t) => !R.isJoker(t));
    const out = [];
    // 이어지는 줄
    for (const c of R.COLORS) {
      const byNum = new Map();
      for (const t of real) if (R.tileColor(t) === c && !byNum.has(R.tileNum(t))) byNum.set(R.tileNum(t), t);
      for (let s = 1; s <= 11; s++) {
        for (let len = 3; s + len - 1 <= 13; len++) {
          const set = [];
          let need = 0;
          for (let v = s; v < s + len; v++) {
            if (byNum.has(v)) set.push(byNum.get(v));
            else need++;
          }
          if (need > jokers.length) break;
          if (set.length === 0 || need > 1) continue; // 별은 한 줄에 한 장까지만 써요
          out.push(set.concat(jokers.slice(0, need)));
        }
      }
    }
    // 같은 숫자 줄
    for (let n = 1; n <= 13; n++) {
      const byColor = new Map();
      for (const t of real) if (R.tileNum(t) === n && !byColor.has(R.tileColor(t))) byColor.set(R.tileColor(t), t);
      const tiles = [...byColor.values()];
      if (tiles.length >= 3) {
        out.push(tiles.slice());
        if (tiles.length === 4) for (let i = 0; i < 4; i++) out.push(tiles.filter((_, j) => j !== i));
      }
      if (tiles.length === 2 && jokers.length) out.push(tiles.concat(jokers[0]));
    }
    return out.filter(R.isValidSet);
  }

  // 겹치지 않게 욕심껏 고르기 (별을 덜 쓰고, 많이·크게)
  function pickSets(rack) {
    const score = (set) => set.filter((t) => !R.isJoker(t)).length * 100 - set.filter(R.isJoker).length * 150 + R.setPoints(set);
    const list = candidates(rack).sort((a, b) => score(b) - score(a));
    const used = new Set();
    const chosen = [];
    for (const set of list) {
      if (set.some((t) => used.has(t))) continue;
      chosen.push(set);
      set.forEach((t) => used.add(t));
    }
    return chosen;
  }

  // 로봇의 다음 행동: { kind: "play", board } 또는 { kind: "draw" }
  function decide(state, id) {
    const me = R.findPlayer(state, id);
    const firstMeld = state.settings.firstMeld;
    let board = state.board.map((s) => s.slice());
    let rack = me.rack.slice();
    const sets = pickSets(rack);

    if (!me.opened && firstMeld > 0) {
      const pts = sets.reduce((sum, s) => sum + R.setPoints(s), 0);
      if (pts < firstMeld) return { kind: "draw" };
      board = board.concat(sets);
    } else {
      board = board.concat(sets);
      const used = new Set(sets.flat());
      rack = rack.filter((t) => !used.has(t));
      // 판의 줄에 한 장씩 붙여 보기
      let changed = true;
      while (changed && rack.length) {
        changed = false;
        for (const t of rack.slice()) {
          for (let i = 0; i < board.length; i++) {
            const trial = board[i].concat(t);
            if (R.isValidSet(trial)) {
              board[i] = R.arrangeSet(trial);
              rack = rack.filter((x) => x !== t);
              changed = true;
              break;
            }
          }
        }
      }
    }
    const check = R.checkTurn(state.board, me.rack, me.opened, firstMeld, board);
    if (check.ok) return { kind: "play", board };
    return { kind: "draw" };
  }

  const api = { candidates, pickSets, decide };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Bot = api;
})(typeof self !== "undefined" ? self : this);
