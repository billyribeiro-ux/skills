import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { computeStageDigest } from '../../shared/pipeline-gate.mjs';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const html = '<!doctype html><html><head><link rel="stylesheet" href="/ui/css/main.css?v=1"></head><body><main>Fixture</main><script src="/app.js?v=blue"></script><script src="/app.js?v=teal"></script><script type="module" src="/ui/modules/main.mjs?v=2"></script></body></html>';
const sourceMap = (name) => JSON.stringify({ version: 3, sources: ['src/' + name + '.ts'], sourcesContent: ['export const ' + name + ' = 1;'], mappings: '', names: [] });
const scriptBody = (name) => {
  const mapUrl = name === 'blue' ? 'data:application/json;base64,' + Buffer.from(sourceMap(name)).toString('base64') : '/teal.map';
  return 'window.' + name + '=1;\n//# sourceMappingURL=' + mapUrl;
};

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scripts, script), ...args], {stdio: 'inherit'});
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(script + ' exited ' + code)));
    child.once('error', reject);
  });
}

test('captures original document and source maps, and replays both script variants', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-fixture-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const origin = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(html);
    }
    const resources = {
      '/ui/modules/main.mjs': ['text/javascript', `window.exercise = async () => {
        const blue = await import('./nested/color.mjs?t=blue');
        const teal = await import('./nested/color.mjs?t=teal');
        const worker = new Worker(new URL('../workers/painter.js?v=2', import.meta.url), {type:'module'});
        const answer = await new Promise(resolve => {worker.onmessage = event => resolve(event.data)});
        worker.terminate();
        return [blue.default, teal.default, answer];
      };`],
      '/ui/modules/nested/color.mjs': ['text/javascript', 'export default ' + JSON.stringify(url.searchParams.get('t'))],
      '/ui/workers/painter.js': ['text/javascript', `import {name} from './util.mjs?rev=1';
        const bytes = await (await fetch(new URL('../wasm/paint.wasm?v=2', import.meta.url))).arrayBuffer();
        postMessage(name + ':' + WebAssembly.validate(bytes));`],
      '/ui/workers/util.mjs': ['text/javascript', 'export const name = "paint";'],
      '/ui/wasm/paint.wasm': ['application/wasm', Buffer.from([0,97,115,109,1,0,0,0])],
      '/ui/css/main.css': ['text/css', 'main { background-image: url("../art/mark.svg?v=1#part"); }'],
      '/ui/art/mark.svg': ['image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect id="part" width="10" height="10" fill="navy"/></svg>']
    };
    if (Object.hasOwn(resources, url.pathname)) {
      const [mime, body] = resources[url.pathname];
      res.setHeader('Content-Type', mime);
      return res.end(body);
    }
    if (url.pathname === '/app.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(scriptBody(url.searchParams.get('v')));
    }
    if (url.pathname === '/teal.map') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(sourceMap('teal'));
    }
    res.writeHead(204).end();
  });
  await new Promise((resolve, reject) => { origin.once('error', reject); origin.listen(0, '127.0.0.1', resolve); });
  t.after(() => { origin.closeAllConnections(); origin.close(); });
  const live = 'http://127.0.0.1:' + origin.address().port;
  await run('capture-mirror.mjs', ['--url', live, '--out-dir', dir, '--single-route']);
  const json = (name) => JSON.parse(fs.readFileSync(path.join(dir, 'forensics', name), 'utf8'));
  const maps = json('source-maps.json').maps;
  assert.deepEqual(maps.map((map) => map.inline).sort(), [false, true]);
  const route = json('routes-manifest.json').routes[0];
  assert.equal(fs.readFileSync(path.join(dir, route.rawDocument), 'utf8'), html);
  const replay = spawn(process.execPath, [path.join(scripts, 'serve-mirror.mjs'), '--dir', dir, '--port', '0']);
  t.after(() => replay.kill());
  const local = await new Promise((resolve, reject) => {
    replay.once('error', reject);
    replay.once('exit', (code) => reject(new Error('Replay server exited ' + code)));
    replay.stdout.on('data', (data) => {
      const port = /localhost:(\d+)/.exec(data.toString())?.[1];
      if (port) resolve('http://127.0.0.1:' + port);
    });
  });
  for (const name of ['blue', 'teal']) {
    assert.equal(await (await fetch(local + '/app.js?v=' + name)).text(), scriptBody(name));
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(local);
    await page.waitForFunction(() => typeof window.exercise === 'function');
    assert.deepEqual(await page.evaluate(() => window.exercise()), ['blue', 'teal', 'paint:true']);
    const css = await page.locator('main').evaluate(el => getComputedStyle(el).backgroundImage);
    assert.match(css, /#part/);
  } finally {
    await browser.close();
  }
  await run('verify-stage0-mirror.mjs', ['--live', live, '--local', local, '--mirror-dir', dir]);
  const digest = computeStageDigest(0, dir).digest;
  fs.appendFileSync(path.join(dir, maps[0].file), ' ');
  assert.notEqual(computeStageDigest(0, dir).digest, digest);
});
