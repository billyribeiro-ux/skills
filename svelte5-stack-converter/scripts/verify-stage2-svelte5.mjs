#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { reconstructedAssetPath } from './reconstruction-input.mjs';
import { assertStageCertified, invalidateStageCert, mintStageCert } from '../../shared/pipeline-gate.mjs';
import { auditKineticAndLivingSurface, installKineticObserver } from '../../shared/kinetic-verifier.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_URL = getArg('--mirror-url', 'http://localhost:3010');
const NATIVE_URL = getArg('--native-url', 'http://localhost:3011');
const SVELTE_URL = getArg('--svelte-url', 'http://localhost:3012');
const NATIVE_DIR = path.resolve(getArg('--native-dir', './01-native'));
const SVELTE_DIR = path.resolve(getArg('--svelte-dir', './02-svelte5'));
const MIRROR_DIR = path.resolve(getArg('--mirror-dir', path.join(path.dirname(SVELTE_DIR), '00-mirror')));
const THRESHOLD = parseFloat(getArg('--threshold', '0.002')); // 0.20% max unmasked pixel diff
const MAX_SCROLL_DELTA = parseInt(getArg('--max-scroll-delta', '4'), 10);
const MAX_LANDMARK_DELTA = parseInt(getArg('--max-landmark-delta', '2'), 10);
const VIEWPORTS_ARG = getArg('--viewports', '1440x900,768x1024,390x844');
const OUT_DIR = path.resolve(getArg('--out-dir', path.join(SVELTE_DIR, 'forensics', 'parity')));
const SKIP_PARITY = args.includes('--skip-parity');
const ALLOW_PARTIAL = args.includes('--allow-partial-routes');

// Auto-discover ALL captured routes from Stage 0/2 forensics/routes-manifest.json
const manifest = JSON.parse(fs.readFileSync(path.join(MIRROR_DIR,'forensics','routes-manifest.json'), 'utf8'));
const manifestRoutes = manifest.routes.map(r => typeof r === 'string' ? r : r.route);
if (!manifestRoutes.length) throw Error('Original capture manifest is empty');
const nativeEvidence = JSON.parse(fs.readFileSync(path.join(NATIVE_DIR,'forensics','source-recovery.json'),'utf8'));
const authored = new Set(nativeEvidence.publicScripts.filter(s => s.status === 'preserved-public').map(s => s.path));
const explicitRoutes = getArg('--routes', '');
const ROUTES = explicitRoutes
  ? explicitRoutes.split(',').map((r) => r.trim()).filter(Boolean)
  : manifestRoutes;

const VIEWPORTS = VIEWPORTS_ARG.split(',').map((v) => {
  const [w, h] = v.split('x').map(Number);
  return { width: w, height: h, label: v };
});

console.log(`============================================================`);
console.log(`🛡️  STAGE 2 SVELTE 5 NUCLEAR 5-GATE PARITY & QUALITY VERIFIER`);
console.log(`============================================================`);
console.log(`  Stage 0 Ground-Truth: ${MIRROR_DIR} (${MIRROR_URL})`);
console.log(`  Stage 1 Native:       ${NATIVE_DIR} (${NATIVE_URL})`);
console.log(`  Stage 2 Svelte 5 App: ${SVELTE_DIR} (${SVELTE_URL})`);
console.log(`  Routes Under Audit:   ${ROUTES.join(', ')} (${ROUTES.length}/${manifestRoutes.length} captured)`);
console.log(`  Max Unmasked Diff:    ${(THRESHOLD * 100).toFixed(2)}%`);
console.log(`  Max Scroll Delta:     ${MAX_SCROLL_DELTA}px`);
console.log(`  Max Landmark Delta:   ${MAX_LANDMARK_DELTA}px`);
console.log(`============================================================\n`);

invalidateStageCert(2, SVELTE_DIR);
assertStageCertified({ requiredStage: 0, dir: MIRROR_DIR, callerName: 'verify-stage2-svelte5.mjs' });
assertStageCertified({ requiredStage: 1, dir: NATIVE_DIR, callerName: 'verify-stage2-svelte5.mjs' });

if (explicitRoutes && !ALLOW_PARTIAL) {
  const omitted = manifestRoutes.filter((mr) => !ROUTES.includes(mr));
  if (omitted.length > 0) {
    console.error(`❌ [GATE 1 FAIL] Partial route audit forbidden! Omitted captured route(s): ${omitted.join(', ')}`);
    console.error(`   Omit --routes to audit 100% of captured routes.`);
    process.exit(1);
  }
}

async function resolveDependency(name) {
  try {
    return await import(name);
  } catch {
    const vaultPath = path.resolve(new URL(`../../node_modules/${name}`, import.meta.url).pathname);
    return await import(vaultPath);
  }
}

function scanFiles(dir) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (!['node_modules', '.svelte-kit', '.git', 'build'].includes(f.name)) {
        list.push(...scanFiles(full));
      }
    } else if (f.isFile()) {
      list.push(full);
    }
  }
  return list;
}

// -------------------------------------------------------------
// GATE 1: Zero-Tolerance Anti-Cheat, Anti-Chunk & Completeness
// -------------------------------------------------------------
console.log(`🔍 [Gate 1/5] Running Zero-Tolerance Anti-Cheat & Chunk-Bypass Audit...`);

const svelteSrcDir = path.join(SVELTE_DIR, 'src');
const svelteStaticDir = path.join(SVELTE_DIR, 'static');
const allSrcFiles = scanFiles(svelteSrcDir);
const allStaticFiles = scanFiles(svelteStaticDir);
const cheatViolations = [];

