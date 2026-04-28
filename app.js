const FOOD_ITEMS = [
  { name: "치킨", emoji: "🍗" },
  { name: "피자", emoji: "🍕" },
  { name: "떡볶이", emoji: "🌶️" },
  { name: "라면", emoji: "🍜" },
  { name: "삼겹살", emoji: "🥓" },
  { name: "족발", emoji: "🍖" },
  { name: "초밥", emoji: "🍣" },
  { name: "회", emoji: "🐟" },
  { name: "햄버거", emoji: "🍔" },
  { name: "핫도그", emoji: "🌭" },
  { name: "짜장면", emoji: "🥢" },
  { name: "짬뽕", emoji: "🍲" },
  { name: "파스타", emoji: "🍝" },
  { name: "리조또", emoji: "🍚" },
  { name: "빙수", emoji: "🍧" },
  { name: "아이스크림", emoji: "🍨" },
# 새 작업 폴더 만들기
mkdir food-worldcup-clean
cd food-worldcup-clean

# 파일 3개 만들기
cat > index.html <<'EOF'
<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>음식 이상형 월드컵</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="app">
    <header>
      <h1>🍽️ 음식 이상형 월드컵</h1>
      <p id="status">16강 1 / 8</p>
    </header>

    <section class="match" id="match">
      <button class="food-card" id="left-card">
        <img class="food-image" src="" alt="" />
        <span class="food-name"></span>
      </button>
      <span class="vs">VS</span>
      <button class="food-card" id="right-card">
        <img class="food-image" src="" alt="" />
        <span class="food-name"></span>
      </button>
    </section>

    <section class="controls">
      <button id="restart">처음부터 다시하기</button>
    </section>

    <section class="result hidden" id="result"></section>

    <section class="history">
      <h2>📚 라운드별 승자 기록</h2>
      <p id="history-empty">아직 완료된 라운드가 없어요.</p>
      <div id="history-list"></div>
    </section>
  </main>

  <script src="app.js"></script>
</body>
</html>
EOF

cat > styles.css <<'EOF'
body { margin:0; font-family:sans-serif; background:#fff5f5; }
.app { max-width:900px; margin:20px auto; background:#fff; padding:20px; border-radius:14px; }
.match { display:grid; grid-template-columns:1fr auto 1fr; gap:12px; }
.food-card { border:1px solid #f4caca; border-radius:12px; padding:10px; background:#fff; cursor:pointer; }
.food-image { width:100%; height:180px; object-fit:cover; border-radius:10px; }
.food-name { display:block; font-weight:700; margin-top:8px; }
.controls { margin-top:14px; }
.result { margin-top:14px; padding:12px; border:1px dashed #f0b96c; border-radius:10px; background:#fff7e6; }
.history { margin-top:16px; padding:12px; border:1px solid #f4dede; border-radius:10px; background:#fffafa; }
.hidden { display:none; }
@media (max-width:700px){ .match { grid-template-columns:1fr; } .vs{text-align:center;} }
EOF

cat > app.js <<'EOF'
const FOOD_ITEMS = [
  { name: "치킨", emoji: "🍗" }, { name: "피자", emoji: "🍕" },
  { name: "떡볶이", emoji: "🌶️" }, { name: "라면", emoji: "🍜" },
  { name: "삼겹살", emoji: "🥓" }, { name: "족발", emoji: "🍖" },
  { name: "초밥", emoji: "🍣" }, { name: "회", emoji: "🐟" },
  { name: "햄버거", emoji: "🍔" }, { name: "핫도그", emoji: "🌭" },
  { name: "짜장면", emoji: "🥢" }, { name: "짬뽕", emoji: "🍲" },
  { name: "파스타", emoji: "🍝" }, { name: "리조또", emoji: "🍚" },
  { name: "빙수", emoji: "🍧" }, { name: "아이스크림", emoji: "🍨" },
];

const statusElement = document.getElementById("status");
const leftCard = document.getElementById("left-card");
const rightCard = document.getElementById("right-card");
const resultSection = document.getElementById("result");
const restartButton = document.getElementById("restart");
const matchSection = document.getElementById("match");
const historyList = document.getElementById("history-list");
const historyEmpty = document.getElementById("history-empty");

let currentRound = [];
let winners = [];
let roundSize = 16;
let matchIndex = 0;
let roundHistory = [];

function shuffle(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function makeFoodImage(food) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ffe8e8" /><stop offset="100%" stop-color="#ffecc8" /></linearGradient></defs><rect width="1200" height="800" rx="40" fill="url(#bg)" /><text x="600" y="360" text-anchor="middle" font-size="190">${food.emoji}</text><text x="600" y="540" text-anchor="middle" font-size="90" font-family="sans-serif" fill="#7a3f3f">${food.name}</text></svg>`;
  const encoded = window.btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${encoded}`;
}

function renderCard(button, food) {
  const imageElement = button.querySelector(".food-image");
  const nameElement = button.querySelector(".food-name");

  imageElement.src = makeFoodImage(food);
  imageElement.alt = `${food.name} 이미지`;
  imageElement.onerror = () => {
    imageElement.src = "https://dummyimage.com/1200x800/ffe8e8/7a3f3f.png&text=" + encodeURIComponent(food.name);
  };
  nameElement.textContent = `${food.emoji} ${food.name}`;

  button.dataset.foodName = food.name;
}

function renderHistory() {
  historyList.innerHTML = "";

  if (roundHistory.length === 0) {
    historyEmpty.classList.remove("hidden");
    return;
  }

  historyEmpty.classList.add("hidden");

  roundHistory.forEach((round) => {
    const roundItem = document.createElement("article");
    roundItem.className = "history-round";

    const title = document.createElement("h3");
    title.textContent = `${round.label} 승자`;

    const winnersElement = document.createElement("div");
    winnersElement.className = "winner-chips";

    round.winners.forEach((food) => {
      const chip = document.createElement("span");
      chip.className = "winner-chip";
      chip.textContent = `${food.emoji} ${food.name}`;
      winnersElement.append(chip);
    });

    roundItem.append(title, winnersElement);
    historyList.append(roundItem);
  });
}

function initTournament() {
  currentRound = shuffle(FOOD_ITEMS);
  winners = [];
  roundSize = currentRound.length;
  matchIndex = 0;
  roundHistory = [];
  resultSection.classList.add("hidden");
  matchSection.classList.remove("hidden");
  renderHistory();
  renderMatch();
}

function renderMatch() {
  const left = currentRound[matchIndex * 2];
  const right = currentRound[matchIndex * 2 + 1];

  renderCard(leftCard, left);
  renderCard(rightCard, right);
  statusElement.textContent = `${roundSize}강 ${matchIndex + 1} / ${roundSize / 2}`;
}

function choose(foodName) {
  const winner = currentRound.find((food) => food.name === foodName);

  if (!winner) {
    return;
  }

  winners.push(winner);
  matchIndex += 1;

  if (matchIndex >= currentRound.length / 2) {
    roundHistory.push({
      label: `${roundSize}강`,
      winners: [...winners],
    });

    if (winners.length === 1) {
      renderHistory();
      showChampion(winners[0]);
      return;
    }

    currentRound = winners;
    winners = [];
    roundSize = currentRound.length;
    matchIndex = 0;
    renderHistory();
  }

  renderMatch();
}

function showChampion(champion) {
  matchSection.classList.add("hidden");
  statusElement.textContent = "우승 음식이 결정됐어요!";
  resultSection.innerHTML = `
    <h2>🏆 최종 우승</h2>
    <p>${champion.emoji} ${champion.name}</p>
    <img src="${makeFoodImage(champion)}" alt="${champion.name} 이미지" class="champion-image" />
  `;
  resultSection.classList.remove("hidden");
}

leftCard.addEventListener("click", () => {
  choose(leftCard.dataset.foodName);
});

rightCard.addEventListener("click", () => {
  choose(rightCard.dataset.foodName);
});

restartButton.addEventListener("click", initTournament);

initTournament();
function shuffle(items){ const a=[...items]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function makeImg(food){
  const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='800'><rect width='100%' height='100%' fill='#ffe9d5'/><text x='50%' y='45%' text-anchor='middle' font-size='180'>${food.emoji}</text><text x='50%' y='65%' text-anchor='middle' font-size='80'>${food.name}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function renderCard(btn, food){
  btn.querySelector(".food-image").src = makeImg(food);
  btn.querySelector(".food-image").alt = `${food.name} 이미지`;
  btn.querySelector(".food-name").textContent = `${food.emoji} ${food.name}`;
  btn.dataset.foodName = food.name;
}
function renderHistory(){
  historyList.innerHTML="";
  if(roundHistory.length===0){ historyEmpty.style.display="block"; return; }
  historyEmpty.style.display="none";
  roundHistory.forEach(r=>{
    const box=document.createElement("div");
    box.innerHTML=`<strong>${r.label} 승자</strong><div>${r.winners.map(w=>`<span style="margin-right:8px">${w.emoji} ${w.name}</span>`).join("")}</div>`;
    historyList.appendChild(box);
  });
}
function renderMatch(){
  const left=currentRound[matchIndex*2];
  const right=currentRound[matchIndex*2+1];
  renderCard(leftCard,left); renderCard(rightCard,right);
  statusElement.textContent=`${roundSize}강 ${matchIndex+1} / ${roundSize/2}`;
}
function showChampion(c){
  matchSection.classList.add("hidden");
  statusElement.textContent="우승 음식이 결정됐어요!";
  resultSection.innerHTML=`<h2>🏆 최종 우승</h2><p>${c.emoji} ${c.name}</p><img src="${makeImg(c)}" style="max-width:100%;border-radius:10px" />`;
  resultSection.classList.remove("hidden");
}
function initTournament(){
  currentRound=shuffle(FOOD_ITEMS); winners=[]; roundSize=currentRound.length; matchIndex=0; roundHistory=[];
  resultSection.classList.add("hidden"); matchSection.classList.remove("hidden");
  renderHistory(); renderMatch();
}
function choose(name){
  const w=currentRound.find(f=>f.name===name); if(!w) return;
  winners.push(w); matchIndex++;
  if(matchIndex>=currentRound.length/2){
    roundHistory.push({label:`${roundSize}강`, winners:[...winners]});
    if(winners.length===1){ renderHistory(); showChampion(winners[0]); return; }
    currentRound=winners; winners=[]; roundSize=currentRound.length; matchIndex=0; renderHistory();
  }
  renderMatch();
}
leftCard.onclick=()=>choose(leftCard.dataset.foodName);
rightCard.onclick=()=>choose(rightCard.dataset.foodName);
restartButton.onclick=initTournament;
initTournament();
EOF
