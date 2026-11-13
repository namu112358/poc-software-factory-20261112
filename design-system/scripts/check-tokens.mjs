#!/usr/bin/env node
// 部品のコードに、トークン以外の色・大きさが直書きされていないかを確かめる。
// Tailwind のテーマはトークンだけに絞ってある（src/styles/globals.css）ので、ここで見るのは
// それをすり抜ける書き方: 色の直書き（#hex・rgb()・hsl()・oklch()）と、任意の値（p-[13px] など）。
// 対象は src/components/ の .ts・.tsx（Stories と Docs は除く）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const target = join(root, "src", "components");

const rules = [
  { name: "色の直書き", re: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/ },
  // [&_svg]:size-4 のような「場所の指定」は許し、値の任意指定（-[...]）だけを見る。
  { name: "任意の値", re: /\b[a-z][a-z0-9-]*-\[[^\]]+\]/ },
  { name: "style 属性", re: /\bstyle=\{\{/ },
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    if (!/\.tsx?$/.test(name) || /\.stories\.tsx?$/.test(name)) return [];
    return [path];
  });
}

const problems = [];
for (const file of walk(target)) {
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      for (const rule of rules) {
        if (rule.re.test(line)) problems.push(`${relative(root, file)}:${i + 1}: ${rule.name}: ${line.trim()}`);
      }
    });
}

if (problems.length > 0) {
  console.error("トークン以外の値が見つかりました（src/styles/globals.css のトークンを使ってください）:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("check-tokens: OK");
