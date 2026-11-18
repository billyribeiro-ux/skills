#!/usr/bin/env node
import fs from "node:fs";
import {
  requireFreshOutput,
  finishNative,
  bundlePath,
} from "./native-recovery.mjs";
import path from "node:path";

import { decomposeRouteSections } from "./decompose-route-sections.mjs";

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_DIR = path.resolve(getArg("--mirror-dir", "./00-mirror"));
const OUT_DIR = path.resolve(getArg("--out-dir", "./01-native"));

console.log(
  `📄 Stage 1 Mode B Decompiler: Clean Static / CMS Architecture (Zero-Chunk)`,
);
console.log(`  Mirror Source: ${MIRROR_DIR}`);
console.log(`  Output Native: ${OUT_DIR}`);

requireFreshOutput(MIRROR_DIR, OUT_DIR);
const publicScripts = [];

fs.mkdirSync(path.join(OUT_DIR, "src", "controllers"), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, "src", "styles"), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, "forensics"), { recursive: true });

function copyStaticAssets(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    if (["node_modules", ".git", "__sourcemaps__"].includes(path.basename(src)))
      return;
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyStaticAssets(path.join(src, child), path.join(dest, child));
    }
  } else {
    const relative = path.relative(MIRROR_DIR, src);
    if (/\.m?js$/i.test(relative) && !relative.startsWith("forensics/")) {
      const code = fs.readFileSync(src, "utf8");
      if (
        bundlePath.test(relative) ||
        /(?:self|globalThis|window)\.(?:webpackChunk\w*|TURBOPACK)\s*[=(.]/.test(
          code,
        )
      ) {
        publicScripts.push({
          path: relative,
          status: "unresolved",
          reason: "Compiled bundle requires native reconstruction",
        });
        return;
      }
      publicScripts.push({ path: relative, status: "preserved-public" });
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

copyStaticAssets(MIRROR_DIR, OUT_DIR);

// Standalone static scripts keep their import bases, execution type and route ownership.
decomposeRouteSections(OUT_DIR);

const pkgJson = {
  name: "stage1-native-static",
  version: "1.0.0",
  private: true,
  type: "module",
  scripts: {
    dev: "node ../.agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir . --port 3011",
    start:
      "node ../.agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir . --port 3011",
  },
};
if (fs.existsSync(path.join(OUT_DIR, "package.json")))
  throw new Error("Public package.json conflicts with generated manifest");
fs.writeFileSync(
  path.join(OUT_DIR, "package.json"),
  JSON.stringify(pkgJson, null, 2),
  "utf8",
);

console.log(`✅ Stage 1 Mode B Decompilation completed into ${OUT_DIR}`);

await finishNative(MIRROR_DIR, OUT_DIR, "B", publicScripts);
