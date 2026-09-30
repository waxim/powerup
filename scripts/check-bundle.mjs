// Checks the production build keeps the practice mode (engine + bots) out of the main bundle.
// Run after `vite build`: node scripts/check-bundle.mjs
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const dir = "dist/client/assets";
const html = readFileSync("dist/client/index.html", "utf8");
const entryName = html.match(/assets\/(index-[\w-]+\.js)/)?.[1];
const kb = (bytes) => Math.round(bytes / 102.4) / 10;
const gz = (file) => gzipSync(readFileSync(`${dir}/${file}`)).length;
const failures = [];

if (!entryName) failures.push("no entry script in index.html");
const entry = entryName ? readFileSync(`${dir}/${entryName}`, "utf8") : "";
// Strings only the engine and the bots contain.
for (const marker of ["Shuffle up and deal", "Knocked out by EMP", "loves a power"]) {
  if (entry.includes(marker)) failures.push(`the main bundle contains "${marker}": practice code leaked out of its chunk`);
}
const tryChunks = readdirSync(dir).filter((f) => /^Try-.*\.js$/.test(f));
if (tryChunks.length !== 1) failures.push(`expected one Try chunk, found ${tryChunks.length}`);
const ENTRY_LIMIT_KB = 96;
const TRY_LIMIT_KB = 34;
if (entryName && kb(gz(entryName)) > ENTRY_LIMIT_KB) failures.push(`main bundle is ${kb(gz(entryName))} KB gzipped (limit ${ENTRY_LIMIT_KB})`);
for (const f of tryChunks) if (kb(gz(f)) > TRY_LIMIT_KB) failures.push(`${f} is ${kb(gz(f))} KB gzipped (limit ${TRY_LIMIT_KB})`);

console.log(`main ${entryName} ${entryName ? kb(gz(entryName)) : "?"} KB gz; practice ${tryChunks.map((f) => `${f} ${kb(gz(f))} KB gz`).join(", ")}`);
if (failures.length) {
  for (const f of failures) console.error(`✘ ${f}`);
  process.exit(1);
}
console.log("✓ bundle ok");
