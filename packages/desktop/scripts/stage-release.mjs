#!/usr/bin/env node
/**
 * Stage a self-contained Electron app directory for electron-builder.
 * Copies desktop dist + workspace packages + runtime deps (zod, playwright).
 * Playwright browsers are NOT bundled — page extraction stays honest/optional.
 */
import {
  cp,
  mkdir,
  rm,
  readFile,
  writeFile,
  access,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const stageRoot = path.join(desktopRoot, "release-stage");
const require = createRequire(import.meta.url);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyPkg(name) {
  const src = path.join(repoRoot, "packages", name);
  const dest = path.join(stageRoot, "node_modules", "@tabhandoff", name);
  if (!(await exists(path.join(src, "dist")))) {
    throw new Error(
      `Missing build output for @tabhandoff/${name} (run pnpm build)`,
    );
  }
  await mkdir(dest, { recursive: true });
  const pkg = JSON.parse(await readFile(path.join(src, "package.json"), "utf8"));
  const stagedPkg = {
    name: pkg.name,
    version: pkg.version,
    type: pkg.type ?? "module",
    main: pkg.main,
    exports: pkg.exports,
  };
  await writeFile(path.join(dest, "package.json"), JSON.stringify(stagedPkg, null, 2));
  await cp(path.join(src, "dist"), path.join(dest, "dist"), { recursive: true });
}

async function resolvePkgDir(name) {
  try {
    const resolved = require.resolve(`${name}/package.json`);
    return path.dirname(await realpath(resolved));
  } catch {
    /* continue */
  }
  try {
    const alt = createRequire(
      path.join(repoRoot, "packages/bridge/package.json"),
    );
    const resolved = alt.resolve(`${name}/package.json`);
    return path.dirname(await realpath(resolved));
  } catch {
    /* continue */
  }
  // pnpm virtual store fallback (e.g. playwright-core sibling)
  const pnpm = path.join(repoRoot, "node_modules", ".pnpm");
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(pnpm);
  const match = entries.find((e) => e.startsWith(`${name}@`));
  if (match) {
    const candidate = path.join(pnpm, match, "node_modules", name);
    if (await exists(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve package ${name}`);
}

async function copyNodeDep(name) {
  const pkgDir = await resolvePkgDir(name);
  const dest = path.join(stageRoot, "node_modules", name);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(pkgDir, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === ".local-browsers" || base === "browsers") return false;
      return true;
    },
  });
}

async function main() {
  if (!(await exists(path.join(desktopRoot, "dist", "main.js")))) {
    throw new Error(
      "packages/desktop/dist missing — run pnpm --filter @tabhandoff/desktop build",
    );
  }

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });

  await cp(path.join(desktopRoot, "dist"), path.join(stageRoot, "dist"), {
    recursive: true,
  });

  const desktopPkg = JSON.parse(
    await readFile(path.join(desktopRoot, "package.json"), "utf8"),
  );

  const stagePkg = {
    name: "tabhandoff",
    productName: "TabHandoff",
    desktopName: "tabhandoff",
    version: desktopPkg.version,
    description: desktopPkg.description,
    license: "MIT",
    homepage: "https://tabhandoff.com",
    author: "TabHandoff <hello@tabhandoff.com>",
    private: true,
    type: "module",
    main: "./dist/main.js",
  };

  await writeFile(
    path.join(stageRoot, "package.json"),
    JSON.stringify(stagePkg, null, 2),
  );

  for (const name of ["protocol", "evidence", "runner", "bridge"]) {
    await copyPkg(name);
  }

  await copyNodeDep("zod");
  await copyNodeDep("playwright");
  await copyNodeDep("playwright-core");

  const buildDir = path.join(desktopRoot, "build");
  await mkdir(buildDir, { recursive: true });
  const iconSrc = path.join(repoRoot, "docs/assets/tabhandoff-app-icon.png");
  const iconFallback = path.join(desktopRoot, "resources/icon.png");
  const icon = (await exists(iconSrc)) ? iconSrc : iconFallback;
  await cp(icon, path.join(buildDir, "icon.png"));

  console.log(`staged release app → ${stageRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
