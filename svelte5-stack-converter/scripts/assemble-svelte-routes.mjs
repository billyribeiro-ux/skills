#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as prettier from "prettier";
import {
  verifiedReconstructions,
  reconstructedAssetPath,
} from "./reconstruction-input.mjs";
import { translateReactMount } from "./mapped-react.mjs";
import { buildEntry } from "../../native-stack-decompiler/scripts/build-mapped.mjs";
import { assertStageCertified } from "../../shared/pipeline-gate.mjs";

const args = process.argv.slice(2);
const arg = (flag, fallback) =>
  args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const source = path.resolve(arg("--source", "./01-native"));
const target = path.resolve(arg("--target", "./02-svelte5"));
const nativeCert = assertStageCertified({
  requiredStage: 1,
  dir: source,
  callerName: "assemble-svelte-routes.mjs",
});
const read = (dir, rel) =>
  JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
const recovery = read(source, "forensics/source-recovery.json");
if (recovery.runtimeStatus === "requires-runtime-reconstruction")
  throw Error("Native runtime reconstruction is incomplete");
const manifest = read(source, "forensics/routes-manifest.json");
const assetIndexFile = path.join(source, "forensics", "assets.json");
const assets = fs.existsSync(assetIndexFile)
  ? read(source, "forensics/assets.json")
  : {};
const fixtureFile = path.join(source, "__api_fixtures__", "manifest.json");
const fixtures = fs.existsSync(fixtureFile)
  ? read(source, "__api_fixtures__/manifest.json")
  : [];
const resourceIndex = Object.create(null);
const originalOrigin = manifest.targetOrigin ?? assets.targetOrigin;
if (originalOrigin) {
  const origin = new URL(originalOrigin);
  for (const row of [...(assets.assets ?? []), ...fixtures]) {
    if (!row.url || !(row.relPath || row.file)) continue;
    const file = row.relPath ?? row.file;
    if (/\.html?$/i.test(file) || row.contentType?.includes("text/html"))
      continue;
    const url = new URL(row.url, origin);
    const isLocal =
      url.hostname.replace(/^www\./, "") ===
        origin.hostname.replace(/^www\./, "") && url.port === origin.port;
    const key =
      (row.isRSC ? "rsc:" : "") +
      (isLocal ? "" : "/__external/" + url.host) +
      url.pathname +
      url.search;
    if (fs.existsSync(safePath(source, file)))
      resourceIndex[key] = {
        file,
        contentType:
          row.contentType ||
          (row.isRSC ? "text/x-component" : "application/json"),
      };
  }
}
const routes = manifest.routes.map((r) =>
  typeof r === "string" ? { route: r } : r,
);
const rebuilt = recovery.publicScripts.find(
  (e) => e.status === "rebuilt-from-source",
);
const mappedUrl = "/assets/recovered-entry.js";
const approved = new Set(
  recovery.publicScripts
    .filter((e) => e.status === "preserved-public")
    .map((e) => e.path),
);
const stageFiles = new Map();
const shell = {};
const priorSources = new Map();
function put(relative, content) {
  if (
    stageFiles.has(relative) &&
    !stageFiles.get(relative).equals(Buffer.from(content))
  )
    throw Error("Duplicate destination: " + relative);
  stageFiles.set(relative, Buffer.from(content));
}
function safePath(root, relative) {
  const result = path.resolve(root, relative);
  if (!result.startsWith(root + path.sep))
    throw Error("Invalid relative path: " + relative);
  return result;
}
function attr(node, name) {
  return node.attrs?.find((a) => a.name === name)?.value;
}
function pascal(text) {
  return String(text)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((x) => x[0].toUpperCase() + x.slice(1))
    .join("");
}
const escapeBraces = (s) =>
  s.replaceAll("{", "&#123;").replaceAll("}", "&#125;");
for (const rel of approved) {
  const data = fs.readFileSync(safePath(source, rel));
  put("static/" + rel, data);
  priorSources.set(rel, crypto.createHash("sha256").update(data).digest("hex"));
}
const reconstruction = verifiedReconstructions({
  source,
  mirror: path.resolve(
    arg("--mirror-dir", path.join(path.dirname(source), "00-mirror")),
  ),
  nativeCert,
  recovery,
  routes,
  put,
});
const builds = new Map(reconstruction.map((row) => [row.job.output, row.job]));
let compilerVersion = reconstruction.length
  ? read(source, "package.json").devDependencies?.esbuild
  : null;
