import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(root, "..");
const src = path.join(pkg, "src", "renderer");
const dest = path.join(pkg, "dist", "renderer");
const resSrc = path.join(pkg, "resources");
const resDest = path.join(pkg, "dist", "resources");

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });
await mkdir(resDest, { recursive: true });
await cp(resSrc, resDest, { recursive: true });
console.log("copied renderer + resources → dist/");