// Ban legacy svelte.config.js in SvelteKit 3.x
if (fs.existsSync(path.join(SVELTE_DIR, 'svelte.config.js'))) {
  cheatViolations.push({
    file: 'svelte.config.js',
    rule: 'Legacy SvelteKit 2 Config Forbidden',
    details: 'SvelteKit 3.x configures adapter & runes inside vite.config.ts. Remove svelte.config.js.'
  });
}

// Ban mirrored JS chunks or HTML route shadows inside static/
for (const sf of allStaticFiles) {
  const relStatic = path.relative(SVELTE_DIR, sf).replace(/\\/g, '/');
  const assetPath = path.relative(svelteStaticDir,sf).replaceAll(path.sep,'/');
  if (nativeEvidence.runtimeStatus === 'reconstructed-runtime') {
    const nativeOutput = nativeEvidence.reconstruction.routes.flatMap(row => row.outputs).find(o => reconstructedAssetPath(o.file) === assetPath);
    if (nativeOutput && fs.readFileSync(path.join(NATIVE_DIR,nativeOutput.file)).equals(fs.readFileSync(sf))) continue;
  }
  const rebuilt = nativeEvidence.publicScripts.find(s => s.status === 'rebuilt-from-source');
  if (rebuilt) {
    const rebuiltPath = assetPath === 'assets/recovered-entry.js' ? rebuilt.output :
      assetPath.startsWith('assets/lazy/') ? path.join(path.dirname(rebuilt.output), assetPath.slice('assets/'.length)) : null;
    if (rebuiltPath && fs.existsSync(path.join(NATIVE_DIR,rebuiltPath)) &&
        fs.readFileSync(path.join(NATIVE_DIR,rebuiltPath)).equals(fs.readFileSync(sf))) continue;
  }
  if (authored.has(assetPath) && fs.readFileSync(path.join(NATIVE_DIR,assetPath)).equals(fs.readFileSync(sf))) continue;
  if (/\.(?:html|svelte|m?js)$/i.test(relStatic)) {
    cheatViolations.push({
      file: relStatic,
      rule: 'CHUNK_OR_HTML_SHADOW_IN_STATIC',
      details: `Forbidden file "${relStatic}" inside static/. Static folder may only contain media, fonts, images, and JSON fixtures.`
    });
  }
}

for (const filePath of allSrcFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(SVELTE_DIR, filePath);

  if (/\{#if\s+false\}/i.test(content)) {
    cheatViolations.push({ file: relPath, rule: 'Dead Code Cheat ({#if false})', details: 'Found {#if false} wrapper.' });
  }
  if (/react-dom(?:\/client)?|createRoot|hydrateRoot|ReactDOM\.render/i.test(content)) {
    cheatViolations.push({ file: relPath, rule: 'React Runtime Infiltration', details: 'Detected react-dom/createRoot.' });
  }
  if (/verbatim-dom\.json|VerbatimStage1Surface/i.test(content)) {
    cheatViolations.push({ file: relPath, rule: 'Verbatim DOM Snapshot Cheat', details: 'Detected verbatim-dom injection.' });
  }
  if (/scaffold-placeholder|SvelteKit 3\.[12] \+ Svelte 5 Initialized/i.test(content)) {
    cheatViolations.push({
      file: relPath,
      rule: 'Unconverted Scaffold Placeholder',
      details: 'Route still contains unconverted starter placeholder markup.'
    });
  }
  if (/<script\b[^>]*\bsrc=["'][^"']*["']/i.test(content)) {
    cheatViolations.push({
      file: relPath,
      rule: 'External Script Injection Cheat',
      details: 'Detected <script src="..."> loading an external/static bundle instead of native Svelte 5 components.'
    });
  }

  const htmlMatches = content.match(/\{@html\s+([^}]+)\}/g) || [];
  for (const hm of htmlMatches) {
    if (/domSnapshot|snapshot\.html|fullDom|bodyHtml|rawPage|pageHtml|sectionHtml/i.test(hm)) {
      cheatViolations.push({ file: relPath, rule: 'Monolithic {@html} Cheat', details: `Detected raw HTML dump: ${hm}` });
    }
  }
}

