import { mappedWebglInputs, assertWebglMotion } from "./fixtures/mapped-webgl.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { sanitizeAndFormatCss } from "../scripts/ast-humanizer.mjs";

const decoder = fileURLToPath(
  new URL("../scripts/decode-mode-b-static.mjs", import.meta.url),
);
function fixture(t) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "native-recovery-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mirror = path.join(dir, "mirror"),
    native = path.join(dir, "native");
  function write(name, data) {
    const file = path.join(mirror, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof data === "string" ? data : JSON.stringify(data),
    );
  }
  function decode() {
    return spawnSync(
      process.execPath,
      [decoder, "--mirror-dir", mirror, "--out-dir", native],
      { encoding: "utf8" },
    );
  }
  function report() {
    return JSON.parse(
      fs.readFileSync(path.join(native, "forensics/source-recovery.json")),
    );
  }
  return { dir, mirror, native, write, decode, report };
}

test("static script ownership, embedded sources, missing content and rerun preservation", (t) => {
  const f = fixture(t);
  const css =
    ".card { color:black; &:hover { color:red } @media (width < 50rem) { padding:1rem } }";
  f.write(
    "index.html",
    '<main></main><script type="module" src="/shop/badge.js"></script>',
  );
  f.write("shop/badge.js", 'import "./price.js"');
  f.write("shop/price.js", "export default 42");
  f.write("account/badge.js", 'export default "account"');
  f.write("styles.css", css);
  const contents = ['import "./price.js"', "", null, "different"];
  f.write("__sourcemaps__/index.map", {
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: {
          version: 3,
          sources: [
            "webpack://app/./shop/badge.js",
            "../src/empty.ts",
            "lost.ts",
            "webpack://app/./shop/badge.js",
          ],
          sourcesContent: contents,
          names: [],
          mappings: "",
        },
      },
    ],
  });
  const r = f.decode();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.report().runtimeStatus, "static-route-runtime");
  assert.equal(f.report().sources.length, 4);
  assert.equal(f.report().sources[2].status, "unresolved");
  assert.match(f.report().sources[3].outputPath, /source-variants/);
  assert.equal(
    fs.readFileSync(
      path.join(f.native, "recovered-source/src/empty.ts"),
      "utf8",
    ),
    "",
  );
  for (const name of [
    "account/badge.js",
    "shop/badge.js",
    "shop/price.js",
    "styles.css",
    "index.html",
  ])
    assert.deepEqual(
      fs.readFileSync(path.join(f.native, name)),
      fs.readFileSync(path.join(f.mirror, name)),
    );
  assert.match(sanitizeAndFormatCss(css), /&:hover/);
  assert.match(sanitizeAndFormatCss(css), /@media/);
  assert.equal(
    f.report().publicScripts.find((x) => x.path === "shop/badge.js")
      .runtimeSource,
    "recovered-source/shop/badge.js",
  );
  fs.writeFileSync(path.join(f.native, "user-edit"), "retained");
  assert.notEqual(f.decode().status, 0);
  assert.equal(
    fs.readFileSync(path.join(f.native, "user-edit"), "utf8"),
    "retained",
  );
});

