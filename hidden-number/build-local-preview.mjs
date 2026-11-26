// 파일 직접 열기용 스크립트 생성: node build-local-preview.mjs
// 웹 주소에서는 원본 모듈과 firebase-config.js를 그대로 사용합니다.
import { readFileSync, writeFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const game = read("game.js");
const names = [...game.matchAll(/export\s+(?:const|function)\s+(\w+)/g)].map((match) => match[1]);
const net = read("net.js").replace(/^import[^\n]+\n/gm, "").replace(/^export /gm, "");
const app = read("app.js").replace(/^import[^\n]+\n/gm, "");
const motion = read("motion.js").replace(/^export /gm, "");
const output = `// build-local-preview.mjs로 생성. 직접 수정하지 마세요.
// file:// 미리보기는 Firebase를 사용하지 않는 연습 모드입니다.
(() => {
"use strict";
const G = (() => {
${game.replace(/^export /gm, "")}
return { ${names.join(", ")} };
})();
const firebaseConfig = {};
${motion}
${net}
${app}
})();
`;
writeFileSync(new URL("local-preview.js", import.meta.url), output);
console.log("local-preview.js 생성 완료");