const hooksFile = path.join(SVELTE_DIR, 'src', 'hooks.server.ts');
if (fs.existsSync(hooksFile)) {
  const hooksContent = fs.readFileSync(hooksFile, 'utf8');
  if (/transformPageChunk.*replace\(.*%sveltekit\.body%/s.test(hooksContent) && /readFileSync/i.test(hooksContent)) {
    cheatViolations.push({
      file: 'src/hooks.server.ts',
      rule: 'Server Hook HTML Hijacking',
      details: 'Detected transformPageChunk replacing SvelteKit body with disk HTML.'
    });
  }
}

if (cheatViolations.length > 0) {
  console.error(`❌ Gate 1 FAILED: ${cheatViolations.length} anti-cheat violation(s):`);
  for (const v of cheatViolations) console.error(`  - [${v.rule}] ${v.file}: ${v.details}`);
  process.exit(1);
}
console.log(`  ✅ Gate 1 PASSED: Zero cheats, zero static JS chunks, 100% route inventory accounted for.\n`);

// -------------------------------------------------------------
// GATE 2: Author-Grade Human Code Quality (verify-human-code-quality.mjs)
// -------------------------------------------------------------
console.log(`🧐 [Gate 2/5] Scanning Senior Human Code Quality across Svelte 5 Source...`);
const qualityScript = path.resolve(
  new URL('../../native-stack-decompiler/scripts/verify-human-code-quality.mjs', import.meta.url).pathname
);
try {
  execFileSync(process.execPath,[qualityScript,'--src-dir',svelteSrcDir],{stdio:'inherit'});
  console.log(`  ✅ Gate 2 PASSED: Author-grade code quality verified.\n`);
} catch {
  console.error(`❌ Gate 2 FAILED: Code quality infractions detected in ${svelteSrcDir}.`);
  process.exit(1);
}

// -------------------------------------------------------------
// GATE 3: Strict TypeScript (--fail-on-warnings) & Official @sveltejs/mcp
// -------------------------------------------------------------
console.log(`⚡ [Gate 3/5] Running SvelteKit Strict Type-Check & Official @sveltejs/mcp Audit...`);
const svelteKitBin = path.join(SVELTE_DIR, 'node_modules', '.bin', 'svelte-kit');
const svelteCheckBin = path.join(SVELTE_DIR, 'node_modules', '.bin', 'svelte-check');

if (!fs.existsSync(svelteKitBin) || !fs.existsSync(svelteCheckBin)) {
  console.error(`❌ Gate 3 FAILED: Missing svelte-kit or svelte-check binaries in ${SVELTE_DIR}/node_modules/.bin.`);
  process.exit(1);
}

try {
  execFileSync('pnpm', ['--config.verify-deps-before-run=false','run','build'], { cwd: SVELTE_DIR, stdio: 'inherit' });
  execFileSync(svelteKitBin, ['sync'], { cwd: SVELTE_DIR, stdio: 'inherit' });
  execFileSync(svelteCheckBin, ['--tsconfig', './tsconfig.json', '--fail-on-warnings'], {
    cwd: SVELTE_DIR,
    stdio: 'inherit'
  });
} catch {
  console.error(`❌ Gate 3 FAILED: svelte-check reported errors or warnings.`);
  process.exit(1);
}

const auditScript = path.resolve(new URL('./audit-svelte5-mcp.mjs', import.meta.url).pathname);
try {
  execFileSync('node', [auditScript, '--app', SVELTE_DIR], { stdio: 'inherit' });
  console.log(`  ✅ Gate 3 PASSED: 0 TypeScript errors/warnings and 0 @sveltejs/mcp issues/suggestions.\n`);
} catch {
  console.error(`❌ Gate 3 FAILED: @sveltejs/mcp svelte-autofixer reported issues or suggestions.`);
  process.exit(1);
}

if (SKIP_PARITY) {
  console.warn(`⚠️ [Gates 4 & 5 SKIPPED] --skip-parity passed. Static gates passed, browser parity NOT certified.`);
  process.exit(1);
}

// -------------------------------------------------------------
// GATES 4 & 5: Unmasked Visual, Layout, Kinetic & Behavioral Parity
// -------------------------------------------------------------
console.log(`🌐 [Gates 4 & 5] Running Unmasked Browser Parity & Kinetic Behavioral Verification...`);

async function verifyServerOnline(url) {
  try {
    const res = await fetch(new URL(ROUTES[0] || '/', url).href, { signal: AbortSignal.timeout(4000) });
    return res.ok; // Strictly require 2xx (NEVER accept 404 as online!)
  } catch {
    return false;
  }
}

// With this option the production preview starts after the build and type checks.
if (args.includes('--launch-preview')) {
  const endpoint = new URL(SVELTE_URL);
  if (endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:' || !endpoint.port) {
    throw new Error('Managed preview requires a loopback HTTP URL with an explicit port.');
  }
  const preview = spawn(process.execPath, [
    path.join(SVELTE_DIR, 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview', '--host', endpoint.hostname, '--port', endpoint.port, '--strictPort'
  ], {cwd:SVELTE_DIR, stdio:['ignore','pipe','inherit'], env:{...process.env,NO_COLOR:'1'}});
  process.once('exit', () => preview.kill());
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => reject(new Error('Production preview startup timed out')), 20000);
    let startup = '';
    preview.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      startup = (startup + chunk).slice(-4096);
      if (startup.includes(endpoint.origin)) {clearTimeout(timeout); resolve();}
    });
    preview.once('error',error => {clearTimeout(timeout); reject(error);});
    preview.once('exit', code => {clearTimeout(timeout); reject(new Error('Production preview exited ('+code+')'));});
  });
}

const [mirrorReady, nativeReady, svelteReady] = await Promise.all([
  verifyServerOnline(MIRROR_URL),
  verifyServerOnline(NATIVE_URL),
  verifyServerOnline(SVELTE_URL)
]);

if (!mirrorReady || !nativeReady || !svelteReady) {
  console.error(`❌ Gate 4 FAILED: Required HTTP 200 OK from Stage 0, Stage 1 & Stage 2 servers:`);
  console.error(`  - Stage 0 Mirror (${MIRROR_URL}): ${mirrorReady ? 'ONLINE (200 OK)' : 'OFFLINE or HTTP ERROR'}`);
  console.error(`  - Stage 1 Native (${NATIVE_URL}): ${nativeReady ? 'ONLINE (200 OK)' : 'OFFLINE or HTTP ERROR'}`);
  console.error(`  - Stage 2 Svelte (${SVELTE_URL}): ${svelteReady ? 'ONLINE (200 OK)' : 'OFFLINE or HTTP ERROR'}`);
  process.exit(1);
}

const { chromium } = await resolveDependency('playwright');
const pixelmatch = (await resolveDependency('pixelmatch')).default;
const { PNG } = await resolveDependency('pngjs');

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
  ]
});
const parityErrors = [];
const comparisons = [];
const svelteOrigin = new URL(SVELTE_URL).origin;
const nativeOrigin = new URL(NATIVE_URL).origin;
const mirrorOrigin = new URL(MIRROR_URL).origin;
const forensicsDir = path.join(MIRROR_DIR, 'forensics');

/**
 * Deterministic screenshot freeze WITHOUT masking <canvas> or hiding <video>!
 */