test("genuine bundled two-file TypeScript graph builds and executes from recovered files", async (t) => {
  const f = fixture(t);
  const src = path.join(f.dir, "author");
  fs.mkdirSync(path.join(src, "math"), { recursive: true });
  fs.writeFileSync(
    path.join(src, "math/value.ts"),
    "export const twice=(n:number)=>n*2;",
  );
  fs.writeFileSync(
    path.join(src, "main.ts"),
    "import {twice} from './math/value';globalThis.nativeResult=twice(21);",
  );
  const production = path.join(f.mirror, "assets/bundle.js");
  await build({
    entryPoints: [path.join(src, "main.ts")],
    bundle: true,
    format: "esm",
    sourcemap: "external",
    outfile: production,
  });
  const url = "https://example.test/assets/bundle.js";
  f.write(
    "index.html",
    '<html><head></head><body><main>Result</main><script type="module" src="/assets/bundle.js"></script></body></html>',
  );
  f.write("forensics/assets.json", {
    targetOrigin: "https://example.test",
    assets: [{ url, relPath: "assets/bundle.js" }],
  });
  f.write("forensics/routes-manifest.json", {
    routes: [{ route: "/", documentFile: "index.html" }],
  });
  f.write("forensics/source-maps.json", {
    maps: [
      { file: "__sourcemaps__/bundle.map", scriptUrl: url, firstParty: true },
    ],
  });
  f.write(
    "__sourcemaps__/bundle.map",
    fs.readFileSync(production + ".map", "utf8"),
  );
  fs.unlinkSync(production + ".map");
  const r = f.decode();
  assert.equal(r.status, 0, r.stderr);
  const report = f.report();
  assert.equal(report.runtimeStatus, "source-built-runtime");
  assert.equal(report.sources.length, 2);
  assert.equal(fs.existsSync(path.join(f.native, "assets/bundle.js")), false);
  assert.match(
    fs.readFileSync(path.join(f.native, "index.html"), "utf8"),
    /src="\/.native-build\/main.js"/,
  );
  const execute = () =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "await import(process.argv[1]); console.log(globalThis.nativeResult)",
        path.join(f.native, ".native-build/main.js"),
      ],
      { encoding: "utf8" },
    );
  const run = execute();
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "42");
  const value = report.sources.find((record) =>
    record.reportedPath.endsWith("math/value.ts"),
  );
  fs.writeFileSync(
    path.join(f.native, value.outputPath),
    "export const twice=(n:number)=>n*4;",
  );
  fs.symlinkSync(
    fileURLToPath(new URL("../../node_modules", import.meta.url)),
    path.join(f.native, "node_modules"),
    "dir",
  );
  const rebuilt = spawnSync(
    process.execPath,
    [".native-tools/build-mapped.mjs"],
    { cwd: f.native, encoding: "utf8" },
  );
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.equal(execute().stdout.trim(), "84");
});

test("compiled entries lacking source evidence remain unresolved", (t) => {
  const f = fixture(t);
  f.write(
    "index.html",
    '<script type="module" src="/assets/bundle.js"></script>',
  );
  f.write("assets/bundle.js", "globalThis.answer=42;");
  const r = f.decode();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(f.report().runtimeStatus, "requires-runtime-reconstruction");
  assert.equal(fs.existsSync(path.join(f.native, "assets/bundle.js")), false);
});

async function openBrowser(t, f) {
  const { chromium } = await import("playwright");
  const { spawn } = await import("node:child_process");
  const { createInterface } = await import("node:readline");
  const server = spawn(
    process.execPath,
    [".native-tools/serve-native.mjs", "--dir", ".", "--port", "0"],
    { cwd: f.native, stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => server.kill());
  const endpoint = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", (code) => reject(Error("Server exited " + code)));
    createInterface({ input: server.stdout }).on("line", (line) => {
      const url = line.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (url) resolve(url[0]);
    });
  });
  const browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const resources = [];
  const errors = [];
  page.on("request", (req) => resources.push(req.url()));
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto(endpoint);
  return { page, endpoint, resources, errors };
}

test(
  "browser renders animated mapped GLSL and responds to pointer and scroll",
  { timeout: 30000 },
  async (t) => {
    const f = fixture(t);
    const author = path.join(f.dir, "author");
    const inputs = mappedWebglInputs;
    for (const [rel, content] of Object.entries(inputs)) {
      fs.mkdirSync(path.dirname(path.join(author, rel)), { recursive: true });
      fs.writeFileSync(path.join(author, rel), content);
    }
    const production = path.join(f.mirror, "assets", "scene.js");
    await build({
      entryPoints: [path.join(author, "src/main.ts")],
      outfile: production,
      format: "esm",
      bundle: true,
      minify: true,
      sourcemap: "external",
      loader: { ".vert": "text", ".frag": "text" },
    });
    const url = "https://example.test/assets/scene.js";
    f.write(
      "index.html",
      '<!doctype html><html><head><style>body{height:300vh}canvas{position:fixed;top:0;left:0}</style></head><body><canvas width="128" height="128"></canvas><script type="module" src="/assets/scene.js"></script></body></html>',
    );
    f.write("forensics/assets.json", {
      targetOrigin: "https://example.test",
      assets: [{ url, relPath: "assets/scene.js" }],
    });
    f.write("forensics/routes-manifest.json", {
      targetOrigin: "https://example.test",
      routes: [{ route: "/", documentFile: "index.html" }],
    });
    f.write("forensics/source-maps.json", {
      maps: [
        {
          file: "__sourcemaps__/published.map",
          scriptUrl: url,
          firstParty: true,
        },
      ],
    });
    f.write(
      "__sourcemaps__/published.map",
      fs.readFileSync(production + ".map", "utf8"),
    );
    fs.unlinkSync(production + ".map");
    const r = f.decode();
    assert.equal(r.status, 0, r.stderr);
    const report = f.report();
    assert.equal(
      report.runtimeStatus,
      "source-built-runtime",
      JSON.stringify(report.publicScripts),
    );
    for (const [rel, text] of Object.entries(inputs)) {
      const record = report.sources.find((x) => x.reportedPath.endsWith(rel));
      assert.equal(
        fs.readFileSync(path.join(f.native, record.outputPath), "utf8"),
        text,
      );
    }
    assert.equal(fs.existsSync(path.join(f.native, "assets/scene.js")), false);
    const { page, endpoint, resources, errors } = await openBrowser(t, f);
    await assertWebglMotion(page);
    assert.deepEqual(errors, []);
    assert.ok(resources.includes(endpoint + "/.native-build/main.js"));
    assert.ok(resources.every((url) => url.startsWith(endpoint + "/")));
  },
);

