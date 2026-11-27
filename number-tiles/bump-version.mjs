// 파일을 고친 뒤 실행: node bump-version.mjs
// 모든 파일 주소 뒤의 ?v=버전 과 version.txt 를 새 값으로 바꿔서, 옛 파일이 섞이지 않게 해요.
import { readFileSync, writeFileSync } from "node:fs";

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const edit = (name, fn) => {
  const url = new URL(name, import.meta.url);
  writeFileSync(url, fn(readFileSync(url, "utf8")));
};
edit("index.html", (s) => s.replace(/\?v=[\w-]+/g, `?v=${version}`).replace(/(name="app-version" content=")[\w-]+/, `$1${version}`));
edit("app.js", (s) => s.replace(/const VERSION = "[\w-]+"/, `const VERSION = "${version}"`));
writeFileSync(new URL("version.txt", import.meta.url), version + "\n");
console.log(`버전 표시를 ${version}(으)로 바꿨어요.`);