let buildJob;
let reactMount;
if (rebuilt) {
  const jobs = read(source, ".native-tools/entries.json");
  if (jobs.length !== 1 || jobs[0].entry !== rebuilt.entry)
    throw Error("Mapped graph does not have a unique verified entry");
  reactMount = translateReactMount({ source, job: jobs[0], put });
  if (!reactMount) {
    buildJob = { ...jobs[0], output: "static" + mappedUrl };
    for (const rel of buildJob.sources) {
      if (!rel.startsWith("recovered-source/"))
        throw Error("Unknown recovered source " + rel);
      put(rel, fs.readFileSync(safePath(source, rel)));
    }
    builds.set(buildJob.output, buildJob);
    compilerVersion = recovery.rebuild.version;
  }
}
if (builds.size) {
  const shaderExtensions = new Set(
    [...builds.values()]
      .flatMap((job) => job.sources)
      .map((file) => path.extname(file))
      .filter((ext) => [".frag", ".glsl", ".vert"].includes(ext)),
  );
  if (shaderExtensions.size) {
    put(
      "src/shader-modules.d.ts",
      [...shaderExtensions]
        .sort()
        .map(
          (ext) =>
            'declare module "*' +
            ext +
            '" { const source: string; export default source; }',
        )
        .join("\n") + "\n",
    );
  }
  if (!compilerVersion)
    throw Error("Native project is missing the verified esbuild version");
  put(
    ".native-tools/build-mapped.mjs",
    fs.readFileSync(
      new URL(
        "../../native-stack-decompiler/scripts/build-mapped.mjs",
        import.meta.url,
      ),
    ),
  );
  put(
    ".native-tools/entries.json",
    JSON.stringify([...builds.values()], null, 2),
  );
  const pkg = read(target, "package.json");
  pkg.devDependencies.esbuild = compilerVersion;
  for (const command of ["dev", "build"])
    if (!pkg.scripts[command].includes(".native-tools/build-mapped.mjs"))
      pkg.scripts[command] =
        "node .native-tools/build-mapped.mjs && " + pkg.scripts[command];
  put("package.json", JSON.stringify(pkg, null, 2) + "\n");
}
for (const { route, documentFile } of routes) {
  const relative = decodeURIComponent(route.split("?")[0]).replace(
    /^\/+|\/+$/g,
    "",
  );
  if (
    route.includes("?") ||
    /(^|\/)(?:\.\.?|\[[^/]*\]|\([^/]*\)|\+[^/]*)(?:\/|$)/.test(relative)
  )
    throw Error("Route requires a SvelteKit routing adapter: " + route);
  const file = [
    documentFile,
    path.join(relative, "index.html"),
    relative,
    relative + ".html",
  ]
    .filter(Boolean)
    .map((p) => safePath(source, p))
    .find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) throw Error("Missing native HTML for " + route);
  const html = fs.readFileSync(file, "utf8");
  const { ast } = await prettier.__debug.parse(html, { parser: "html" });
  const root = ast.children.find((n) => n.name === "html");
  const head = (root?.children ?? ast.children).find((n) => n.name === "head");
  const body = (root?.children ?? ast.children).find((n) => n.name === "body");
  const slice = (span) =>
    span ? html.slice(span.start.offset, span.end.offset) : "";
  const attrs = (node) =>
    (node?.attrs ?? []).map((a) => " " + slice(a.sourceSpan)).join("");
  shell[route.replace(/\/$/, "") || "/"] = {
    html: attrs(root),
    body: attrs(body),
  };
  const pageImports = [];
  const containsMountScript = (n) =>
    (n.name === "script" && attr(n, "src") === "/" + rebuilt?.output) ||
    n.children?.some(containsMountScript);
  const mountHere = reactMount && containsMountScript(ast);
  const containsAnchor = (n) =>
    (attr(n, "id") === reactMount?.id && Boolean(reactMount)) ||
    n.children?.some(containsAnchor);
  let mounts = 0;
  const replacement = reconstruction.find((row) => row.route === route);
  let reconstructionMounts = 0;
  const names = new Set();
  function render(n, split = true) {
    if (!n.name) return escapeBraces(slice(n.sourceSpan));
    const tag = n.name;
    if (tag === "script") {
      const src = attr(n, "src");
      const type = attr(n, "type");
      if (!src) {
        if (
          type &&
          !["module", "text/javascript", "application/javascript"].includes(
            type,
          )
        ) {
          const rawText = n.children.map((c) => slice(c.sourceSpan)).join("");
          if (rawText.includes("<") || rawText.includes("&"))
            throw Error(route + ": data script requires an escaping adapter");
          return (
            '<svelte:element this={"script"}' +
            escapeBraces(attrs(n)) +
            ">{" +
            JSON.stringify(rawText) +
            "}</svelte:element>"
          );
        }
        if (!n.children.some((c) => slice(c.sourceSpan).trim())) return "";
        throw Error(route + ": inline JavaScript needs explicit migration");
      }
      const url = new URL(src, new URL(route, "http://local.test"));
      if (
        replacement &&
        url.origin === "http://local.test" &&
        url.pathname === "/" + replacement.nativeOutput
      ) {
        if (type !== "module")
          throw Error(route + ": authored controller lost its module mount");
        reconstructionMounts++;
        return (
          '<svelte:element this={"script"} type="module" src="/' +
          reconstructedAssetPath(replacement.nativeOutput) +
          '"></svelte:element>'
        );
      }
      if (
        rebuilt &&
        url.origin === "http://local.test" &&
        url.pathname === "/" + rebuilt.output
      ) {
        if (mountHere) return "";
        return (
          '<svelte:element this={"script"} type="module" src="' +
          mappedUrl +
          '"></svelte:element>'
        );
      }
      if (
        url.origin !== "http://local.test" ||
        !approved.has(
          resourceIndex[url.pathname + url.search]?.file ??
            decodeURIComponent(url.pathname).slice(1),
        )
      )
        throw Error(route + ": unverified JavaScript " + src);
      return (
        '<svelte:element this={"script"}' +
        escapeBraces(attrs(n)) +
        "></svelte:element>"
      );
    }
    if (tag === "style") return slice(n.sourceSpan);
    if (n.attrs.some((a) => /^on[a-z]/i.test(a.name)))
      throw Error(route + ": inline event handler requires migration");
    const open = escapeBraces(slice(n.startSourceSpan));
    const close = slice(n.endSourceSpan);
    const childNames = new Set([
      "section",
      "header",
      "nav",
      "footer",
      "aside",
      "article",
    ]);
    if (mountHere && attr(n, "id") === reactMount.id) {
      mounts++;
      pageImports.push(
        "  import RecoveredRoot from " +
          JSON.stringify("#lib/" + reactMount.component) +
          ";",
      );
      return open + "<RecoveredRoot />" + close;
    }
    if (split && childNames.has(tag) && !(mountHere && containsAnchor(n))) {
      const base =
        pascal(attr(n, "id") || attr(n, "data-component") || tag) || "Section";
      let name = /^[A-Z]/.test(base) ? base : "Section" + base;
      const first = name;
      for (let i = 2; names.has(name); i++) name = first + i;
      names.add(name);
      const rel = path.posix.join(
        "src/lib/pages",
        relative || "_home",
        name + ".svelte",
      );
      put(rel, render(n, false) + "\n");
      pageImports.push(
        "  import " +
          name +
          " from " +
          JSON.stringify("#lib/" + rel.slice("src/lib/".length)) +
          ";",
      );
      return "<" + name + " />";
    }
    return (
      open +
      (n.children ?? []).map((child) => render(child, split)).join("") +
      (n.endSourceSpan &&
      n.endSourceSpan.start.offset >= n.startSourceSpan.end.offset
        ? close
        : "")
    );
  }
  const headContent = (head?.children ?? [])
    .map((n) => render(n, false))
    .join("");
  const content = (
    body?.children ??
    (root?.children ?? ast.children).filter(
      (n) => n.kind !== "docType" && n !== head,
    )
  )
    .map((n) => render(n))
    .join("");
  if (replacement && reconstructionMounts !== 1)
    throw Error(route + ": reconstructed module must mount exactly once");
  if (mountHere && mounts !== 1)
    throw Error(route + ": recovered React root must have one DOM mount");
  const routeDir = path.posix.join("src/routes", relative);
  put(
    routeDir + "/+page.svelte",
    (pageImports.length
      ? "<script>\n" + pageImports.join("\n") + "\n</script>\n"
      : "") +
      (headContent ? "<svelte:head>" + headContent + "</svelte:head>\n" : "") +
      content +
      "\n",
  );
}
put("src/lib/data/resource-index.json", JSON.stringify(resourceIndex, null, 2));
put("src/lib/data/document-shells.json", JSON.stringify(shell, null, 2));
put(
  "forensics/authored-scripts.json",
  JSON.stringify(Object.fromEntries(priorSources), null, 2),
);
for (const [rel, content] of stageFiles) {
  const dest = safePath(target, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}
for (const job of builds.values()) await buildEntry(target, job);
for (const row of reconstruction)
  for (const { file } of row.outputs) {
    const actual = fs.readFileSync(
      safePath(target, "static/" + reconstructedAssetPath(file)),
    );
    if (!actual.equals(fs.readFileSync(safePath(source, file))))
      throw Error(
        "Svelte rebuild diverged from certified native output: " + file,
      );
  }
console.log(
  "Assembled " +
    routes.length +
    " Svelte routes and preserved " +
    approved.size +
    " authored browser scripts.",
);
