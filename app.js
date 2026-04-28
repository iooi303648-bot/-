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
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffe8e8" />
          <stop offset="100%" stop-color="#ffecc8" />
        </linearGradient>
      </defs>
      <rect width="1200" height="800" rx="40" fill="url(#bg)" />
      <text x="600" y="360" text-anchor="middle" font-size="190">${food.emoji}</text>
      <text x="600" y="540" text-anchor="middle" font-size="90" font-family="Apple SD Gothic Neo, Noto Sans KR, sans-serif" fill="#7a3f3f">${food.name}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderCard(button, food) {
  const imageElement = button.querySelector(".food-image");
  const nameElement = button.querySelector(".food-name");

  imageElement.src = makeFoodImage(food);
  imageElement.alt = `${food.name} 이미지`;
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
