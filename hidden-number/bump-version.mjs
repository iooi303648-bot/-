// 파일을 고친 뒤 실행: node bump-version.mjs
// 모든 파일 주소 뒤의 ?v=버전 을 새 값으로 바꿔서, 브라우저가 옛 파일을 쓰지 않게 해요.
import { readFileSync, writeFileSync } from "node:fs";

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

for (const name of ["index.html", "app.js", "net.js"]) {
  const url = new URL(name, import.meta.url);
  const before = readFileSync(url, "utf8");
  const after = before.replace(/\?v=[\w-]+/g, `?v=${version}`);
  writeFileSync(url, after);
}
console.log(`버전 표시를 ${version}(으)로 바꿨어요.`);
