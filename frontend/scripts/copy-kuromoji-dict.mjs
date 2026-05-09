import { mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const from = path.resolve("node_modules/kuromoji/dict");
const to = path.resolve("public/kuromoji/dict");

if (!existsSync(from)) {
  console.error(`[postinstall] kuromoji dict not found: ${from}`);
  process.exit(1);
}

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`[postinstall] copied kuromoji dict -> ${to}`);

