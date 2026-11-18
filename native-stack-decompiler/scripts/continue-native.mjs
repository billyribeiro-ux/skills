#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  assertStageCertified,
  manifestRoutes,
} from "../../shared/pipeline-gate.mjs";
import { buildEntry } from "./build-mapped.mjs";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const prefix = "src/reconstructed/";
const ledgerName = "forensics/source-recovery.json";

function existingFile(root, file) {
  if (
    typeof file !== "string" ||
    !file ||
    path.isAbsolute(file) ||
    path.normalize(file) !== file ||
    file.startsWith("../") ||
    file.includes("\\")
  )
    throw new Error("Expected relative file path: " + file);
  const absolute = path.join(root, file);
  if (
    fs.realpathSync(absolute) !== absolute ||
    !fs.statSync(absolute).isFile()
  ) {
    throw new Error("Expected a regular file without symlinks: " + file);
  }
  return absolute;
}

function evidenceRecord(root, file) {
  return { file, sha256: hash(fs.readFileSync(existingFile(root, file))) };
}

function sameRoutes(actual, expected) {
  if (
    actual.length !== expected.length ||
    !expected.every((route) => actual.includes(route))
  ) {
    throw new Error(
      "Reconstruction must account for every captured route exactly once.",
    );
  }
}

export function verifyReconstruction(native, mirror, report, mirrorCert) {
  const records = report.reconstruction?.routes;
  if (
    report.reconstruction?.identity !== "reconstructed" ||
    !Array.isArray(records) ||
    report.reconstruction.mirrorDigest !== mirrorCert.digest
  )
    throw new Error("Reconstruction evidence differs from certified mirror.");
  sameRoutes(
    records.map((r) => r.route),
    manifestRoutes(mirror),
  );
  const previous = read(
    existingFile(
      native,
      "forensics/source-recovery.before-reconstruction.json",
    ),
  );
  for (const key of ["sources", "publicScripts", "modules"]) {
    if (JSON.stringify(report[key]) !== JSON.stringify(previous[key]))
      throw new Error("Original recovery ledger changed: " + key);
  }
  for (const record of records) {
    if (
      !record.evidence.length ||
      !record.sources.includes(record.entry) ||
      !record.outputs.some((o) => o.file === record.output)
    ) {
      throw new Error("Incomplete route evidence: " + record.route);
    }
    for (const [root, checks] of [
      [mirror, record.evidence],
      [native, record.authoredFiles],
      [native, record.outputs],
    ]) {
      for (const item of checks) {
        if (item.sha256 !== evidenceRecord(root, item.file).sha256)
          throw new Error("Evidence changed: " + item.file);
      }
    }
    const html = fs.readFileSync(
      existingFile(native, record.documentFile),
      "utf8",
    );
    if (
      !html.includes(
        '<script type="module" src="/' + record.output + '"></script>',
      )
    )
      throw new Error("Reconstructed entry is unmounted: " + record.route);
  }
}

