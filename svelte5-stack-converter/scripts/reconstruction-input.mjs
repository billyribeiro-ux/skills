import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { verifyReconstruction } from "../../native-stack-decompiler/scripts/continue-native.mjs";
import { assertStageCertified } from "../../shared/pipeline-gate.mjs";

const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const identicalSet = (a, b) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  a.every((x) => b.includes(x));
export function reconstructedAssetPath(file) {
  if (
    !file.startsWith(".native-build/") ||
    path.posix.normalize(file) !== file ||
    !file.endsWith(".js")
  )
    throw Error("Invalid reconstructed JavaScript output: " + file);
  return "assets/reconstructed/" + file.slice(".native-build/".length);
}

export function verifiedReconstructions({
  source,
  mirror,
  nativeCert,
  recovery,
  routes,
  put,
}) {
  if (recovery.runtimeStatus !== "reconstructed-runtime") return [];
  const mirrorCert = assertStageCertified({
    requiredStage: 0,
    dir: mirror,
    callerName: "reconstructed Svelte input",
  });
  const rec = recovery.reconstruction;
  if (
    rec?.identity !== "reconstructed" ||
    !identicalSet(
      routes.map((r) => r.route),
      rec.routes.map((r) => r.route),
    ) ||
    !identicalSet(nativeCert.routes, mirrorCert.routes) ||
    !(nativeCert.summary?.metricsCount > 0)
  )
    throw Error(
      "Reconstructed source requires verified native measurements and complete route provenance.",
    );
  verifyReconstruction(
    fs.realpathSync(source),
    fs.realpathSync(mirror),
    recovery,
    mirrorCert,
  );
  const jobs = JSON.parse(
    fs.readFileSync(path.join(source, ".native-tools/entries.json"), "utf8"),
  );
  const outputs = new Map();
  const shaRead = (root, file) => {
    if (
      path.isAbsolute(file) ||
      path.normalize(file) !== file ||
      file.startsWith("../")
    )
      throw Error("Invalid native evidence path " + file);
    const resolved = fs.realpathSync(path.join(root, file));
    if (!resolved.startsWith(fs.realpathSync(root) + path.sep))
      throw Error("Source escapes certified tree: " + file);
    return fs.readFileSync(resolved);
  };
  const records = rec.routes.map((row) => {
    const job = jobs.find(
      (j) => j.entry === row.entry && j.output === row.output,
    );
    if (
      !job ||
      !identicalSet(job.sources, row.sources) ||
      !job.sources.includes(job.entry) ||
      !job.sources.every((f) => f.startsWith("src/reconstructed/")) ||
      !row.evidence?.length ||
      !row.outputs?.length ||
      !row.outputs.some((o) => o.file === job.output)
    )
      throw Error("Reconstruction graph or evidence missing for " + row.route);
    for (const file of job.sources) put(file, shaRead(source, file));
    for (const item of row.outputs) {
      const dest = reconstructedAssetPath(item.file);
      const hash = digest(shaRead(source, item.file));
      if (outputs.has(dest) && outputs.get(dest) !== hash)
        throw Error("Conflicting reconstruction output " + dest);
      outputs.set(dest, hash);
    }
    return {
      route: row.route,
      job: { ...job, output: "static/" + reconstructedAssetPath(job.output) },
      nativeOutput: job.output,
      evidence: row.evidence,
      src: job.sources,
      outputs: row.outputs,
    };
  });
  if (
    !jobs.every((j) =>
      records.some(
        (r) => r.job.entry === j.entry && r.nativeOutput === j.output,
      ),
    )
  )
    throw Error("Unaccounted reconstructed entry");
  put(
    "forensics/reconstruction-provenance.json",
    JSON.stringify(
      {
        identity: "reconstructed",
        mirrorDigest: mirrorCert.digest,
        nativeDigest: nativeCert.digest,
        routes: records.map(({ route, job, nativeOutput, evidence, src }) => ({
          route,
          nativeOutput,
          svelteOutput: job.output,
          sources: src,
          evidence,
        })),
        sha256ByPublicPath: Object.fromEntries(outputs),
      },
      null,
      2,
    ),
  );
  return records;
}