async function stabilizePageUnmasked(page) {
  await page.evaluate(async () => {
    document.querySelectorAll('.giga-cc, #giga-cc, [data-consent], #CybotCookiebotDialog').forEach((el) => el.remove());

    for (const anim of document.getAnimations({ subtree: true })) {
      try {
        const timing = anim.effect?.getTiming?.();
        if (timing && timing.iterations === Infinity) {
          anim.currentTime = 0;
          anim.pause();
        } else if (anim.playState === 'running' || anim.playState === 'pending') {
          try {
            anim.finish();
          } catch {
            const end = Number(timing?.delay || 0) + Number(timing?.duration || 0);
            if (Number.isFinite(end) && end > 0) anim.currentTime = end;
            anim.pause();
          }
        }
      } catch { }
    }

    const videos = Array.from(document.querySelectorAll('video'));
    await Promise.all(
      videos.map(
        (v) =>
          new Promise((resolve) => {
            try {
              v.pause();
              if (v.readyState >= 1 && Math.abs(v.currentTime) > 0.01) {
                v.addEventListener('seeked', () => resolve(), { once: true });
                v.currentTime = 0;
                setTimeout(resolve, 200);
              } else {
                resolve();
              }
            } catch {
              resolve();
            }
          })
      )
    );
  });
}