export async function continueNative({
  mirrorDir,
  nativeDir,
  authoredDir,
  manifest,
  outDir,
}) {
  const mirror = fs.realpathSync(mirrorDir);
  const partial = fs.realpathSync(nativeDir);
  const authored = fs.realpathSync(authoredDir);
  const out = path.join(
    fs.realpathSync(path.dirname(path.resolve(outDir))),
    path.basename(outDir),
  );
  const roots = [mirror, partial, authored, out];
  for (const root of roots) {
    if (
      roots.some((other) => root.startsWith(other + path.sep)) ||
      new Set(roots).size !== roots.length
    )
      throw new Error("Use separate input and output directories.");
  }
  const cert = assertStageCertified({
    requiredStage: 0,
    dir: mirror,
    callerName: "continue-native",
  });
  const report = read(existingFile(partial, ledgerName));
  if (report.runtimeStatus !== "requires-runtime-reconstruction")
    throw new Error("Expected a partial Stage 1 project.");
  const plan = read(manifest);
  if (plan.version !== 1 || !Array.isArray(plan.routes))
    throw new Error("Invalid reconstruction manifest.");
  const expected = manifestRoutes(mirror);
  sameRoutes(
    plan.routes.map((r) => r.route),
    expected,
  );
  sameRoutes(manifestRoutes(partial), expected);
  const original = read(existingFile(mirror, "forensics/routes-manifest.json"));
  const documents = new Map(
    original.routes.map((r) =>
      typeof r === "string" ? [r, {}] : [r.route, r],
    ),
  );
  const assets = read(existingFile(mirror, "forensics/assets.json")).assets;
  const unresolved = new Set(
    report.publicScripts
      .filter((script) => script.status === "unresolved")
      .map((s) => s.path),
  );
  const blockedBytes = new Set(
    assets
      .filter((a) => unresolved.has(a.relPath))
      .map((a) => a.sha256 || evidenceRecord(mirror, a.relPath).sha256),
  );
  const mounted = new Set();
  const records = [];
  const jobs = [];
  const compiler = createRequire(import.meta.url)(
    "esbuild/package.json",
  ).version;
  fs.mkdirSync(out); // Exclusive creation keeps the partial project and previous repairs intact.
  try {
    fs.cpSync(partial, out, {
      recursive: true,
      filter(file) {
        if (["node_modules", ".git"].includes(path.basename(file)))
          return false;
        if (fs.lstatSync(file).isSymbolicLink())
          throw new Error("Unexpected symlink in partial project: " + file);
        return true;
      },
    });
    if (
      fs.existsSync(path.join(out, prefix)) ||
      fs.existsSync(path.join(out, ".native-build")) ||
      fs.existsSync(path.join(out, "forensics/stage1-cert.json"))
    )
      throw new Error("Candidate already contains runtime or certificate.");
    fs.copyFileSync(
      path.join(out, ledgerName),
      path.join(out, "forensics/source-recovery.before-reconstruction.json"),
      fs.constants.COPYFILE_EXCL,
    );
    for (const config of plan.routes) {
      const { route, entry, sources, evidence } = config;
      if (
        !Array.isArray(sources) ||
        !sources.includes(entry) ||
        new Set(sources).size !== sources.length ||
        !Array.isArray(evidence) ||
        !evidence.length
      )
        throw new Error("Missing source closure or evidence for " + route);
      const references = evidence.map((file) => {
        if (!file.startsWith("forensics/"))
          throw new Error("Reference captured forensic evidence: " + file);
        return evidenceRecord(mirror, file);
      });
      const authoredFiles = [];
      for (const file of sources) {
        if (!/\.(?:[cm]?jsx?|tsx?|glsl|vert|frag)$/.test(file))
          throw new Error("Unsupported authored source: " + file);
        const content = fs.readFileSync(existingFile(authored, file));
        const digest = hash(content);
        if (blockedBytes.has(digest))
          throw new Error(
            "Authored input duplicates an unresolved captured bundle: " + file,
          );
        const rel = prefix + file;
        const dest = path.join(out, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (!fs.existsSync(dest))
          fs.writeFileSync(dest, content, { flag: "wx" });
        else if (hash(fs.readFileSync(dest)) !== digest)
          throw new Error("Conflicting shared source: " + rel);
        authoredFiles.push({ file: rel, sha256: digest });
      }
      const job = {
        entry: prefix + entry,
        sources: sources.map((f) => prefix + f),
        output: ".native-build/route-" + hash(route).slice(0, 20) + ".js",
        splitting: true,
      };
      const outputs = await buildEntry(out, job);
      const documentFile =
        documents.get(route).documentFile ||
        path.join(
          new URL(route, original.targetOrigin).pathname.slice(1),
          "index.html",
        );
      const doc = existingFile(out, documentFile);
      if (mounted.has(doc))
        throw new Error("Multiple captured routes share one native document.");
      mounted.add(doc);
      const scriptURL = (script) =>
        new URL(script, new URL(route, original.targetOrigin)).href;
      const replace = new Set(config.replaces || []);
      if ([...replace].some((file) => !unresolved.has(file)))
        throw new Error(
          "Only unresolved captured script paths can be replaced.",
        );
      const urls = new Set(
        assets.filter((a) => replace.has(a.relPath)).map((a) => a.url),
      );
      // Remove only explicitly replaced external script tags. Retain all other page content.
      const html = fs
        .readFileSync(doc, "utf8")
        .replace(
          /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>\s*<\/script\s*>/gi,
          (tag, _quote, src) =>
            urls.has(scriptURL(src.replaceAll("&amp;", "&"))) ? "" : tag,
        );
      if (!/<\/body\s*>/i.test(html))
        throw new Error("Missing closing body on " + route);
      fs.writeFileSync(
        doc,
        html.replace(
          /<\/body\s*>/i,
          '<script type="module" src="/' + job.output + '"></script>\n</body>',
        ),
      );
      jobs.push(job);
      records.push({
        route,
        documentFile,
        ...job,
        authoredFiles,
        evidence: references,
        replaces: [...replace],
        outputs: outputs.map((item) => ({
          ...item,
          sha256: evidenceRecord(out, item.file).sha256,
        })),
      });
    }
    const tools = path.join(out, ".native-tools");
    fs.mkdirSync(tools, { recursive: true });
    fs.copyFileSync(
      new URL("./build-mapped.mjs", import.meta.url),
      path.join(tools, "build-mapped.mjs"),
    );
    write(path.join(tools, "entries.json"), jobs);
    const pkg = read(path.join(out, "package.json"));
    pkg.devDependencies = { ...pkg.devDependencies, esbuild: compiler };
    pkg.scripts = {
      ...pkg.scripts,
      build: "node .native-tools/build-mapped.mjs",
    };
    write(path.join(out, "package.json"), pkg);
    report.runtimeStatus = "reconstructed-runtime";
    report.reconstruction = {
      identity: "reconstructed",
      mirrorDigest: cert.digest,
      compiler,
      routes: records,
    };
    verifyReconstruction(out, mirror, report, cert);
    write(path.join(out, ledgerName), report);
  } catch (error) {
    fs.rmSync(out, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options = Object.fromEntries(
    ["mirror-dir", "native-dir", "authored-dir", "manifest", "out-dir"].map(
      (key) => [key, { type: "string" }],
    ),
  );
  const { values } = parseArgs({ options });
  if (Object.keys(options).some((key) => !values[key]))
    throw new Error(
      "Required: --mirror-dir --native-dir --authored-dir --manifest --out-dir",
    );
  await continueNative({
    mirrorDir: values["mirror-dir"],
    nativeDir: values["native-dir"],
    authoredDir: values["authored-dir"],
    manifest: values.manifest,
    outDir: values["out-dir"],
  });
  console.log(
    "Reconstructed native candidate is ready for Stage 1 verification:",
    values["out-dir"],
  );
}
