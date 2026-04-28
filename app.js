const FOODS = [
  {
    name: "치킨",
    image:
      "https://images.unsplash.com/photo-1562967916-eb82221dfb92?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "피자",
    image:
      "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "떡볶이",
    image:
      "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "라면",
    image:
      "https://images.unsplash.com/photo-1614563637806-1d0e645e0940?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "삼겹살",
    image:
      "https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "족발",
    image:
      "https://images.unsplash.com/photo-1603360946369-dc9bb6258143?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "초밥",
    image:
      "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "회",
    image:
      "https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "햄버거",
    image:
      "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "핫도그",
    image:
      "https://images.unsplash.com/photo-1612392062798-2e8f56f9e6f8?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "짜장면",
    image:
      "https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "짬뽕",
    image:
      "https://images.unsplash.com/photo-1512058564366-c9e3e046a8a5?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "파스타",
    image:
      "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "리조또",
    image:
      "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "빙수",
    image:
      "https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "아이스크림",
    image:
      "https://images.unsplash.com/photo-1560008581-09826d1de69e?auto=format&fit=crop&w=1200&q=80",
  },
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

function renderCard(button, food) {
  const imageElement = button.querySelector(".food-image");
  const nameElement = button.querySelector(".food-name");

  imageElement.src = food.image;
  imageElement.alt = `${food.name} 이미지`;
  nameElement.textContent = food.name;

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
      chip.textContent = food.name;
      winnersElement.append(chip);
    });

    roundItem.append(title, winnersElement);
    historyList.append(roundItem);
  });
}

function initTournament() {
  currentRound = shuffle(FOODS);
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
    <p>${champion.name}</p>
    <img src="${champion.image}" alt="${champion.name} 이미지" class="champion-image" />
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
