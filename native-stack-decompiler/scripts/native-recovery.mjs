import fs from "node:fs";
import { linkMapped } from "./link-mapped.mjs";
import path from "node:path";
import { createHash } from "node:crypto";

const hash = (data) => createHash("sha256").update(data).digest("hex");
export const bundlePath =
  /(?:^|\/)(?:_(?:next\/static|astro|nuxt)\/.*|(?:webpack|turbopack|chunk-|bundle|runtime)[^/]*|[^/]*\.(?:min|built))\.m?js$/i;

export function requireFreshOutput(mirror, out) {
  if (!fs.statSync(mirror).isDirectory())
    throw new Error("Mirror must be a directory");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const source = fs.realpathSync(mirror);
  const destination = fs.existsSync(out)
    ? fs.realpathSync(out)
    : path.join(fs.realpathSync(path.dirname(out)), path.basename(out));
  const overlaps = (a, b) => b === a || b.startsWith(a + path.sep);
  if (overlaps(source, destination) || overlaps(destination, source))
    throw new Error("Mirror and output directories overlap");
  if (
    fs.existsSync(out) &&
    (fs.lstatSync(out).isSymbolicLink() || fs.readdirSync(out).length)
  ) {
    throw new Error(
      "Existing native output was preserved. Use a fresh directory or resume from its completed stage.",
    );
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, ".stage1-in-progress"), "", { flag: "wx" });
}

function files(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) => {
      const full = path.join(dir, e.name);
      if ([".git", "node_modules"].includes(e.name) || e.isSymbolicLink())
        return [];
      return e.isDirectory() ? files(full) : e.isFile() ? [full] : [];
    });
}

function reportedPath(source, root) {
  // Keep the map's spelling separately. Map URLs and traversal prefixes are virtual roots.
  let name = source.replace(/\\/g, "/");
  if (root && !/^(?:[a-z][\w+.-]*:|\/)/i.test(name))
    name = root.replace(/\/$/, "") + "/" + name;
  name = name.replace(/^[a-z][\w+.-]*:\/\/[^/]*\//i, "").replace(/[?#].*$/, "");
  return path.posix.normalize("/" + name).slice(1);
}

function recoverMaps(mirror, out) {
  const index = path.join(mirror, "forensics", "source-maps.json");
  const maps = fs.existsSync(index)
    ? JSON.parse(fs.readFileSync(index)).maps
    : files(path.join(mirror, "__sourcemaps__"))
        .filter((f) => f.endsWith(".map"))
        .map((f) => ({ file: path.relative(mirror, f) }));
  const entries = [];
  const root = path.join(out, "recovered-source");
  if (fs.existsSync(root))
    throw new Error(
      "Public path conflicts with reserved recovered-source directory",
    );
  for (const meta of maps) {
    const absolute = path.resolve(mirror, meta.file);
    if (!absolute.startsWith(path.join(mirror, "__sourcemaps__") + path.sep))
      throw new Error("Invalid captured map path");
    const content = fs.readFileSync(absolute);
    if (meta.sha256 && hash(content) !== meta.sha256)
      throw new Error("Captured map hash mismatch: " + meta.file);
    const base = {
      map: meta.file,
      mapUrl: meta.mapUrl ?? null,
      scriptUrl: meta.scriptUrl ?? null,
      firstParty: meta.firstParty ?? null,
    };
    function visit(map, section) {
      if (Array.isArray(map.sections)) {
        map.sections.forEach((s, i) =>
          s.map
            ? visit(s.map, [...section, i])
            : entries.push({
                ...base,
                section: [...section, i],
                status: "unresolved",
                reason: "External map section",
                url: s.url,
              }),
        );
        return;
      }
      if (!Array.isArray(map.sources)) {
        entries.push({
          ...base,
          section,
          status: "unresolved",
          reason: "Missing sources",
        });
        return;
      }
      map.sources.forEach((source, i) => {
        const rec = {
          ...base,
          section,
          index: i,
          reportedPath: source,
          sourceRoot: map.sourceRoot || "",
        };
        const text = map.sourcesContent?.[i];
        const rel =
          typeof source === "string" && reportedPath(source, rec.sourceRoot);
        if (
          typeof text !== "string" ||
          !rel ||
          rel.includes("\0") ||
          rel.split("/").some((x) => /^\.(git|hg|svn)$/i.test(x))
        ) {
          entries.push({
            ...rec,
            status: "unresolved",
            reason: "Embedded content or usable source path unavailable",
          });
          return;
        }
        const sha256 = hash(text);
        let dest = path.join(root, rel);
        const conflicts = () => {
          let parent = path.dirname(dest);
          while (parent !== out) {
            if (fs.existsSync(parent) && !fs.statSync(parent).isDirectory())
              return true;
            parent = path.dirname(parent);
          }
          return (
            fs.existsSync(dest) &&
            (!fs.statSync(dest).isFile() ||
              hash(fs.readFileSync(dest)) !== sha256)
          );
        };
        if (conflicts())
          dest = path.join(out, "forensics", "source-variants", sha256, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest)) fs.writeFileSync(dest, text, { flag: "wx" });
        entries.push({
          ...rec,
          status: "embedded-source",
          outputPath: path.relative(out, dest),
          sha256,
        });
      });
    }
    let map;
    try {
      map = JSON.parse(content);
    } catch {
      entries.push({
        ...base,
        status: "unresolved",
        reason: "Invalid map JSON",
      });
      continue;
    }
    visit(map, []);
  }
  return entries;
}

