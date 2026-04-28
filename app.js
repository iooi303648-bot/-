const FOODS = [
  "치킨",
  "피자",
  "떡볶이",
  "라면",
  "삼겹살",
  "족발",
  "초밥",
  "회",
  "햄버거",
  "핫도그",
  "짜장면",
  "짬뽕",
  "파스타",
  "리조또",
  "빙수",
  "아이스크림",
];

const statusElement = document.getElementById("status");
const leftCard = document.getElementById("left-card");
const rightCard = document.getElementById("right-card");
const resultSection = document.getElementById("result");
const restartButton = document.getElementById("restart");
const matchSection = document.getElementById("match");

let currentRound = [];
let winners = [];
let roundSize = 16;
let matchIndex = 0;

function shuffle(items) {
  const cloned = [...items];
  for (let i = cloned.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
}

function initTournament() {
  currentRound = shuffle(FOODS);
  winners = [];
  roundSize = currentRound.length;
  matchIndex = 0;
  resultSection.classList.add("hidden");
  matchSection.classList.remove("hidden");
  renderMatch();
}

function renderMatch() {
  const left = currentRound[matchIndex * 2];
  const right = currentRound[matchIndex * 2 + 1];

  leftCard.textContent = left;
  rightCard.textContent = right;
  statusElement.textContent = `${roundSize}강 ${matchIndex + 1} / ${roundSize / 2}`;
}

function choose(food) {
  winners.push(food);
  matchIndex += 1;

  if (matchIndex >= currentRound.length / 2) {
    if (winners.length === 1) {
      showChampion(winners[0]);
      return;
    }

    currentRound = winners;
    winners = [];
    roundSize = currentRound.length;
    matchIndex = 0;
  }

  renderMatch();
}

function showChampion(champion) {
  matchSection.classList.add("hidden");
  statusElement.textContent = "우승 음식이 결정됐어요!";
  resultSection.innerHTML = `
    <h2>🏆 최종 우승</h2>
    <p>${champion}</p>
  `;
  resultSection.classList.remove("hidden");
}

leftCard.addEventListener("click", () => {
  choose(leftCard.textContent);
});

rightCard.addEventListener("click", () => {
  choose(rightCard.textContent);
});

restartButton.addEventListener("click", initTournament);

initTournament();
