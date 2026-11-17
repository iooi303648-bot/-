const MODES = [
  { id: "title", icon: "🖼️", name: "작품명 맞히기", desc: "그림을 보고 제목 고르기" },
  { id: "artist", icon: "👩‍🎨", name: "화가 맞히기", desc: "누가 그렸을까?" },
  { id: "concept", icon: "💡", name: "미술 개념", desc: "그림에 담긴 미술 개념 찾기" },
  { id: "zoom", icon: "🔍", name: "확대 그림 퀴즈", desc: "그림 일부만 보고 맞히기" },
  { id: "story", icon: "📖", name: "이야기로 찾기", desc: "작품 이야기 읽고 그림 고르기" },
];

const TYPE_LABEL = {
  title: "작품명 맞히기",
  artist: "화가 맞히기",
  concept: "미술 개념",
  zoom: "확대 그림 퀴즈",
  story: "이야기로 찾기",
  oldest: "시대 퀴즈",
};

const $ = (id) => document.getElementById(id);

const state = {
  mode: "mix",
  questions: [],
  index: 0,
  score: 0,
  streak: 0,
  wrong: [],
  answered: false,
};

/* ---------- 유틸 ---------- */
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickOthers(answer, count) {
  return shuffle(ARTWORKS.filter((a) => a.id !== answer.id)).slice(0, count);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function show(screenId) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $(screenId).classList.remove("hidden");
  window.scrollTo({ top: 0 });
}

/* ---------- 문제 만들기 ---------- */
function makeQuestion(type, art) {
  if (type === "title" || type === "artist" || type === "concept") {
    const key = type;
    const prompt = {
      title: "이 그림의 제목은 무엇일까요?",
      artist: "이 그림을 그린 화가는 누구일까요?",
      concept: "이 그림과 가장 관련 있는 미술 개념은?",
    }[type];
    const options = shuffle([art, ...pickOthers(art, 3)]).map((a) => ({
      text: a[key],
      correct: a.id === art.id,
    }));
    return { type, art, prompt, visual: { kind: "image", art }, options };
  }

  if (type === "zoom") {
    const options = shuffle([art, ...pickOthers(art, 3)]).map((a) => ({
      text: a.title,
      correct: a.id === art.id,
    }));
    return {
      type,
      art,
      prompt: "그림의 한 부분을 크게 확대했어요. 어떤 작품일까요?",
      visual: { kind: "zoom", art },
      options,
    };
  }

  if (type === "story") {
    const options = shuffle([art, ...pickOthers(art, 3)]).map((a) => ({
      art: a,
      correct: a.id === art.id,
    }));
    return {
      type,
      art,
      prompt: "이 이야기에 어울리는 그림을 골라 보세요.",
      visual: { kind: "story", text: art.story },
      options,
    };
  }

  if (type === "oldest") {
    const four = shuffle(ARTWORKS).slice(0, 4);
    const oldest = four.reduce((m, a) => (a.yearNum < m.yearNum ? a : m));
    return {
      type,
      art: oldest,
      prompt: "이 중에서 가장 오래전에 그려진 그림은?",
      visual: { kind: "none" },
      options: four.map((a) => ({ art: a, correct: a.id === oldest.id })),
      showYears: true,
    };
  }
}

function buildQuestions(mode) {
  if (mode === "mix") {
    const types = ["title", "artist", "concept", "zoom", "story"];
    const arts = shuffle(ARTWORKS);
    const list = arts.map((art, i) => makeQuestion(types[i % types.length], art));
    list.push(makeQuestion("oldest"));
    return shuffle(list);
  }
  return shuffle(ARTWORKS).map((art) => makeQuestion(mode, art));
}

/* ---------- 화면 그리기 ---------- */
function renderHome() {
  $("mode-grid").innerHTML = MODES.map(
    (m) => `
      <button class="mode-card" data-mode="${m.id}">
        <span class="mode-icon">${m.icon}</span>
        <span class="mode-name">${m.name}</span>
        <span class="mode-desc">${m.desc}</span>
      </button>`
  ).join("");
  $("cta-thumbs").innerHTML = ARTWORKS.map((a) => `<img src="${a.image}" alt="" />`).join("");
}