export async function finishNative(mirror, out, mode, publicScripts = []) {
  const sources = recoverMaps(mirror, out);
  // Identical source bytes can run at the same public URL with exactly the same import base.
  const byHash = new Map();
  for (const entry of sources) {
    if (entry.status !== "embedded-source") continue;
    const group = byHash.get(entry.sha256) || [];
    group.push(entry);
    byHash.set(entry.sha256, group);
  }
  for (const script of publicScripts) {
    if (script.status !== "preserved-public") continue;
    const choices =
      byHash.get(hash(fs.readFileSync(path.join(out, script.path)))) || [];
    if (choices.length === 1) script.runtimeSource = choices[0].outputPath;
  }
  const serverDir = path.join(out, ".native-tools");
  fs.mkdirSync(serverDir);
  const assetFile = path.join(mirror, "forensics", "assets.json");
  if (fs.existsSync(assetFile)) {
    const assetIndex = new Map(
      JSON.parse(fs.readFileSync(assetFile)).assets.map((a) => [
        a.relPath,
        a.url,
      ]),
    );
    for (const script of publicScripts) {
      if (script.status !== "preserved-public" || script.runtimeSource)
        continue;
      const url = assetIndex.get(script.path);
      const mapped = sources.filter((s) => s.scriptUrl === url && url);
      if (mapped.length) {
        script.status = "unresolved";
        script.reason =
          "Generated script has a published map and requires a source build";
        fs.unlinkSync(path.join(out, script.path));
      }
    }
  }
  const rebuild = await linkMapped(mirror, out, sources, publicScripts);
  const bundled = publicScripts.filter((s) => s.status === "unresolved");
  const modulesFile = path.join(out, "forensics", "module-outcomes.json");
  const modules = fs.existsSync(modulesFile)
    ? JSON.parse(fs.readFileSync(modulesFile)).modules
    : [];
  const runtimeStatus = rebuild
    ? "source-built-runtime"
    : mode === "B" && !bundled.length
      ? "static-route-runtime"
      : "requires-runtime-reconstruction";
  const report = {
    version: 1,
    mode,
    runtimeStatus,
    rebuild,
    sources,
    publicScripts,
    modules,
  };
  const dir = path.join(out, "forensics");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "source-recovery.json"),
    JSON.stringify(report, null, 2),
  );
  fs.copyFileSync(
    new URL("../../shared/replay-index.mjs", import.meta.url),
    path.join(serverDir, "replay-index.mjs"),
  );
  fs.copyFileSync(
    new URL("./serve-native.mjs", import.meta.url),
    path.join(serverDir, "serve-native.mjs"),
  );
  const pkgFile = path.join(out, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile));
  if (rebuild) {
    pkg.devDependencies = { ...pkg.devDependencies, esbuild: rebuild.version };
    pkg.scripts.build = "node .native-tools/build-mapped.mjs";
  }
  pkg.scripts.dev = pkg.scripts.start =
    "node .native-tools/serve-native.mjs --dir .";
  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  fs.unlinkSync(path.join(out, ".stage1-in-progress"));
  return report;
}

export function preservePublicScripts(mirror, out) {
  const scripts = [];
  for (const file of files(mirror)) {
    const rel = path.relative(mirror, file);
    if (
      !/\.m?js$/i.test(rel) ||
      /^(?:forensics|__sourcemaps__|__api_fixtures__)\//.test(rel)
    )
      continue;
    const content = fs.readFileSync(file);
    if (
      bundlePath.test(rel) ||
      /(?:self|globalThis|window)\.(?:webpackChunk\w*|TURBOPACK)\s*[=(.]/.test(
        content.toString("utf8"),
      )
    ) {
      scripts.push({
        path: rel,
        status: "unresolved",
        reason: "Compiled bundle requires a reconstructed runtime entry",
      });
    } else {
      const dest = path.join(out, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
      scripts.push({ path: rel, status: "preserved-public" });
    }
  }
  return scripts;
}
