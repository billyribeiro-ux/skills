import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parse } from "@babel/parser";
import traversePackage from "@babel/traverse";
const traverse = traversePackage.default ?? traversePackage;
import { buildEntry } from "./build-mapped.mjs";

const extensions = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  "/index.ts",
  "/index.js",
  "/index.tsx",
  "/index.jsx",
];
const require = createRequire(import.meta.url);

function findEntry(dir, files) {
  const available = new Set(files);
  const referenced = new Set();
  for (const file of files) {
    if (/\.(?:glsl|vert|frag)$/.test(file)) continue;
    const ast = parse(fs.readFileSync(path.join(dir, file), "utf8"), {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    const imports = [];
    traverse(ast, {
      "ImportDeclaration|ExportNamedDeclaration|ExportAllDeclaration"(node) {
        if (node.node.source) imports.push(node.node.source.value);
      },
      CallExpression(node) {
        if (node.node.callee.type !== "Import") return;
        const target = node.node.arguments[0];
        if (target?.type !== "StringLiteral")
          throw new Error("Dynamic import requires a literal captured source");
        imports.push(target.value);
      },
    });
    for (const spec of imports) {
      if (!spec.startsWith("."))
        throw new Error(
          "External dependency requires a verified project manifest: " + spec,
        );
      const rel = path.normalize(path.join(path.dirname(file), spec));
      const resolved = extensions
        .map((ext) => rel + ext)
        .find((candidate) => available.has(candidate));
      if (!resolved) throw new Error("Import missing from map: " + spec);
      referenced.add(resolved);
    }
  }
  const roots = files.filter((file) => !referenced.has(file));
  if (roots.length !== 1)
    throw new Error("Cannot establish a unique embedded entry");
  return roots[0];
}

// Restore a single source-mapped browser entry only when its original script tags can be identified.
export async function linkMapped(mirror, out, sources, publicScripts) {
  const mapPath = path.join(mirror, "forensics", "assets.json");
  const routePath = path.join(mirror, "forensics", "routes-manifest.json");
  if (!fs.existsSync(mapPath) || !fs.existsSync(routePath)) return null;
  const assets = JSON.parse(fs.readFileSync(mapPath));
  const routes = JSON.parse(fs.readFileSync(routePath)).routes;
  const blocked = publicScripts.filter((s) => s.status === "unresolved");
  if (!blocked.length) return null;
  const byURL = new Map();
  for (const script of blocked) {
    const asset = assets.assets.find((a) => a.relPath === script.path);
    if (!asset) return null;
    const records = sources.filter((s) => s.scriptUrl === asset.url);
    if (
      !records.length ||
      records.some(
        (s) =>
          s.firstParty === false ||
          s.status !== "embedded-source" ||
          !s.outputPath.startsWith("recovered-source/"),
      )
    )
      return null;
    byURL.set(asset.url, { script, files: records.map((s) => s.outputPath) });
  }
  try {
    const files = [...new Set([...byURL.values()].flatMap((e) => e.files))];
    const entry = findEntry(out, files);
    const job = {
      entry,
      sources: files,
      output: ".native-build/main.js",
      splitting: blocked.length > 1,
    };
    const rootInfo = [...byURL.values()].find((info) =>
      info.files.includes(entry),
    );
    if (!rootInfo) throw new Error("Captured entry URL is ambiguous");
    const changes = [];
    let mounts = 0;
    const normalizedRoutes = routes.map((route) =>
      typeof route === "string" ? { route } : route,
    );
    for (const r of normalizedRoutes) {
      const filename =
        r.documentFile ||
        path.join(
          new URL(r.route, assets.targetOrigin).pathname.slice(1),
          "index.html",
        );
      const base = path.resolve(mirror, filename);
      if (!base.startsWith(mirror + path.sep))
        throw new Error("Invalid route path");
      const html = fs.readFileSync(base, "utf8");
      const next = html.replace(/<script\b[^>]*>/gi, (tag) => {
        const attr = tag.match(/\ssrc\s*=\s*(["'])(.*?)\1/i);
        if (!attr) return tag;
        const originalURL = new URL(
          attr[2],
          new URL(r.route, assets.targetOrigin),
        ).href;
        const info = byURL.get(originalURL);
        if (!info) return tag;
        if (info !== rootInfo)
          throw new Error(
            "Multiple independent route entries require separate reconstruction",
          );
        if (!/\stype\s*=\s*(["'])module\1/i.test(tag))
          throw new Error("Mapped entry requires a module script");
        mounts++;
        return tag
          .replace(attr[0], ' src="/.native-build/main.js"')
          .replace(/\sintegrity\s*=\s*(["']).*?\1/i, "");
      });
      changes.push([path.join(out, filename), next]);
    }
    if (!mounts) throw new Error("No route loads the captured module URL");
    const outputs = await buildEntry(out, job);
    for (const [file, text] of changes) fs.writeFileSync(file, text);
    const tools = path.join(out, ".native-tools");
    fs.copyFileSync(
      new URL("./build-mapped.mjs", import.meta.url),
      path.join(tools, "build-mapped.mjs"),
    );
    fs.writeFileSync(
      path.join(tools, "entries.json"),
      JSON.stringify([job], null, 2),
    );
    for (const info of byURL.values()) {
      info.script.status =
        info === rootInfo ? "rebuilt-from-source" : "rebuilt-lazy-module";
      info.script.sources = info.files;
      if (info === rootInfo) {
        info.script.entry = entry;
        info.script.output = job.output;
      }
      delete info.script.reason;
    }
    return {
      compiler: "esbuild",
      version: require("esbuild/package.json").version,
      entry,
      mounts,
      outputs,
    };
  } catch (err) {
    for (const script of blocked) script.reason = err.message;
    return null;
  }
}