function startQuiz(mode) {
  state.mode = mode;
  state.questions = buildQuestions(mode);
  state.index = 0;
  state.score = 0;
  state.streak = 0;
  state.wrong = [];
  const bar = $("progress-bar");
  bar.style.transition = "none";
  bar.style.width = "0";
  bar.offsetWidth;
  bar.style.transition = "";
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = state.questions[state.index];
  const total = state.questions.length;
  state.answered = false;

  $("counter").textContent = `${state.index + 1} / ${total}`;
  $("score-pill").textContent = `⭐ ${state.score}`;
  $("progress-bar").style.width = `${(state.index / total) * 100}%`;
  $("q-type").textContent = TYPE_LABEL[q.type];
  $("q-text").textContent = q.prompt;
  $("feedback").classList.add("hidden");

  const v = q.visual;
  const visual = $("q-visual");
  visual.className = "q-visual";
  if (v.kind === "image") {
    visual.innerHTML = `<img class="q-image" src="${v.art.image}" alt="문제 그림" />`;
  } else if (v.kind === "zoom") {
    visual.classList.add("zoom-wrap");
    visual.innerHTML = `
      <div class="zoom-box" style="background-image:url('${v.art.image}');background-position:${v.art.focus[0]}% ${v.art.focus[1]}%"></div>
      <img class="zoom-full" src="${v.art.image}" alt="" />`;
  } else if (v.kind === "story") {
    visual.innerHTML = `<blockquote class="story-box">“${escapeHtml(v.text)}”</blockquote>`;
  } else {
    visual.innerHTML = "";
  }

  const choices = $("choices");
  const isImage = q.options[0].art !== undefined;
  choices.className = `choices ${isImage ? "image-choices" : ""}`;
  choices.innerHTML = q.options
    .map((o, i) =>
      isImage
        ? `<button class="choice img-choice" data-i="${i}">
             <img src="${o.art.image}" alt="보기 ${i + 1}" />
             <span class="choice-num">${i + 1}</span>
           </button>`
        : `<button class="choice" data-i="${i}"><span class="choice-num">${i + 1}</span>${escapeHtml(o.text)}</button>`
    )
    .join("");
}