test(
  "a click loads a separately rebuilt mapped module on demand",
  { timeout: 30000 },
  async (t) => {
    const f = fixture(t);
    const src = path.join(f.dir, "author/src");
    fs.mkdirSync(path.join(src, "panels"), { recursive: true });
    fs.writeFileSync(
      path.join(src, "main.ts"),
      `document.querySelector('button').onclick=async()=>{
    const detail=await import('./panels/detail');
    document.querySelector('output').textContent=detail.render();
  };`,
    );
    fs.writeFileSync(
      path.join(src, "panels/detail.ts"),
      "import {answer} from './math'; export function render(){return 'Loaded '+answer()}",
    );
    fs.writeFileSync(
      path.join(src, "panels/math.ts"),
      "export function answer(){return 6*7}",
    );
    const dist = path.join(f.mirror, "assets");
    await build({
      absWorkingDir: f.dir,
      entryPoints: [path.join(src, "main.ts")],
      bundle: true,
      minify: true,
      format: "esm",
      splitting: true,
      sourcemap: "external",
      outdir: dist,
      chunkNames: "parts/[name]-[hash]",
    });
    const maps = [],
      assets = [];
    const origin = "https://example.test";
    for (const filename of fs
      .readdirSync(dist, { recursive: true })
      .filter((x) => x.endsWith(".js"))) {
      const rel = "assets/" + filename;
      const url = origin + "/" + rel;
      const map = "__sourcemaps__/" + filename.replaceAll("/", "__") + ".map";
      f.write(map, fs.readFileSync(path.join(f.mirror, rel) + ".map", "utf8"));
      fs.unlinkSync(path.join(f.mirror, rel) + ".map");
      maps.push({ file: map, scriptUrl: url, firstParty: true });
      assets.push({ url, relPath: rel });
    }
    assert.equal(maps.length, 2);
    f.write(
      "index.html",
      '<html><body><button>Load details</button><output></output><script type="module" src="/assets/main.js"></script></body></html>',
    );
    f.write("forensics/assets.json", { targetOrigin: origin, assets });
    f.write("forensics/source-maps.json", { maps });
    f.write("forensics/routes-manifest.json", {
      targetOrigin: origin,
      routes: [{ route: "/", documentFile: "index.html" }],
    });
    const decoded = f.decode();
    assert.equal(decoded.status, 0, decoded.stderr);
    const rep = f.report();
    assert.equal(
      rep.runtimeStatus,
      "source-built-runtime",
      JSON.stringify(rep.publicScripts),
    );
    assert.deepEqual(rep.publicScripts.map((s) => s.status).sort(), [
      "rebuilt-from-source",
      "rebuilt-lazy-module",
    ]);
    assert.ok(
      rep.rebuild.outputs.some((output) =>
        output.imports.some((i) => i.kind === "dynamic-import"),
      ),
    );
    for (const asset of assets)
      assert.equal(fs.existsSync(path.join(f.native, asset.relPath)), false);
    const { page, resources, errors, endpoint } = await openBrowser(t, f);
    assert.equal(
      resources.some((url) => url.includes("/lazy/")),
      false,
    );
    await page.getByRole("button", { name: "Load details" }).click();
    await page.waitForFunction(
      () => document.querySelector("output").textContent === "Loaded 42",
    );
    assert.equal(resources.filter((url) => url.includes("/lazy/")).length, 1);
    assert.ok(resources.every((url) => url.startsWith(endpoint + "/")));
    assert.deepEqual(errors, []);
  },
);
