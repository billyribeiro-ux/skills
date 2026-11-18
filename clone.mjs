#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { computeStageDigest } from "./shared/pipeline-gate.mjs";

const usage =
  "node clone.mjs URL [--output DIRECTORY] [--resume] [--base-port 3010]";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string" },
    resume: { type: "boolean" },
    "base-port": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(usage);
  process.exit(0);
}
if (positionals.length !== 1 || (values.resume && !values.output))
  throw new Error(usage);
const site = new URL(positionals[0]);
if (
  !["https:", "http:"].includes(site.protocol) ||
  site.username ||
  site.password
)
  throw new Error("Supply an HTTP(S) site URL without embedded credentials.");
const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(
  values.output ??
    path.join(
      "clones",
      site.hostname,
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);
const names = ["00-mirror", "01-native", "02-svelte5"];
const dirs = names.map((name) => path.join(out, name));
const skills = [
  "har-ground-truth-mirror",
  "native-stack-decompiler",
  "svelte5-stack-converter",
];
const script = (stage, name) =>
  path.join(root, skills[stage], "scripts", name + ".mjs");
const basePort = Number(values["base-port"] ?? 3010);
if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65533)
  throw new Error("Base port must be 1–65533.");
const urls = names.map((_, i) => "http://127.0.0.1:" + (basePort + i));
if ([root, ...skills.map((name) => path.join(root, name))].includes(out))
  throw new Error("Output must be a separate run directory.");
const statePath = path.join(out, "run.json");
const lock = path.join(out, ".clone.lock");
const children = new Set();
const logs = path.join(out, "logs");

function workflowVersion() {
  const hash = crypto.createHash("sha256");
  function visit(dir) {
    for (const item of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", ".DS_Store", "clones", ".git"].includes(item.name))
        continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      if (item.isFile())
        hash
          .update(path.relative(root, file))
          .update("\0")
          .update(fs.readFileSync(file))
          .update("\0");
    }
  }
  visit(root);
  return hash.digest("hex");
}
function writeState() {
  fs.writeFileSync(statePath + ".tmp", JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(statePath + ".tmp", statePath);
}
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}
function start(label, command, args, cwd = out) {
  const file = path.join(logs, label + ".log");
  const fd = fs.openSync(file, "a");
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      stdio: ["ignore", fd, fd],
      detached: true,
      env: { ...process.env, CI: "true" },
    });
  } finally {
    fs.closeSync(fd);
  }
  children.add(child);
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      children.delete(child);
      if (code === 0) resolve();
      else
        reject(
          new Error(label + " failed (" + (signal ?? code) + "). See " + file),
        );
    });
  });
  done.catch(() => {});
  return { child, done };
}
async function step(label, command, args, cwd) {
  console.log(label);
  const task = { label, started: new Date().toISOString() };
  state.steps.push(task);
  writeState();
  const t = performance.now();
  state.currentStep = label;
  try {
    await start(label, command, args, cwd).done;
    task.status = "passed";
  } catch (e) {
    task.status = "failed";
    throw e;
  } finally {
    task.elapsedMs = Math.round(performance.now() - t);
    writeState();
  }
}
async function server(stage, command, args, cwd) {
  const port = basePort + stage;
  const probe = net.createServer();
  await new Promise((ok, no) => {
    probe.once("error", no);
    probe.listen(port, "127.0.0.1", () => probe.close(ok));
  });
  const { done } = start("serve-" + stage, command, args, cwd);
  const ended = done.then(() => {
    throw new Error("Server ended before it was ready");
  });
  for (let n = 0; n < 160; n++) {
    await Promise.race([ended, delay(125)]);
    try {
      const res = await fetch(urls[stage], {
        signal: AbortSignal.timeout(900),
      });
      await res.body?.cancel();
      return;
    } catch {}
  }
  throw new Error("Server did not answer at " + urls[stage]);
}
function certificate(stage) {
  const p = path.join(dirs[stage], "forensics", "stage" + stage + "-cert.json");
  if (!fs.existsSync(p)) return false;
  const cert = JSON.parse(fs.readFileSync(p));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dirs[0], "forensics", "routes-manifest.json")),
  );
  const expected = new Set(
    manifest.routes.map((r) => (typeof r === "string" ? r : r.route)),
  );
  const actual = new Set(cert.routes);
  return (
    cert.stage === stage &&
    cert.passed === true &&
    expected.size > 0 &&
    expected.size === actual.size &&
    [...expected].every((x) => actual.has(x)) &&
    cert.digest === computeStageDigest(stage, dirs[stage])?.digest
  );
}
function archive(stage) {
  if (!fs.existsSync(dirs[stage])) return;
  const dest = path.join(out, "attempts", crypto.randomUUID());
  fs.mkdirSync(dest, { recursive: true });
  const prior = path.join(dest, names[stage]);
  fs.renameSync(dirs[stage], prior);
  return prior;
}
const node = process.execPath;
const execStage = (stage, label, file, args) =>
  step(label, node, [script(stage, file), ...args]);
