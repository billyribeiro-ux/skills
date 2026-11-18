import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { continueNative } from "../scripts/continue-native.mjs";

const vault = fileURLToPath(new URL("../../", import.meta.url));
const capture = path.join(vault, "har-ground-truth-mirror/scripts");
const native = path.join(vault, "native-stack-decompiler/scripts");
const html =
  '<!doctype html><html><head><title>Fixture</title></head><body><main><button id="tag">Open</button></main><script type="module" src="/bundle.min.js"></script></body></html>';

function run(script, args, expected = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === expected
        ? resolve()
        : reject(new Error(script + " returned " + code)),
    );
  });
}

async function start(t, script, dir) {
  // Use an ephemeral local port with both the copied and installed native servers.
  const probe = http.createServer();
  await new Promise((ok, fail) => {
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", ok);
  });
  const port = probe.address().port;
  await new Promise((ok) => probe.close(ok));
  const proc = spawn(
    process.execPath,
    [script, "--dir", dir, "--port", String(port)],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  t.after(() => proc.kill());
  await new Promise((ok, fail) => {
    proc.stdout.once("data", ok);
    proc.once("error", fail);
    proc.once("exit", () => fail(new Error("Server exited")));
  });
  return "http://127.0.0.1:" + port;
}

test("partial native output continues with explicitly authored runtime, preserving evidence and parity gates", async (t) => {
  const temp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "authored-repair-")),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const mirrorDir = path.join(temp, "mirror"),
    nativeDir = path.join(temp, "partial"),
    outDir = path.join(temp, "candidate"),
    authoredDir = path.join(temp, "authored");
  const server = http.createServer((req, res) => {
    if (req.url === "/")
      return res.writeHead(200, { "Content-Type": "text/html" }).end(html);
    if (req.url === "/bundle.min.js")
      return res
        .writeHead(200, { "Content-Type": "text/javascript" })
        .end(
          'document.getElementById("tag").onclick=e=>e.currentTarget.textContent="Wired";',
        );
    return res.writeHead(204).end();
  });
  await new Promise((ok, fail) => {
    server.on("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const live = "http://127.0.0.1:" + server.address().port;
  await run(path.join(capture, "capture-mirror.mjs"), [
    "--url",
    live,
    "--out-dir",
    mirrorDir,
    "--single-route",
  ]);
  const baseline = await start(
    t,
    path.join(capture, "serve-mirror.mjs"),
    mirrorDir,
  );
  await run(path.join(capture, "verify-stage0-mirror.mjs"), [
    "--live",
    live,
    "--local",
    baseline,
    "--mirror-dir",
    mirrorDir,
  ]);
  await run(
    path.join(native, "decompile-native.mjs"),
    ["--mirror-dir", mirrorDir, "--out-dir", nativeDir, "--mode", "B"],
    2,
  );
  fs.mkdirSync(authoredDir);
  fs.writeFileSync(
    path.join(authoredDir, "action.ts"),
    `import fragmentSource from './fragment.glsl';
const action = document.querySelector<HTMLButtonElement>('#tag');
if (action) action.onclick = () => {
  const context = document.createElement('canvas').getContext('webgl');
  const shader = context?.createShader(context.FRAGMENT_SHADER);
  if (!context || !shader) throw new Error('No shader context');
  context.shaderSource(shader, fragmentSource);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('Shader compile failed');
  context.deleteShader(shader);
  action.textContent = 'Wired';
};
`,
  );
  fs.writeFileSync(path.join(authoredDir, "fragment.glsl"), "precision mediump float; void main() { gl_FragColor = vec4(1.0); }\n");
  const manifest = path.join(temp, "plan.json");
  const plan = {
    version: 1,
    routes: [
      {
        route: "/",
        entry: "action.ts",
        sources: ["action.ts", "fragment.glsl"],
        evidence: ["forensics/interaction-contracts.json"],
        replaces: ["bundle.min.js"],
      },
    ],
  };
  fs.writeFileSync(manifest, JSON.stringify(plan));
  await continueNative({ mirrorDir, nativeDir, authoredDir, manifest, outDir });
  const original = JSON.parse(
    fs.readFileSync(path.join(nativeDir, "forensics/source-recovery.json")),
  );
  assert.equal(original.runtimeStatus, "requires-runtime-reconstruction");
  const after = JSON.parse(
    fs.readFileSync(path.join(outDir, "forensics/source-recovery.json")),
  );
  assert.equal(after.runtimeStatus, "reconstructed-runtime");
  assert.deepEqual(after.publicScripts, original.publicScripts);
  assert.equal(
    fs.existsSync(path.join(outDir, "forensics/stage1-cert.json")),
    false,
  );
  const local = await start(t, path.join(native, "serve-native.mjs"), outDir);
  const browser = await chromium.launch();
  try {
    for (const url of [baseline, local]) {
      const page = await browser.newPage();
      await page.goto(url);
      await page.getByRole("button", { name: "Open" }).click();
      assert.equal(await page.locator("#tag").textContent(), "Wired");
      await page.close();
    }
  } finally {
    await browser.close();
  }
  await run(path.join(native, "verify-stage1-native.mjs"), [
    "--mirror-dir",
    mirrorDir,
    "--native-dir",
    outDir,
    "--mirror",
    baseline,
    "--native",
    local,
  ]);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(outDir, "forensics/stage1-cert.json")))
      .passed,
    true,
  );
});
