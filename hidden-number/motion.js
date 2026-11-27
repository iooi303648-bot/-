// 손과 타일은 화면 위에서만 움직입니다. 게임 상태나 버튼 입력은 기다리지 않습니다.
export function createMotionController() {
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
