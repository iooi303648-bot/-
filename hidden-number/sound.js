// 효과음 — 소리 파일 없이 브라우저(Web Audio)가 직접 만들어요.
// 브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 막기 때문에, 첫 클릭 때 소리 장치를 켭니다.
export function createSound() {
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
