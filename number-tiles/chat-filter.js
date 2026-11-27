(function (root) {
"use strict";
// 채팅 비속어 가리기
// 흔한 욕설을 *** 로 바꿔요. 글자 사이에 띄어쓰기·숫자·기호를 넣어도 잡아요 (예: "시 1 발").
// 모든 나쁜 말을 막을 수는 없어요. 단어를 더 막고 싶으면 아래 목록에 추가하세요.
const BAD_WORDS = [
  "시발", "씨발", "씨빨", "씨바", "시바", "ㅅㅂ", "ㅆㅂ", "ㅅ ㅂ", "십새", "씹",
  "병신", "븅신", "빙신", "ㅂㅅ",
  "개새끼", "개새기", "새끼야", "새기야", "ㅅㄲ",
  "지랄", "ㅈㄹ", "좆", "존나", "졸라", "ㅈㄴ", "좃",
  "미친놈", "미친년", "미친새", "ㅁㅊ",
  "닥쳐", "꺼져", "엿먹", "썅", "쌍놈", "염병", "엠창", "니애미", "느금", "애미", "애비",
  "또라이", "찐따", "등신",
  "fuck", "shit", "bitch", "damn",
];

const escape = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 글자 사이에 공백·숫자·기호가 끼어 있어도 잡도록
const GAP = "[\\s\\d_\\-.,!?~*^'\"`·•/\\\\]*";
const PATTERNS = BAD_WORDS
  .map((w) => w.replace(/\s/g, ""))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length)
  .map((w) => new RegExp([...w].map(escape).join(GAP), "gi"));

const CHAT_MAX = 60;

function cleanText(text) {
  let out = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
  for (const re of PATTERNS) out = out.replace(re, (m) => "*".repeat(Math.min(m.length, 6)));
  return out;
}

root.ChatFilter = { cleanText, CHAT_MAX };
})(self);