function answer(i) {
  if (state.answered) return;
  state.answered = true;
  const q = state.questions[state.index];
  const picked = q.options[i];
  const buttons = [...$("choices").children];

  buttons.forEach((b, idx) => {
    b.disabled = true;
    if (q.options[idx].correct) b.classList.add("correct");
    else if (idx === i) b.classList.add("wrong");
    if (q.showYears) {
      const a = q.options[idx].art;
      b.insertAdjacentHTML("beforeend", `<span class="year-tag">${a.year}</span>`);
    }
  });

  if (picked.correct) {
    state.score++;
    state.streak++;
  } else {
    state.streak = 0;
    state.wrong.push(q);
  }

  if (q.visual.kind === "zoom") $("q-visual").classList.add("revealed");
  $("score-pill").textContent = `⭐ ${state.score}`;

  const cheers = ["정답이에요! 🎉", "딩동댕! 👏", "훌륭해요! ✨", "맞았어요! 🌟"];
  let title = picked.correct ? cheers[Math.floor(Math.random() * cheers.length)] : "아쉬워요! 정답을 확인해 봐요 🙂";
  if (picked.correct && state.streak >= 3) title += ` ${state.streak}연속 정답!`;
  $("fb-title").textContent = title;
  $("fb-title").className = `fb-title ${picked.correct ? "ok" : "no"}`;
  $("fb-card").innerHTML = artCardHtml(q.art, q.type === "concept" ? "concept" : "story");
  $("next").textContent = state.index + 1 < state.questions.length ? "다음 문제 →" : "결과 보기 →";
  $("feedback").classList.remove("hidden");
  $("feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function artCardHtml(art, emphasis, big = false) {
  return `
    <div class="art-card ${big ? "big" : ""}">
      <img src="${art.image}" alt="${escapeHtml(art.title)}" />
      <div class="art-info">
        <h3>${escapeHtml(art.title)}</h3>
        <p class="meta">${escapeHtml(art.artist)} · ${escapeHtml(art.year)} · 소장: ${escapeHtml(art.museum)}</p>
        <p class="label">작품 이야기</p>
        <p>${escapeHtml(art.story)}</p>
        <div class="concept-box ${emphasis === "concept" ? "emph" : ""}">
          <span class="concept-tag">미술 개념</span> <strong>${escapeHtml(art.concept)}</strong>
          <p>${escapeHtml(art.conceptText)}</p>
        </div>
      </div>
    </div>`;
}

function next() {
  state.index++;
  if (state.index < state.questions.length) renderQuestion();
  else renderResult();
}

function renderResult() {
  const total = state.questions.length;
  const ratio = state.score / total;
  const stars = ratio === 1 ? 3 : ratio >= 0.7 ? 2 : ratio >= 0.4 ? 1 : 0;
  $("stars").innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? "on" : ""}">★</span>`).join("");
  $("result-score").textContent = `${total}문제 중 ${state.score}개 정답`;
  $("result-msg").textContent =
    ratio === 1 ? "완벽해요! 명화 박사 인정! 🏆"
    : ratio >= 0.7 ? "아주 잘했어요! 조금만 더 하면 만점이에요."
    : ratio >= 0.4 ? "좋아요! 틀린 그림을 다시 살펴볼까요?"
    : "괜찮아요! 도감에서 그림을 한 번 더 보고 도전해요.";

  if (state.wrong.length) {
    const seen = new Set();
    const arts = state.wrong.map((q) => q.art).filter((a) => !seen.has(a.id) && seen.add(a.id));
    $("review").innerHTML = `
      <h3 class="review-title">다시 보면 좋은 그림</h3>
      <div class="review-list">
        ${arts.map((a) => `<button class="review-item" data-art="${a.id}"><img src="${a.image}" alt="" /><span>${escapeHtml(a.title)}</span></button>`).join("")}
      </div>`;
  } else {
    $("review").innerHTML = "";
  }
  $("progress-bar").style.width = "100%";
  show("result");
}

function renderGallery() {
  $("gallery-grid").innerHTML = ARTWORKS.map(
    (a) => `
      <button class="gallery-item" data-art="${a.id}">
        <img src="${a.image}" alt="${escapeHtml(a.title)}" loading="lazy" />
        <span class="g-title">${escapeHtml(a.title)}</span>
        <span class="g-artist">${escapeHtml(a.artist)}</span>
      </button>`
  ).join("");
  show("gallery");
}

function openArt(id) {
  const art = ARTWORKS.find((a) => a.id === id);
  if (!art) return;
  $("dialog-body").innerHTML = artCardHtml(art, "story", true);
  $("art-dialog").showModal();
  $("art-dialog").scrollTop = 0;
}

/* ---------- 이벤트 ---------- */
$("home").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-mode]");
  if (btn) startQuiz(btn.dataset.mode);
});
$("choices").addEventListener("click", (e) => {
  const btn = e.target.closest(".choice");
  if (btn) answer(Number(btn.dataset.i));
});
document.addEventListener("keydown", (e) => {
  if ($("quiz").classList.contains("hidden")) return;
  if (!state.answered && ["1", "2", "3", "4"].includes(e.key)) answer(Number(e.key) - 1);
  else if (state.answered && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); }
});
$("next").addEventListener("click", next);
$("quit").addEventListener("click", () => show("home"));
$("retry").addEventListener("click", () => startQuiz(state.mode));
$("home-btn").addEventListener("click", () => show("home"));
$("open-gallery").addEventListener("click", renderGallery);
$("gallery-back").addEventListener("click", () => show("home"));
document.addEventListener("click", (e) => {
  const item = e.target.closest("[data-art]");
  if (item) openArt(item.dataset.art);
});
$("art-dialog").addEventListener("click", (e) => {
  if (e.target === $("art-dialog")) $("art-dialog").close();
});

renderHome();
