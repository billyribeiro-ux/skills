import {
  mappedWebglInputs,
  assertWebglMotion,
} from "../../native-stack-decompiler/tests/fixtures/mapped-webgl.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mintStageCert } from "../../shared/pipeline-gate.mjs";
import { buildEntry } from "../../native-stack-decompiler/scripts/build-mapped.mjs";

const toolchain =
  process.env.SVELTE_FIXTURE_NODE_MODULES ??
  fileURLToPath(new URL("./toolchain/node_modules", import.meta.url));
const hasToolchain = fs.existsSync(toolchain);
test("nested components, state setters, relative imports and index modules survive batching", (t) => {
  const fixture = workspace(t);
  fixture.write(
    "01-native/src/account/Card.tsx",
    'import {useState} from "react"; import {format} from "./index.js"; export default function Card(){const [value,setValue]=useState(1);return <button onClick={()=>setValue(v=>v+1)}>{format(value)}</button>}',
  );
  fixture.write(
    "01-native/src/shop/Card.tsx",
    "export default function Card(){return <p>Shop</p>}",
  );
  fixture.write(
    "01-native/src/account/index.js",
    "export const format = String;",
  );
  fixture.certify();
  fixture.run(
    "plan-svelte5-batches",
    "--source",
    fixture.source,
    "--out",
    path.join(fixture.target, "conversion-batches.json"),
  );
  fixture.run(
    "preconvert-jsx-markup",
    "--source",
    fixture.source,
    "--target",
    fixture.target,
    "--batch",
    "1",
  );
  const card = fixture.read("02-svelte5/src/lib/account/Card.svelte");
  assert.match(card, /function setValue\(/);
  assert.match(card, /import \{ format \} from ['"].\/index.js['"]/);
  assert.match(
    fixture.read("02-svelte5/src/lib/shop/Card.svelte"),
    /<p>Shop<\/p>/,
  );
  assert.match(
    fixture.read("02-svelte5/src/lib/account/index.js"),
    /export const format/,
  );
});

test("static pages preserve local scripts, document attributes, independent hydration and route sections", (t) => {
  const fixture = workspace(t);
  fixture.write(
    "01-native/forensics/source-recovery.json",
    JSON.stringify({
      mode: "B",
      runtimeStatus: "static-route-runtime",
      publicScripts: [{ status: "preserved-public", path: "events.js" }],
    }),
  );
  fixture.write(
    "01-native/events.js",
    "document.querySelector('button').addEventListener('click',()=>document.body.classList.toggle('open'));",
  );
  fixture.write("01-native/forensics/note.json", '{"note":"SplitText"}');
  fixture.pages('<script src="/events.js" defer></script>');
  fixture.certify();
  fixture.assemble();
  assert.match(
    fixture.read("02-svelte5/src/routes/+layout.server.ts"),
    /csr = true/,
  );
  assert.match(
    fixture.read("02-svelte5/src/lib/pages/shop/Details.svelte"),
    /<button>Shop<\/button>/,
  );
  assert.match(
    fixture.read("02-svelte5/src/routes/shop/+page.svelte"),
    /import Details/,
  );
  assert.deepEqual(
    fixture.read("02-svelte5/static/events.js"),
    fixture.read("01-native/events.js"),
  );
  assert.doesNotMatch(
    fixture.read("02-svelte5/src/app.html"),
    /name="viewport"/,
  );
  const shells = JSON.parse(
    fixture.read("02-svelte5/src/lib/data/document-shells.json"),
  );
  assert.match(shells["/shop"].body, /class="store"/);
});

test("self-contained mapped browser controllers rebuild from portable original sources", async (t) => {
  const fixture = workspace(t);
  const file = "recovered-source/controllers/main.ts";
  const shader = "recovered-source/controllers/shaders/tint.frag";
  const driver = "recovered-source/controllers/motion/draw.ts";
  fixture.write(
    "01-native/" + file,
    "import {draw} from './motion/draw'; requestAnimationFrame(draw);",
  );
  fixture.write(
    "01-native/" + driver,
    "import shader from '../shaders/tint.frag'; export function draw(t:number){const gl=document.querySelector('canvas')!.getContext('webgl2')!; const fragment=gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fragment,shader); gl.compileShader(fragment); gl.clearColor(t / 1000, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);}",
  );
  fixture.write(
    "01-native/" + shader,
    "#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1.0);}",
  );
  const job = {
    entry: file,
    sources: [file, driver, shader],
    output: ".native-build/main.js",
  };
  await buildEntry(fixture.source, job);
  fixture.write("01-native/.native-tools/entries.json", JSON.stringify([job]));
  fixture.write(
    "01-native/forensics/source-recovery.json",
    JSON.stringify({
      mode: "A",
      runtimeStatus: "source-built-runtime",
      rebuild: { version: "0.25.0", entry: file },
      publicScripts: [
        { status: "rebuilt-from-source", entry: file, output: job.output },
      ],
    }),
  );
  fixture.pages('<script type="module" src="/.native-build/main.js"></script>');
  fixture.certify();
  fixture.assemble();
  assert.deepEqual(
    fixture.read("02-svelte5/static/assets/recovered-entry.js"),
    fixture.read("01-native/" + job.output),
  );
  for (const rel of job.sources)
    assert.deepEqual(
      fixture.read("02-svelte5/" + rel),
      fixture.read("01-native/" + rel),
    );
  let shaderText,
    red,
    clears = 0;
  const gl = {
    createShader: () => ({}),
    shaderSource: (_, text) => (shaderText = text),
    compileShader() {},
    clearColor: (r) => (red = r),
    clear: () => clears++,
  };
  vm.runInNewContext(
    fixture.read("02-svelte5/static/assets/recovered-entry.js"),
    {
      document: { querySelector: () => ({ getContext: () => gl }) },
      requestAnimationFrame: (fn) => fn(250),
    },
  );
  assert.equal(shaderText, fixture.read("01-native/" + shader));
  assert.equal(red, 0.25);
  assert.equal(clears, 1);
  assert.match(
    fixture.read("02-svelte5/src/routes/+page.svelte"),
    /assets\/recovered-entry.js/,
  );
});

test("a documented React root becomes a mounted Svelte component with local helpers and press motion", async (t) => {
  const fixture = workspace(t);
  const entry = "recovered-source/client.tsx",
    panel = "recovered-source/ui/Panel.tsx",
    format = "recovered-source/ui/format.ts";
  fixture.write(
    "01-native/" + entry,
    'import {createRoot} from "react-dom/client"; import Panel from "./ui/Panel"; createRoot(document.getElementById("details")).render(<Panel/>);',
  );
  fixture.write(
    "01-native/" + panel,
    'import {useState} from "react"; import {motion} from "framer-motion"; import {label} from "./format"; export default function Panel(){const [value,setValue]=useState(0);return <motion.button whileTap={{scale:0.8}} transition={{duration:0}} onClick={()=>setValue(v=>v+1)}>{label(value)}</motion.button>}',
  );
  fixture.write(
    "01-native/" + format,
    'export const label=(n:number) => "Value "+n;',
  );
  const job = {
    entry,
    sources: [entry, panel, format],
    output: ".native-build/main.js",
  };
  fixture.write("01-native/.native-tools/entries.json", JSON.stringify([job]));
  fixture.write(
    "01-native/forensics/source-recovery.json",
    JSON.stringify({
      mode: "A",
      runtimeStatus: "source-built-runtime",
      rebuild: { entry },
      publicScripts: [
        { status: "rebuilt-from-source", entry, output: job.output },
      ],
    }),
  );
  fixture.pages('<script type="module" src="/.native-build/main.js"></script>');
  fixture.certify();
  fixture.assemble();
  const page = fixture.read("02-svelte5/src/routes/+page.svelte");
  assert.match(page, /<section id="details"><RecoveredRoot \/><\/section>/);
  assert.doesNotMatch(page, /recovered-entry.js/);
  const converted = fixture.read(
    "02-svelte5/src/lib/recovered-source/ui/Panel.svelte",
  );
  assert.match(converted, /animateMotion/);
  assert.match(converted, /function setValue/);
  assert.doesNotMatch(converted, /react-dom|framer-motion/);
  await checkPreview(t, fixture, async (browserPage) => {
    const button = browserPage.getByRole("button", { name: "Value 0" });
    await button.hover();
    await browserPage.mouse.down();
    await browserPage.waitForFunction(() =>
      getComputedStyle(document.querySelector("button")).transform.startsWith(
        "matrix(0.8",
      ),
    );
    await browserPage.mouse.up();
    await browserPage.getByRole("button", { name: "Value 1" }).waitFor();
  });
});

test("a recovered dynamic import stays lazy in the Svelte production page", async (t) => {
  const f = workspace(t);
  const entry = "recovered-source/src/entry.ts",
    detail = "recovered-source/src/lazy/Detail.ts";
  f.write(
    "01-native/" + entry,
    `const btn=document.querySelector('button'); btn?.addEventListener('click',async()=>{const {reveal}=await import('./lazy/Detail');reveal(btn)});`,
  );
  f.write(
    "01-native/" + detail,
    `export function reveal(btn:HTMLButtonElement){btn.textContent='Details loaded'}`,
  );
  const job = {
    entry,
    sources: [entry, detail],
    output: ".native-build/main.js",
    splitting: true,
  };
  const outputs = await buildEntry(f.source, job);
  f.write("01-native/.native-tools/entries.json", JSON.stringify([job]));
  f.write(
    "01-native/forensics/source-recovery.json",
    JSON.stringify({
      mode: "A",
      runtimeStatus: "source-built-runtime",
      rebuild: { version: "0.25.0", entry, outputs },
      publicScripts: [
        { status: "rebuilt-from-source", entry, output: job.output },
        { status: "rebuilt-lazy-module", path: "old-detail.js" },
      ],
    }),
  );
  f.pages('<script type="module" src="/.native-build/main.js"></script>');
  f.certify();
  f.assemble();
  const lazy = outputs.find((o) => o.file.includes("/lazy/")).file;
  const base = path.basename(lazy);
  assert.deepEqual(
    f.read("02-svelte5/static/assets/lazy/" + base),
    f.read("01-native/" + lazy),
  );
  assert.match(
    f.read("02-svelte5/static/assets/recovered-entry.js"),
    /import\("\.\/lazy\//,
  );
  await checkPreview(t, f, async (page) => {
    const lazyRequests = () =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((url) => url.includes("/assets/lazy/")),
      );
    assert.deepEqual(await lazyRequests(), []);
    await page.getByRole("button", { name: "Home" }).click();
    await page.getByRole("button", { name: "Details loaded" }).waitFor();
    const loaded = await lazyRequests();
    assert.equal(loaded.length, 1);
    assert.equal(new URL(loaded[0]).pathname, "/assets/lazy/" + base);
  });
});

test("authored continuation requires matching measured native provenance, sources, route mount, and build bytes", async (t) => {
  const f = workspace(t);
  const evidence = "forensics/interaction-contracts.json";
  const trace = JSON.stringify({
    routes: { "/": { action: "click" }, "/shop": { action: "click" } },
  });
  const sha256 = crypto.createHash("sha256").update(trace).digest("hex");
  f.write("00-mirror/" + evidence, trace);
  f.write(
    "01-native/package.json",
    JSON.stringify({ type: "module", devDependencies: { esbuild: "0.25.0" } }),
  );
  const shader = "src/reconstructed/label.glsl";
  f.write("01-native/" + shader, "true");
  const entry = "src/reconstructed/controls.ts",
    output = ".native-build/disclosure.js";
  f.write(
    "01-native/" + entry,
    "import label from './label.glsl'; document.querySelector('button')?.addEventListener('click',e=>{(e.currentTarget as HTMLButtonElement).setAttribute('aria-expanded',label.trim())})",
  );
  const job = { entry, output, sources: [entry, shader] };
  const outputs = await buildEntry(f.source, job);
  f.write("01-native/.native-tools/entries.json", JSON.stringify([job]));
  f.certify();
  const mirrorDigest = JSON.parse(
    f.read("00-mirror/forensics/stage0-cert.json"),
  ).digest;
  const hashed = (file) => ({
    file,
    sha256: crypto
      .createHash("sha256")
      .update(f.read("01-native/" + file))
      .digest("hex"),
  });
  f.write(
    "01-native/forensics/source-recovery.before-reconstruction.json",
    JSON.stringify({ publicScripts: [] }),
  );
  const report = {
    runtimeStatus: "reconstructed-runtime",
    publicScripts: [],
    reconstruction: {
      identity: "reconstructed",
      mirrorDigest,
      routes: ["/", "/shop"].map((route) => ({
        route,
        entry,
        output,
        sources: job.sources,
        authoredFiles: job.sources.map(hashed),
        documentFile: route === "/" ? "index.html" : "shop/index.html",
        outputs: outputs.map((o) => ({ ...o, ...hashed(o.file) })),
        evidence: [{ file: evidence, sha256 }],
      })),
    },
  };
  const persist = () =>
    f.write("01-native/forensics/source-recovery.json", JSON.stringify(report));
  persist();
  f.pages('<script type="module" src="/' + output + '"></script>');
  f.certify();
  assert.throws(() => f.assemble(), /verified native measurements/);
  f.certify({ metricsCount: 2 });
  f.assemble();
  assert.match(f.read("02-svelte5/src/shader-modules.d.ts"), /\*\.glsl/);
  assert.deepEqual(
    f.read("02-svelte5/static/assets/reconstructed/disclosure.js"),
    f.read("01-native/" + output),
  );
  assert.equal(
    JSON.parse(f.read("02-svelte5/forensics/reconstruction-provenance.json"))
      .identity,
    "reconstructed",
  );
  await checkPreview(t, f, async (page) => {
    const btn = page.getByRole("button", { name: "Home" });
    await btn.click();
    assert.equal(await btn.getAttribute("aria-expanded"), "true");
  });
  report.reconstruction.routes[0].evidence[0].sha256 = "0".repeat(64);
  persist();
  f.certify({ metricsCount: 2 });
  assert.throws(() => f.assemble(), /Evidence changed/);
});

test(
  "Svelte production WebGL draws changing frames and responds to press, scroll, and release",
  { skip: !hasToolchain, timeout: 30000 },
  async (t) => {
    const fixture = workspace(t);
    const inputs = Object.keys(mappedWebglInputs).map(
      (rel) => "recovered-source/" + rel,
    );
    for (const [rel, content] of Object.entries(mappedWebglInputs))
      fixture.write("01-native/recovered-source/" + rel, content);
    const job = {
      entry: "recovered-source/src/main.ts",
      sources: inputs,
      output: ".native-build/main.js",
    };
    const outputs = await buildEntry(fixture.source, job);
    fixture.write(
      "01-native/.native-tools/entries.json",
      JSON.stringify([job]),
    );
    fixture.write(
      "01-native/forensics/source-recovery.json",
      JSON.stringify({
        mode: "A",
        runtimeStatus: "source-built-runtime",
        rebuild: { version: "0.28.2", entry: job.entry, outputs },
        publicScripts: [
          {
            status: "rebuilt-from-source",
            entry: job.entry,
            output: job.output,
          },
        ],
      }),
    );
    for (const dir of ["", "shop/"])
      fixture.write(
        "01-native/" + dir + "index.html",
        '<!doctype html><html><head><title>Mapped WebGL</title><style>body{height:300vh}canvas{position:fixed;top:0;left:0}</style></head><body><canvas width="128" height="128"></canvas><script type="module" src="/.native-build/main.js"></script></body></html>',
      );
    fixture.certify();
    fixture.assemble();
    for (const rel of inputs)
      assert.equal(
        fixture.read("02-svelte5/" + rel),
        fixture.read("01-native/" + rel),
      );
    await checkPreview(
      t,
      fixture,
      async (page) => {
        await assertWebglMotion(page);
        assert.ok(
          await page.evaluate(() =>
            performance
              .getEntriesByType("resource")
              .some(
                (e) =>
                  new URL(e.name).pathname === "/assets/recovered-entry.js",
              ),
          ),
        );
      },
      { gl: true },
    );
  },
);

async function checkPreview(t, fixture, action, { gl = false } = {}) {
  if (!hasToolchain) return;
  const src = fs.realpathSync(toolchain);
  const modules = path.join(fixture.target, "node_modules");
  fs.cpSync(src, modules, {
    recursive: true,
    verbatimSymlinks: true,
    mode: fs.constants.COPYFILE_FICLONE,
    filter(file) {
      if (!fs.lstatSync(file).isSymbolicLink()) return true;
      const link = fs.readlinkSync(file);
      // A fixture can safely retain internal relative links to its own copied binaries.
      return (
        !path.isAbsolute(link) &&
        path.resolve(path.dirname(file), link).startsWith(src + path.sep)
      );
    },
  });
  const workspaceYaml = path.join(fixture.target, "pnpm-workspace.yaml");
  fs.appendFileSync(workspaceYaml, "\nverifyDepsBeforeRun: false\n");
  const bin = (name) => path.join(modules, ".bin", name);
  const command = (name, args) =>
    execFileSync(bin(name), args, { cwd: fixture.target, encoding: "utf8" });
  command("svelte-kit", ["sync"]);
  command("svelte-check", [
    "--tsconfig",
    "./tsconfig.json",
    "--fail-on-warnings",
  ]);
  fixture.run("audit-svelte5-mcp", "--app", fixture.target);
  execFileSync("pnpm", ["run", "build"], {
    cwd: fixture.target,
    encoding: "utf8",
  });
  const server = spawn(
    bin("vite"),
    ["preview", "--host", "127.0.0.1", "--port", "0"],
    { cwd: fixture.target, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => server.kill());
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Preview startup timed out")),
      10000,
    );
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error("Preview exited " + code));
    });
    server.stdout.on("data", (data) => {
      const url = String(data).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {
        clearTimeout(timeout);
        resolve(url);
      }
    });
  });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: gl
      ? [
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ]
      : [],
    executablePath: process.env.SVELTE_FIXTURE_CHROME,
  });
  t.after(() => browser.close());
  const browserPage = await browser.newPage();
  const errors = [];
  browserPage.on("pageerror", (e) => errors.push(e.message));
  await browserPage.goto(url);
  await browserPage.waitForLoadState("networkidle");
  await action(browserPage);
  assert.deepEqual(errors, []);
}

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "svelte-skill-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "01-native"),
    target = path.join(root, "02-svelte5");
  const write = (rel, text) => {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  };
  const run = (script, ...args) =>
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/" + script + ".mjs", import.meta.url),
        ),
        ...args,
      ],
      { encoding: "utf8", stdio: "pipe" },
    );
  for (const dir of ["01-native", "00-mirror"])
    write(dir + "/forensics/routes-manifest.json", '{"routes":["/","/shop"]}');
  return {
    source,
    target,
    write,
    run,
    read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    pages(script) {
      for (const [dir, name] of [
        ["", "Home"],
        ["shop/", "Shop"],
      ])
        write(
          "01-native/" + dir + "index.html",
          '<!doctype html><html lang="en"><head><title>' +
            name +
            '</title></head><body class="store"><main><section id="details"><button>' +
            name +
            "</button></section></main>" +
            script +
            "</body></html>",
        );
    },
    certify(summary = {}) {
      for (const [dir, stage] of [
        ["01-native", 1],
        ["00-mirror", 0],
      ])
        mintStageCert({
          stage,
          dir: path.join(root, dir),
          routes: ["/", "/shop"],
          summary,
        });
    },
    assemble() {
      for (const script of ["scaffold-sveltekit3", "assemble-svelte-routes"])
        run(script, "--source", source, "--target", target);
    },
  };
}