async function run() {
  const reusable = [];
  for (let i = 0; i < 3; i++)
    reusable[i] = Boolean(
      values.resume &&
      (i === 0 || reusable[i - 1]) &&
      state.certified.includes(i) &&
      certificate(i),
    );
  const authored = path.join(out, "repair", "source");
  const repairPlan = path.join(out, "repair", "plan.json");
  const wantsRepair = reusable[0] && !reusable[1] && fs.existsSync(repairPlan);
  state.certified = state.certified.filter((i) => reusable[i]);
  if (reusable.every(Boolean)) return;
  for (let i = 0; i < 3; i++) {
    if (!reusable[i] && !(wantsRepair && i === 1)) archive(i);
  }
  if (!reusable[0])
    await execStage(0, "capture", "capture-mirror", [
      "--url",
      site.href,
      "--out-dir",
      dirs[0],
    ]);
  await server(0, node, [
    script(0, "serve-mirror"),
    "--dir",
    dirs[0],
    "--port",
    String(basePort),
  ]);
  if (!reusable[0]) {
    await execStage(0, "verify-mirror", "verify-stage0-mirror", [
      "--live",
      site.origin,
      "--local",
      urls[0],
      "--mirror-dir",
      dirs[0],
    ]);
    certify(0);
  }
  if (wantsRepair) {
    const prior = JSON.parse(
      fs.readFileSync(path.join(dirs[1], "forensics/source-recovery.json")),
    );
    const partial =
      prior.runtimeStatus === "requires-runtime-reconstruction"
        ? dirs[1]
        : state.partialNative;
    if (!partial || !fs.existsSync(partial))
      throw new Error("Original partial native output is missing.");
    const candidate = path.join(out, ".candidate-" + crypto.randomUUID());
    await execStage(1, "compile-reconstruction", "continue-native", [
      "--mirror-dir",
      dirs[0],
      "--native-dir",
      partial,
      "--authored-dir",
      authored,
      "--manifest",
      repairPlan,
      "--out-dir",
      candidate,
    ]);
    const archived = archive(1);
    if (partial === dirs[1]) state.partialNative = archived;
    try {
      fs.renameSync(candidate, dirs[1]);
    } catch (error) {
      fs.renameSync(archived, dirs[1]);
      throw error;
    }
    writeState();
  } else if (!reusable[1])
    await execStage(1, "decode", "decompile-native", [
      "--mirror-dir",
      dirs[0],
      "--out-dir",
      dirs[1],
    ]);
  await server(1, node, [
    script(1, "serve-native"),
    "--dir",
    dirs[1],
    "--port",
    String(basePort + 1),
  ]);
  if (!reusable[1]) {
    await execStage(1, "verify-native", "verify-stage1-native", [
      "--mirror",
      urls[0],
      "--native",
      urls[1],
      "--mirror-dir",
      dirs[0],
      "--native-dir",
      dirs[1],
    ]);
    certify(1);
  }
  const source = ["--source", dirs[1], "--target", dirs[2]];
  await execStage(2, "scaffold", "scaffold-sveltekit3", [
    ...source,
    "--mirror-dir",
    dirs[0],
    "--port",
    String(basePort + 2),
  ]);
  await execStage(2, "plan", "plan-svelte5-batches", [
    "--source",
    dirs[1],
    "--out",
    path.join(dirs[2], "conversion-batches.json"),
  ]);
  await execStage(2, "convert", "preconvert-jsx-markup", [...source, "--all"]);
  await execStage(2, "assemble", "assemble-svelte-routes", source);
  await step(
    "install",
    "pnpm",
    [
      "install",
      "--ignore-workspace",
      "--prefer-offline",
      "--no-frozen-lockfile",
    ],
    dirs[2],
  );
  await execStage(2, "verify-svelte", "verify-stage2-svelte5", [
    "--launch-preview",
    "--mirror-dir",
    dirs[0],
    "--mirror-url",
    urls[0],
    "--native-dir",
    dirs[1],
    "--native-url",
    urls[1],
    "--svelte-dir",
    dirs[2],
    "--svelte-url",
    urls[2],
  ]);
  certify(2);
}
function certify(i) {
  if (!certificate(i))
    throw new Error("Missing, incomplete or stale certificate for " + names[i]);
  state.certified.push(i);
  writeState();
}
const version = workflowVersion();
fs.mkdirSync(out, { recursive: true });
if (!values.resume && fs.readdirSync(out).length)
  throw new Error("Choose an empty output or use --resume on a previous run.");
const state = values.resume
  ? JSON.parse(fs.readFileSync(statePath))
  : { url: site.href, workflow: version, certified: [], steps: [] };
if (state.url !== site.href || state.workflow !== version)
  throw new Error(
    "This run belongs to a different URL or workflow revision. Choose a fresh output directory.",
  );
fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
for (const [s, code] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
])
  process.once(s, () => {
    for (const child of children) stopChild(child);
    state.status = "interrupted";
    writeState();
    fs.unlinkSync(lock);
    process.exit(code);
  });
try {
  fs.mkdirSync(logs, { recursive: true });
  state.status = "running";
  delete state.error;
  writeState();
  console.log("Run directory: " + out);
  await run();
  const ledger = JSON.parse(
    fs.readFileSync(path.join(dirs[1], "forensics/source-recovery.json")),
  );
  const finalCert = JSON.parse(
    fs.readFileSync(path.join(dirs[2], "forensics/stage2-cert.json")),
  );
  state.result = {
    verifiedRoutes: finalCert.routes,
    nativeRuntime: ledger.runtimeStatus,
    mappedSourceRecords: ledger.sources?.length ?? 0,
    recoveredEmbeddedFiles: new Set(
      (ledger.sources ?? [])
        .filter((s) => s.status === "embedded-source")
        .map((s) => s.outputPath),
    ).size,
    evidence: path.join(names[1], "forensics/source-recovery.json"),
    outputs: names,
  };
  state.status = "passed";
  console.log("Verified all three stages: " + out);
} catch (e) {
  state.status = "failed";
  state.error = e.message;
  console.error(e.message);
  process.exitCode = 1;
} finally {
  for (const child of children) stopChild(child);
  writeState();
  fs.unlinkSync(lock);
}