async function sampleScrollKinematics(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('header, nav, main > section, [style*="transform"], canvas'))
      .slice(0, 25)
      .map((el) => {
        const cs = window.getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          top: Math.round(r.top),
          height: Math.round(r.height),
          opacity: Number(parseFloat(cs.opacity).toFixed(2)),
          transform: cs.transform
        };
      });
  });
}

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    const isMobileVp = vp.width < 500;
    const contextMirror = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: isMobileVp,
      hasTouch: isMobileVp
    });
    const contextNative = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: isMobileVp,
      hasTouch: isMobileVp
    });
    const contextSvelte = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: isMobileVp,
      hasTouch: isMobileVp
    });

    const pageMirror = await contextMirror.newPage();
    const pageNative = await contextNative.newPage();
    const pageSvelte = await contextSvelte.newPage();

    await Promise.all([installKineticObserver(pageMirror),installKineticObserver(pageSvelte)]);

    const svelteClient = await contextSvelte.newCDPSession(pageSvelte);
    await svelteClient.send('Audits.enable');
    const cdpIssues = [];
    svelteClient.on('Audits.issueAdded', (issue) => cdpIssues.push(issue));

    const sveltePageErrors = [];
    const svelteConsoleErrors = [];
    const svelteFailedRequests = [];
    const svelteEscapedExternal = [];

    pageSvelte.on('pageerror', (err) => sveltePageErrors.push(err.message));
    pageSvelte.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') svelteConsoleErrors.push(text);
      else if (text.includes('Missing i18n key') || text.includes('Blocked aria-hidden')) {
        svelteConsoleErrors.push(`[A11y/i18n violation] ${text}`);
      }
    });
    const TELEMETRY_HOSTS = [
      'google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'clarity.ms',
      'hotjar.com', 'umami.is', 'segment.io', 'cookiebot.com', 'hs-scripts.com',
      'snitcher.com', 'trysurface', 'posthog', 'r.stripe.com', 'm.stripe.com',
      'm.stripe.network', 'q.stripe.com', 'errors.stripe.com'
    ];
    pageSvelte.on('response', (res) => {
      if (TELEMETRY_HOSTS.some((t) => res.url().includes(t))) return;
      if (res.status() >= 400) {
        svelteFailedRequests.push(`${res.status()} ${res.url()}`);
      }
    });

    // Strict air-gap network guard on all 3 stages!
    await pageSvelte.route('**/*', (rt) => {
      const u = rt.request().url();
      if (!u.startsWith(svelteOrigin) && !u.startsWith('data:') && !u.startsWith('blob:')) {
        if (TELEMETRY_HOSTS.some((t) => u.includes(t))) {
          return rt.fulfill({ status: 200, body: '/* telemetry noop */', contentType: 'application/javascript; charset=utf-8' });
        }
        svelteEscapedExternal.push(u);
        return rt.abort('failed');
      }
      return rt.continue();
    });
    await pageNative.route('**/*', (rt) => {
      const u = rt.request().url();
      if (!u.startsWith(nativeOrigin) && !u.startsWith('data:') && !u.startsWith('blob:')) {
        if (TELEMETRY_HOSTS.some((t) => u.includes(t))) {
          return rt.fulfill({ status: 200, body: '/* telemetry noop */', contentType: 'application/javascript; charset=utf-8' });
        }
        return rt.abort('failed');
      }
      return rt.continue();
    });
    await pageMirror.route('**/*', (rt) => {
      const u = rt.request().url();
      if (!u.startsWith(mirrorOrigin) && !u.startsWith('data:') && !u.startsWith('blob:')) {
        if (TELEMETRY_HOSTS.some((t) => u.includes(t))) {
          return rt.fulfill({ status: 200, body: '/* telemetry noop */', contentType: 'application/javascript; charset=utf-8' });
        }
        return rt.abort('failed');
      }
      return rt.continue();
    });

    const seedPrng = () => {
      const hashStr = (str) => {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i);
          h = Math.imul(h, 16777619) >>> 0;
        }
        return h || 1337;
      };
      let defaultSeed = 1337;
      let activeSeed = 1337;
      let usingCanvasSeed = false;
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        const ctx = origGetContext.call(this, type, ...args);
        if (ctx) {
          const key = String(type || '2d');
          let sig = `${key}:offscreen:${this.width}x${this.height}`;
          if (this.isConnected) {
            const r = this.getBoundingClientRect();
            const bucketY = Math.round((r.top + window.scrollY) / 100);
            sig = `${key}:y${bucketY}:${Math.round(r.width)}x${Math.round(r.height)}`;
          }
          activeSeed = hashStr(sig);
          usingCanvasSeed = true;
          queueMicrotask(() => {
            usingCanvasSeed = false;
          });
        }
        return ctx;
      };
      Math.random = () => {
        if (usingCanvasSeed) {
          activeSeed = (Math.imul(activeSeed, 1664525) + 1013904223) >>> 0;
          return activeSeed / 4294967296;
        }
        defaultSeed = (Math.imul(defaultSeed, 1664525) + 1013904223) >>> 0;
        return defaultSeed / 4294967296;
      };

      let clockFrozen = true;
      let virtualNowMs = 1000;
      const origPerfNow = performance.now.bind(performance);
      try {
        Object.defineProperty(performance, 'now', {
          value: () => (clockFrozen ? virtualNowMs : origPerfNow()),
          configurable: true
        });
      } catch { }

      const origSetTimeout = window.setTimeout.bind(window);
      const origClearTimeout = window.clearTimeout.bind(window);
      window.setTimeout = (fn, delay = 0, ...rest) => {
        if (clockFrozen && typeof fn === 'function' && Number(delay) >= 3000) {
          return 900001;
        }
        return origSetTimeout(fn, delay, ...rest);
      };
      window.clearTimeout = (id) => {
        if (typeof id === 'number' && id >= 900001) return;
        return origClearTimeout(id);
      };

      const origRAF = window.requestAnimationFrame.bind(window);
      const origCancelRAF = window.cancelAnimationFrame.bind(window);
      let nextRafId = 1;
      const pendingRafs = new Map();
      const origSetInterval = window.setInterval.bind(window);
      const origClearInterval = window.clearInterval.bind(window);
      let nextIntervalId = 1;
      const intervals = new Map();
      const liveIntervalIds = new Map();

      window.setInterval = (fn, delay = 16, ...rest) => {
        if (!clockFrozen) return origSetInterval(fn, delay, ...rest);
        const id = nextIntervalId++;
        const ms = Math.max(16, Number(delay) || 16);
        intervals.set(id, { fn, ms, nextAt: virtualNowMs + ms, rest });
        return id;
      };
      window.clearInterval = (id) => {
        intervals.delete(id);
        const liveId = liveIntervalIds.get(id);
        if (liveId !== undefined) {
          liveIntervalIds.delete(id);
          return origClearInterval(liveId);
        }
        return origClearInterval(id);
      };
      window.requestAnimationFrame = (cb) => {
        if (!clockFrozen) return origRAF(cb);
        const id = nextRafId++;
        pendingRafs.set(id, cb);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (pendingRafs.delete(id)) return;
        return origCancelRAF(id);
      };
      window.__AGY_ADVANCE_CLOCK__ = (deltaMs = 256) => {
        if (!clockFrozen) return;
        defaultSeed = hashStr(`tick:${virtualNowMs}`);
        const end = virtualNowMs + deltaMs;
        while (virtualNowMs < end && (pendingRafs.size > 0 || intervals.size > 0)) {
          virtualNowMs = Math.min(end, virtualNowMs + 16);
          const batch = Array.from(pendingRafs.values());
          pendingRafs.clear();
          for (const cb of batch) {
            try {
              cb(virtualNowMs);
            } catch { }
          }
          for (const item of Array.from(intervals.values())) {
            if (virtualNowMs >= item.nextAt) {
              item.nextAt = virtualNowMs + item.ms;
              try {
                if (typeof item.fn === 'function') item.fn(...item.rest);
              } catch { }
            }
          }
        }
        virtualNowMs = end;
      };
      window.__AGY_UNFREEZE_CLOCK__ = () => {
        if (!clockFrozen) return;
        clockFrozen = false;
        const batch = Array.from(pendingRafs.values());
        pendingRafs.clear();
        for (const cb of batch) {
          origRAF(cb);
        }
        for (const [id, item] of intervals.entries()) {
          liveIntervalIds.set(id, origSetInterval(item.fn, item.ms, ...item.rest));
        }
        intervals.clear();
      };
    };
    await pageMirror.addInitScript(seedPrng);
    await pageNative.addInitScript(seedPrng);
    await pageSvelte.addInitScript(seedPrng);

    const targetUrlMirror = new URL(route, MIRROR_URL).href;
    const targetUrlNative = new URL(route, NATIVE_URL).href;
    const targetUrlSvelte = new URL(route, SVELTE_URL).href;

    console.log(`  Auditing Route "${route}" @ ${vp.label}...`);

    const [resMirror, resNative, resSvelte] = await Promise.all([
      pageMirror.goto(targetUrlMirror, { waitUntil: 'load', timeout: 30000 }),
      pageNative.goto(targetUrlNative, { waitUntil: 'load', timeout: 30000 }),
      pageSvelte.goto(targetUrlSvelte, { waitUntil: 'load', timeout: 30000 })
    ]);

    if (!resSvelte || resSvelte.status() >= 400 || resSvelte.status() !== (resNative?.status() ?? 200)) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'HTTP Status',
        error: `Mirror=${resMirror?.status()} Native=${resNative?.status()} vs Svelte=${resSvelte?.status()}`
      });
    }

    await Promise.all([pageMirror.waitForTimeout(300), pageNative.waitForTimeout(300), pageSvelte.waitForTimeout(300)]);
    await Promise.all([
      pageMirror.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { }),
      pageNative.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { }),
      pageSvelte.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { })
    ]);
    await Promise.all([
      pageMirror.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => { }),
      pageNative.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => { }),
      pageSvelte.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => { })
    ]);
    await Promise.all([
      pageMirror.evaluate(() => document.fonts?.ready).catch(() => { }),
      pageNative.evaluate(() => document.fonts?.ready).catch(() => { }),
      pageSvelte.evaluate(() => document.fonts?.ready).catch(() => { })
    ]);
    await Promise.all([pageMirror.waitForTimeout(600), pageNative.waitForTimeout(600), pageSvelte.waitForTimeout(600)]);
    await Promise.all([
      pageMirror.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { }),
      pageNative.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { }),
      pageSvelte.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { })
    ]);

    // Check Horizontal Overflow Leak & Form A11y & Non-Blank Canvas Integrity
    const domIntegrity = await pageSvelte.evaluate(() => {
      const brokenLabels = [];
      const missingAutocomplete = [];
      document.querySelectorAll('label[for]').forEach((label) => {
        const forVal = label.getAttribute('for');
        if (forVal && !document.getElementById(forVal)) brokenLabels.push(forVal);
      });
      document
        .querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea'
        )
        .forEach((input) => {
          if (!input.hasAttribute('autocomplete')) {
            missingAutocomplete.push(input.getAttribute('name') || input.getAttribute('id') || input.tagName);
          }
        });
      const overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const canvasCount = document.querySelectorAll('canvas').length;
      return { brokenLabels, missingAutocomplete, overflowX, canvasCount };
    });

    const nativeCanvasCount = await pageNative.evaluate(() => document.querySelectorAll('canvas').length);
    if (nativeCanvasCount > 0 && domIntegrity.canvasCount < nativeCanvasCount) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Canvas Element Parity',
        error: `Baseline has ${nativeCanvasCount} <canvas> element(s), Svelte rendered only ${domIntegrity.canvasCount}.`
      });
    }
    if (domIntegrity.overflowX > 2) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Horizontal Overflow',
        error: `Horizontal scroll leak of ${domIntegrity.overflowX}px detected.`
      });
    }
    if (domIntegrity.brokenLabels.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Form Label Association',
        error: `Broken label[for]: ${domIntegrity.brokenLabels.join(', ')}`
      });
    }
    if (domIntegrity.missingAutocomplete.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Form Autocomplete',
        error: `Missing autocomplete on: ${domIntegrity.missingAutocomplete.join(', ')}`
      });
    }

    // Gate 5A: Interactive Disclosure / Accordion Behavioral Check (Desktop)
    if (vp.width >= 1024) {
      const disclosureTest = await pageSvelte.evaluate(async () => {
        const btn = document.querySelector('button[aria-expanded]');
        if (!btn) return { tested: false, ok: true };
        const before = btn.getAttribute('aria-expanded');
        btn.click();
        await new Promise((r) => setTimeout(r, 120));
        const after = btn.getAttribute('aria-expanded');
        if (after !== before) {
          // Restore initial state cleanly before visual comparison
          btn.click();
          await new Promise((r) => setTimeout(r, 120));
          return { tested: true, ok: true };
        }
        return { tested: true, ok: false, selector: btn.id || btn.textContent?.trim()?.slice(0, 30) };
      });
      if (disclosureTest.tested && !disclosureTest.ok) {
        parityErrors.push({
          route,
          viewport: vp.label,
          metric: 'Interactive Disclosure Behavior',
          error: `Clicking button[aria-expanded] (${disclosureTest.selector}) did not toggle aria-expanded!`
        });
      }
    }

    // Scroll Height Delta against BOTH Stage 1 (:3011) and Stage 0 Mirror (:3010)
    const [scrollHeightMirror, scrollHeightNative, scrollHeightSvelte] = await Promise.all([
      pageMirror.evaluate(() => document.documentElement.scrollHeight),
      pageNative.evaluate(() => document.documentElement.scrollHeight),
      pageSvelte.evaluate(() => document.documentElement.scrollHeight)
    ]);
    const scrollDelta = Math.abs(scrollHeightNative - scrollHeightSvelte);
    const scrollDeltaMirror = Math.abs(scrollHeightMirror - scrollHeightSvelte);
    console.log(
      `    Scroll Height: Mirror=${scrollHeightMirror}px | Native=${scrollHeightNative}px | Svelte=${scrollHeightSvelte}px | Delta(Native)=${scrollDelta}px | Delta(Mirror)=${scrollDeltaMirror}px`
    );
    if (scrollDelta > MAX_SCROLL_DELTA || scrollDeltaMirror > MAX_SCROLL_DELTA) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Scroll Height (Dual Baseline)',
        error: `Mirror=${scrollHeightMirror}px Native=${scrollHeightNative}px vs Svelte=${scrollHeightSvelte}px`
      });
    }

    // Semantic Landmark Bounding Box Parity
    const landmarks = ['header', 'main', 'footer', 'nav', 'h1'];
    let maxLandmarkDelta = 0;
    for (const tag of landmarks) {
      const [boxNative, boxSvelte] = await Promise.all([
        pageNative.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
        }, tag),
        pageSvelte.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) };
        }, tag)
      ]);

      if (boxNative && !boxSvelte) {
        parityErrors.push({
          route,
          viewport: vp.label,
          metric: `Missing Landmark <${tag}>`,
          error: `Baseline has <${tag}>, Svelte page has none.`
        });
      } else if (boxNative && boxSvelte) {
        const topDelta = Math.abs(boxNative.top - boxSvelte.top);
        const heightDelta = Math.abs(boxNative.height - boxSvelte.height);
        maxLandmarkDelta = Math.max(maxLandmarkDelta, topDelta, heightDelta);
        if (topDelta > MAX_LANDMARK_DELTA || heightDelta > MAX_LANDMARK_DELTA) {
          parityErrors.push({
            route,
            viewport: vp.label,
            metric: `Landmark <${tag}>`,
            error: `Native(top=${boxNative.top}, h=${boxNative.height}) vs Svelte(top=${boxSvelte.top}, h=${boxSvelte.height})`
          });
        }
      }
    }
    console.log(`    Landmark Max Delta: ${maxLandmarkDelta}px`);

    // Gate 5B: Real Measured Kinetic Scroll-Scrub Trajectory Comparison (0%, 20%, 40%, 60%, 80%, 100%)
    let kineticMismatches = 0;
    for (const prog of [0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
      await Promise.all([
        pageNative.evaluate((p) => {
          window.scrollTo(0, Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * p));
        }, prog),
        pageSvelte.evaluate((p) => {
          window.scrollTo(0, Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * p));
        }, prog)
      ]);
      await Promise.all([pageNative.waitForTimeout(80), pageSvelte.waitForTimeout(80)]);

      const [kinN, kinS] = await Promise.all([
        sampleScrollKinematics(pageNative),
        sampleScrollKinematics(pageSvelte)
      ]);
      const count = Math.min(kinN.length, kinS.length);
      for (let i = 0; i < count; i++) {
        if (Math.abs(kinN[i].top - kinS[i].top) > 6 || Math.abs(kinN[i].opacity - kinS[i].opacity) > 0.2) {
          kineticMismatches++;
        }
      }
    }
    if (kineticMismatches > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Kinetic Scroll-Scrub Trajectory',
        error: `Detected ${kineticMismatches} element position/opacity scroll-scrub divergence(s).`
      });
    } else {
      console.log(`    ✓ Kinetic scroll-scrub trajectory measured & verified (0 drift).`);
    }

    // Gate 4: Dual-Baseline Unmasked Multi-Stop Pixelmatch Screenshot Comparison (0%, 25%, 50%, 75%, 100%)
    for (const pct of [0, 0.25, 0.5, 0.75, 1.0]) {
      await Promise.all([
        pageMirror.evaluate((p) => {
          window.scrollTo(0, Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * p));
        }, pct),
        pageNative.evaluate((p) => {
          window.scrollTo(0, Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * p));
        }, pct),
        pageSvelte.evaluate((p) => {
          window.scrollTo(0, Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * p));
        }, pct)
      ]);
      await Promise.all([pageMirror.waitForTimeout(200), pageNative.waitForTimeout(200), pageSvelte.waitForTimeout(200)]);
      if (pct > 0) {
        await Promise.all([
          pageMirror.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { }),
          pageNative.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { }),
          pageSvelte.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { })
        ]);
        await Promise.all([pageMirror.waitForTimeout(200), pageNative.waitForTimeout(200), pageSvelte.waitForTimeout(200)]);
        await Promise.all([
          pageMirror.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1200)).catch(() => { }),
          pageNative.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1200)).catch(() => { }),
          pageSvelte.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1200)).catch(() => { })
        ]);
      }
      await Promise.all([stabilizePageUnmasked(pageMirror), stabilizePageUnmasked(pageNative), stabilizePageUnmasked(pageSvelte)]);
      await Promise.all([pageMirror.mouse.move(0, 0), pageNative.mouse.move(0, 0), pageSvelte.mouse.move(0, 0)]);
      await Promise.all([pageMirror.waitForTimeout(100), pageNative.waitForTimeout(100), pageSvelte.waitForTimeout(100)]);

      let shotMirror;
      let shotNative;
      let shotSvelte;
      try {
        await pageMirror.bringToFront();
        shotMirror = await pageMirror.screenshot({ fullPage: false, timeout: 8000 });
        await pageNative.bringToFront();
        shotNative = await pageNative.screenshot({ fullPage: false, timeout: 8000 });
        await pageSvelte.bringToFront();
        shotSvelte = await pageSvelte.screenshot({ fullPage: false, timeout: 8000 });
      } catch (shotErr) {
        parityErrors.push({
          route,
          viewport: vp.label,
          metric: `Screenshot @ ${Math.round(pct * 100)}%`,
          error: shotErr.message.split('\n')[0]
        });
        continue;
      }

      const pngMirror = PNG.sync.read(shotMirror);
      const pngNative = PNG.sync.read(shotNative);
      const pngSvelte = PNG.sync.read(shotSvelte);
      const width = Math.min(pngMirror.width, pngNative.width, pngSvelte.width);
      const height = Math.min(pngMirror.height, pngNative.height, pngSvelte.height);
      const diffNative = new PNG({ width, height });
      const diffMirror = new PNG({ width, height });

      const mismatchedNative = pixelmatch(pngNative.data, pngSvelte.data, diffNative.data, width, height, { threshold: 0.1 });
      const mismatchedMirror = pixelmatch(pngMirror.data, pngSvelte.data, diffMirror.data, width, height, { threshold: 0.1 });

      const totalPixels = width * height;
      const diffRatio = mismatchedNative / totalPixels;
      const diffRatioMirror = mismatchedMirror / totalPixels;

      const safeRoute = route.replace(/\//g, '_') || '_root';
      const diffFile = path.join(OUT_DIR, `diff-${safeRoute}-${vp.label}-${Math.round(pct * 100)}.png`);
      const diffMirrorFile = path.join(OUT_DIR, `diff-vs-mirror-${safeRoute}-${vp.label}-${Math.round(pct * 100)}.png`);
      if (diffRatio > THRESHOLD) fs.writeFileSync(diffFile, PNG.sync.write(diffNative));
      if (diffRatioMirror > THRESHOLD) fs.writeFileSync(diffMirrorFile, PNG.sync.write(diffMirror));

      console.log(
        `    Scroll ${Math.round(pct * 100)}%: Diff(vs Native)=${(diffRatio * 100).toFixed(3)}% | Diff(vs Mirror)=${(diffRatioMirror * 100).toFixed(3)}%`
      );

      comparisons.push({
        route,
        viewport: vp.label,
        scrollPercent: Math.round(pct * 100),
        diffPercent: Number((diffRatio * 100).toFixed(4)),
        diffPercentMirror: Number((diffRatioMirror * 100).toFixed(4)),
        scrollDelta,
        scrollDeltaMirror,
        maxLandmarkDelta
      });

      if (diffRatio > THRESHOLD) {
        parityErrors.push({
          route,
          viewport: vp.label,
          metric: `Unmasked Visual Diff vs Native @ ${Math.round(pct * 100)}%`,
          error: `Diff ${(diffRatio * 100).toFixed(3)}% exceeded ${(THRESHOLD * 100).toFixed(2)}% threshold (${diffFile})`
        });
      }
      if (diffRatioMirror > THRESHOLD) {
        parityErrors.push({
          route,
          viewport: vp.label,
          metric: `Unmasked Visual Diff vs Mirror @ ${Math.round(pct * 100)}%`,
          error: `Diff ${(diffRatioMirror * 100).toFixed(3)}% exceeded ${(THRESHOLD * 100).toFixed(2)}% threshold (${diffMirrorFile})`
        });
      }
    }

    // Gate 5C: Site-Agnostic Living Canvas, Smooth Scroll & Mount-Reveal Parity (Desktop, with live RAF unfrozen!)
    if (vp.width >= 1024) {
      await Promise.all([
        pageMirror.evaluate(() => { window.scrollTo(0, 0); window.__AGY_UNFREEZE_CLOCK__?.(); }).catch(() => { }),
        pageNative.evaluate(() => { window.scrollTo(0, 0); window.__AGY_UNFREEZE_CLOCK__?.(); }).catch(() => { }),
        pageSvelte.evaluate(() => { window.scrollTo(0, 0); window.__AGY_UNFREEZE_CLOCK__?.(); }).catch(() => { })
      ]);
      await Promise.all([pageMirror.waitForTimeout(200), pageNative.waitForTimeout(200), pageSvelte.waitForTimeout(200)]);
      const living = await auditKineticAndLivingSurface({
        page: pageSvelte,
        route,
        forensicsDir,
        mirrorPage: pageMirror
      });
      console.log(
        `    🎨 Gate 5 Living Surface: canvases=${living.summary.activeCanvases}/${living.summary.canvasCount}, rafDelta=${living.summary.rafDelta}, reveals=${living.summary.mountRevealsChecked}, controls=${living.summary.testedControls}`
      );
      for (const lf of living.failures) {
        parityErrors.push({
          route,
          viewport: vp.label,
          metric: 'Gate 5 Living Surface',
          error: lf
        });
      }
    }

    // Runtime Errors, HTTP >= 400s, Air-Gap Escapes & CDP Issues (checked AFTER full scroll & interaction!)
    if (svelteFailedRequests.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'HTTP >= 400 Subresource Error',
        error: svelteFailedRequests.slice(0, 5).join(' | ')
      });
    }
    if (svelteEscapedExternal.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'External Network Escape',
        error: svelteEscapedExternal.slice(0, 5).join(' | ')
      });
    }
    if (sveltePageErrors.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Uncaught Client PageError',
        error: sveltePageErrors.join(' | ')
      });
    }
    if (svelteConsoleErrors.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Console Error / A11y Violation',
        error: svelteConsoleErrors.join(' | ')
      });
    }

    const actionableCdp = cdpIssues.filter((i) => {
      const d = i?.issue?.details || i;
      return Boolean(d?.lazyLoadImageIssueDetails || d?.stylesheetLoadingIssueDetails);
    });
    if (actionableCdp.length > 0) {
      parityErrors.push({
        route,
        viewport: vp.label,
        metric: 'Chrome CDP Audit (CLS / Stylesheet)',
        error: JSON.stringify(actionableCdp[0]?.issue?.details || actionableCdp[0])
      });
    }

    await contextMirror.close();
    await contextNative.close();
    await contextSvelte.close();
  }
}

await browser.close();

fs.writeFileSync(
  path.join(OUT_DIR, 'stage2-parity-report.json'),
  JSON.stringify({ passed: parityErrors.length === 0 && !ALLOW_PARTIAL, comparisons, parityErrors }, null, 2),
  'utf8'
);

if (ALLOW_PARTIAL) {
  console.error(`\n⚠️ PARTIAL DEBUG RUN (--allow-partial-routes): Stage 2 cannot be certified until 100% of routes pass.`);
  process.exit(1);
}

if (parityErrors.length > 0) {
  console.error(`\n❌ Gates 4/5 FAILED: Detected ${parityErrors.length} parity/behavioral violation(s):`);
  for (const pe of parityErrors) {
    console.error(`  - [${pe.route} @ ${pe.viewport}] ${pe.metric}: ${pe.error}`);
  }
  process.exit(1);
} else {
  if (!comparisons.length) throw Error('No browser comparisons completed');
  mintStageCert({stage:2,dir:SVELTE_DIR,routes:ROUTES,summary:{comparisons:comparisons.length,productionBuild:true}});
  console.log(`\n🎉 ALL 5 NUCLEAR GATES PASSED: Stage 2 Svelte 5 + SvelteKit 3.2 certified with 100% unmasked visual, kinetic & behavioral parity!`);
  process.exit(0);
}
