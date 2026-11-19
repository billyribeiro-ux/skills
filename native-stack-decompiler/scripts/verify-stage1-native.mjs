#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { verifyReconstruction } from './continue-native.mjs';
import { assertStageCertified, invalidateStageCert, mintStageCert } from '../../shared/pipeline-gate.mjs';
import { auditKineticAndLivingSurface, installKineticObserver } from '../../shared/kinetic-verifier.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_URL = getArg('--mirror', 'http://localhost:3010');
const NATIVE_URL = getArg('--native', 'http://localhost:3011');
const MIRROR_DIR = path.resolve(getArg('--mirror-dir', './00-mirror'));
const NATIVE_DIR = path.resolve(getArg('--native-dir', './01-native'));
const REPORT_DIR = path.resolve(getArg('--report-dir', path.join(NATIVE_DIR, 'forensics', 'parity-reports')));
const ALLOW_PARTIAL = args.includes('--allow-partial-routes');

// Auto-discover 100% of captured routes from Stage 0 routes-manifest.json
const routesManifestPath = path.join(MIRROR_DIR, 'forensics', 'routes-manifest.json');
let manifestRoutes = ['/'];
if (fs.existsSync(routesManifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(routesManifestPath, 'utf8'));
    if (Array.isArray(manifest.routes) && manifest.routes.length > 0) {
      manifestRoutes = manifest.routes.map((r) => (typeof r === 'string' ? r : r.route));
    }
  } catch { }
}

const explicitRoutes = getArg('--routes', '');
const ROUTES = explicitRoutes
  ? explicitRoutes.split(',').map((r) => r.trim()).filter(Boolean)
  : manifestRoutes;

if (explicitRoutes && !ALLOW_PARTIAL) {
  const missingFromAudit = manifestRoutes.filter((mr) => !ROUTES.includes(mr));
  if (missingFromAudit.length > 0) {
    console.error(
      `❌ [NUCLEAR GATE FAIL] Partial route audit forbidden! Missing captured route(s): ${missingFromAudit.join(', ')}`
    );
    console.error(`   Omit --routes to audit all ${manifestRoutes.length} routes, or pass --allow-partial-routes for local debug only.`);
    process.exit(1);
  }
}

fs.mkdirSync(REPORT_DIR, { recursive: true });

async function runGate1CodeQuality() {
  console.log(`\n============================================================`);
  console.log(`GATE 1: Deterministic Author-Grade Code Quality & Anti-Chunk Gate`);
  console.log(`============================================================`);

  const qualityScript = path.join(__dirname, 'verify-human-code-quality.mjs');
  const srcDir = path.join(NATIVE_DIR, 'src');

  if (!fs.existsSync(srcDir)) {
    console.error(`❌ [GATE 1 FAIL] ${srcDir} does not exist! Stage 1 cannot pass without decoded source in src/.`);
    return false;
  }

  return new Promise((resolve) => {
    const child = fork(qualityScript, ['--src-dir', srcDir], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code === 0));
  });
}

const VIEWPORTS = [
  { width: 1440, height: 900, name: 'desktop', isMobile: false, hasTouch: false },
  { width: 768, height: 1024, name: 'tablet', isMobile: false, hasTouch: true },
  { width: 390, height: 844, name: 'mobile', isMobile: true, hasTouch: true }
];

const SCROLL_CHECKPOINTS = [0.0, 0.25, 0.5, 0.75, 1.0];
const FORBIDDEN_SCRIPT_URL = /(?:\/_next\/static\/|\/_astro\/|\/_nuxt\/|(?:webpack|turbopack|chunk-)[^/]*\.m?js|\.(?:min|built)\.m?js)/i;

const TELEMETRY_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'clarity.ms',
  'hotjar.com',
  'umami.is',
  'segment.io',
  'cookiebot.com',
  'consentcdn.cookiebot.com',
  'hs-scripts.com',
  'snitcher.com',
  'trysurface',
  'posthog',
  'r.stripe.com',
  'm.stripe.com',
  'm.stripe.network',
  'q.stripe.com',
  'errors.stripe.com'
];

async function inspectSurface(page, expectedOrigin, checkScriptProvenance) {
  const errors = [];
  const failedRequests = [];
  const escapedExternal = [];
  const forbiddenScripts = [];
  const cdpIssues = [];

  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Audits.enable');
    client.on('Audits.issueAdded', (issue) => cdpIssues.push(issue));
  } catch { }

  await page.addInitScript(() => {
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
  });

  await page.route('**/*', (route) => {
    const req = route.request();
    const u = req.url();
    if (!u.startsWith(expectedOrigin) && !u.startsWith('data:') && !u.startsWith('blob:')) {
      if (TELEMETRY_HOSTS.some((t) => u.includes(t))) {
        return route.fulfill({
          status: 200,
          body: '/* telemetry noop */',
          contentType: 'application/javascript; charset=utf-8'
        });
      }
      escapedExternal.push(u);
      return route.abort('failed');
    }
    if (checkScriptProvenance && req.resourceType() === 'script' && FORBIDDEN_SCRIPT_URL.test(u)) {
      forbiddenScripts.push(u);
      return route.abort('failed');
    }
    return route.continue();
  });

  page.on('pageerror', (err) => errors.push(`PageError: ${err.message}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(`ConsoleError: ${text}`);
    else if (text.includes('Missing i18n key') || text.includes('Blocked aria-hidden')) {
      errors.push(`[A11y/i18n violation] ${text}`);
    }
  });

  page.on('response', (res) => {
    if (TELEMETRY_HOSTS.some((t) => res.url().includes(t))) return;
    if (res.status() >= 400) {
      failedRequests.push(`${res.status()} ${res.url()}`);
    }
  });

  return { errors, failedRequests, escapedExternal, forbiddenScripts, cdpIssues };
}

/**
 * Deterministic frame stabilization WITHOUT hiding canvases or videos!
 */
async function stabilizeForScreenshot(page) {
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

async function sampleKineticScrollState(page) {
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
          position: cs.position,
          opacity: Number(parseFloat(cs.opacity).toFixed(2)),
          transform: cs.transform
        };
      });
  });
}

async function run() {
  console.log(`⚖️ Starting Stage 1 Nuclear Dual-Gate Verification System`);
  console.log(`  Mirror URL: ${MIRROR_URL}`);
  console.log(`  Native URL: ${NATIVE_URL}`);
  console.log(`  Mirror Dir: ${MIRROR_DIR}`);
  console.log(`  Native Dir: ${NATIVE_DIR}`);
  console.log(`  Routes:     ${ROUTES.join(', ')}`);

  // Invalidate stale Stage 1 cert immediately & require certified Stage 0 mirror
  invalidateStageCert(1, NATIVE_DIR);
  const mirrorCert = assertStageCertified({ requiredStage: 0, dir: MIRROR_DIR, callerName: 'verify-stage1-native.mjs' });
  const ledger = JSON.parse(fs.readFileSync(path.join(NATIVE_DIR,'forensics','source-recovery.json'),'utf8'));
  if (ledger.runtimeStatus === 'reconstructed-runtime') {
    verifyReconstruction(fs.realpathSync(NATIVE_DIR), fs.realpathSync(MIRROR_DIR), ledger, mirrorCert);
  } else if (!['source-built-runtime','static-route-runtime'].includes(ledger.runtimeStatus)) {
    throw new Error('Native runtime remains incomplete. See forensics/source-recovery.json for unresolved modules and scripts.');
  }

  // Verify both servers return HTTP 200 OK
  for (const [label, url] of [
    ['Stage 0 Mirror', MIRROR_URL],
    ['Stage 1 Native', NATIVE_URL]
  ]) {
    try {
      const res = await fetch(new URL(ROUTES[0] || '/', url).href, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) {
        console.error(`❌ ${label} (${url}) returned HTTP ${res.status} (must be 200 OK).`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`❌ ${label} (${url}) is offline: ${err.message}`);
      process.exit(1);
    }
  }

  // DUAL GATE 1: Code Quality & Zero-Chunk AST Gate
  const codeQualityPassed = await runGate1CodeQuality();
  if (!codeQualityPassed) {
    console.error(`💥 STAGE 1 REJECTED: Gate 1 (Author-Grade Code Quality & Anti-Chunk Gate) failed.`);
    process.exit(1);
  }

  // DUAL GATE 2: Unmasked Visual, Kinetic & Living Surface Parity
  console.log(`\n============================================================`);
  console.log(`GATE 2: Unmasked Visual, Kinetic & Living Parity (:3010 vs :3011)`);
  console.log(`============================================================`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });
  let totalFailures = 0;
  const parityMetrics = [];
  const livingViolations = [];
  const mirrorOrigin = new URL(MIRROR_URL).origin;
  const nativeOrigin = new URL(NATIVE_URL).origin;
  const mirrorForensicsDir = path.join(MIRROR_DIR, 'forensics');

  for (const route of ROUTES) {
    const mirrorTarget = new URL(route, MIRROR_URL).href;
    const nativeTarget = new URL(route, NATIVE_URL).href;

    console.log(`\nVerifying Route: ${route}`);

    for (const vp of VIEWPORTS) {
      console.log(`  📱 Viewport: ${vp.name} (${vp.width}x${vp.height})`);

      const mirrorCtx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch
      });
      const nativeCtx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch
      });

      const mirrorPage = await mirrorCtx.newPage();
      const nativePage = await nativeCtx.newPage();

      await installKineticObserver(nativePage);
      await inspectSurface(mirrorPage, mirrorOrigin, false);
      const nativeMonitor = await inspectSurface(nativePage, nativeOrigin, true);

      const [resM, resN] = await Promise.all([
        mirrorPage.goto(mirrorTarget, { waitUntil: 'load', timeout: 45000 }),
        nativePage.goto(nativeTarget, { waitUntil: 'load', timeout: 45000 })
      ]);

      if (!resN || resN.status() !== (resM?.status() ?? 200)) {
        console.error(`    ❌ HTTP Status mismatch: Mirror=${resM?.status()} vs Native=${resN?.status()}`);
        totalFailures++;
      }

      await Promise.all([mirrorPage.waitForTimeout(300), nativePage.waitForTimeout(300)]);
      await Promise.all([
        mirrorPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { }),
        nativePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { })
      ]);
      await Promise.all([
        mirrorPage.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => { }),
        nativePage.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => { })
      ]);
      await Promise.all([
        mirrorPage.evaluate(() => document.fonts?.ready).catch(() => { }),
        nativePage.evaluate(() => document.fonts?.ready).catch(() => { })
      ]);
      await Promise.all([mirrorPage.waitForTimeout(600), nativePage.waitForTimeout(600)]);
      await Promise.all([
        mirrorPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { }),
        nativePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { })
      ]);

      // 1. Real Kinetic Scroll-Scrub Trajectory Verification (0%, 20%, 40%, 60%, 80%, 100%)
      const [mirrorHeight, nativeHeight] = await Promise.all([
        mirrorPage.evaluate(() => document.documentElement.scrollHeight),
        nativePage.evaluate(() => document.documentElement.scrollHeight)
      ]);
      const heightDelta = Math.abs(mirrorHeight - nativeHeight);
      console.log(`    Scroll Height: Mirror=${mirrorHeight}px | Native=${nativeHeight}px | Delta=${heightDelta}px`);
      if (heightDelta > 2) {
        console.error(`    ❌ Scroll height delta ${heightDelta}px exceeded 2px threshold!`);
        totalFailures++;
      }

      let kineticDriftCount = 0;
      for (const prog of [0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
        const yM = Math.round(Math.max(0, mirrorHeight - vp.height) * prog);
        const yN = Math.round(Math.max(0, nativeHeight - vp.height) * prog);
        await Promise.all([
          mirrorPage.evaluate((y) => window.scrollTo(0, y), yM),
          nativePage.evaluate((y) => window.scrollTo(0, y), yN)
        ]);
        await Promise.all([mirrorPage.waitForTimeout(80), nativePage.waitForTimeout(80)]);

        const [stateM, stateN] = await Promise.all([
          sampleKineticScrollState(mirrorPage),
          sampleKineticScrollState(nativePage)
        ]);
        kineticDriftCount += Math.abs(stateM.length - stateN.length);
        const len = Math.min(stateM.length, stateN.length);
        for (let i = 0; i < len; i++) {
          if (
            stateM[i].tag !== stateN[i].tag || Math.abs(stateM[i].top - stateN[i].top) > 4 ||
            Math.abs(stateM[i].opacity - stateN[i].opacity) > 0.15
          ) {
            kineticDriftCount++;
          }
        }
      }
      if (kineticDriftCount > 0) {
        console.error(`    ❌ Kinetic scroll-scrub state drift detected (${kineticDriftCount} element/checkpoint mismatches)!`);
        totalFailures++;
      } else {
        console.log(`    ✓ Kinetic scroll-scrub trajectory measured & verified (0 drift).`);
      }

      // Reset to top & check landmarks (<= 1px)
      await Promise.all([
        mirrorPage.evaluate(() => window.scrollTo(0, 0)),
        nativePage.evaluate(() => window.scrollTo(0, 0))
      ]);
      await Promise.all([stabilizeForScreenshot(mirrorPage), stabilizeForScreenshot(nativePage)]);
      await Promise.all([mirrorPage.waitForTimeout(200), nativePage.waitForTimeout(200)]);

      const landmarkQuery = 'header, nav, main, section, footer, h1, h2';
      const [mirrorLandmarks, nativeLandmarks] = await Promise.all([
        mirrorPage.evaluate((q) =>
          Array.from(document.querySelectorAll(q)).map((el) => {
            const r = el.getBoundingClientRect();
            return { tag: el.tagName, top: Math.round(r.top), height: Math.round(r.height) };
          }),
          landmarkQuery),
        nativePage.evaluate((q) =>
          Array.from(document.querySelectorAll(q)).map((el) => {
            const r = el.getBoundingClientRect();
            return { tag: el.tagName, top: Math.round(r.top), height: Math.round(r.height) };
          }),
          landmarkQuery)
      ]);

      if (nativeLandmarks.length !== mirrorLandmarks.length) { console.error('Landmark count differs'); totalFailures++; }
      let landmarkMaxDelta = 0;
      const lmCount = Math.min(mirrorLandmarks.length, nativeLandmarks.length);
      for (let i = 0; i < lmCount; i++) {
        landmarkMaxDelta = Math.max(
          landmarkMaxDelta,
          Math.abs(mirrorLandmarks[i].top - nativeLandmarks[i].top),
          Math.abs(mirrorLandmarks[i].height - nativeLandmarks[i].height)
        );
      }
      console.log(`    Landmark Max Delta: ${landmarkMaxDelta}px`);
      if (landmarkMaxDelta > 1) {
        console.error(`    ❌ Landmark position delta ${landmarkMaxDelta}px exceeded 1px threshold!`);
        totalFailures++;
      }

      // 2. Unmasked Pixelmatch Visual Diff across scroll stops (<= 0.2%)
      for (const ratio of SCROLL_CHECKPOINTS) {
        const mirrorY = Math.round(Math.max(0, mirrorHeight - vp.height) * ratio);
        const nativeY = Math.round(Math.max(0, nativeHeight - vp.height) * ratio);

        await Promise.all([
          mirrorPage.evaluate((y) => window.scrollTo(0, y), mirrorY),
          nativePage.evaluate((y) => window.scrollTo(0, y), nativeY)
        ]);
        await Promise.all([mirrorPage.waitForTimeout(200), nativePage.waitForTimeout(200)]);
        if (mirrorY > 0 || nativeY > 0) {
          await Promise.all([
            mirrorPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { }),
            nativePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { })
          ]);
          await Promise.all([mirrorPage.waitForTimeout(200), nativePage.waitForTimeout(200)]);
          await Promise.all([
            mirrorPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1200)).catch(() => { }),
            nativePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1200)).catch(() => { })
          ]);
        }
        await Promise.all([stabilizeForScreenshot(mirrorPage), stabilizeForScreenshot(nativePage)]);
        await Promise.all([mirrorPage.waitForTimeout(100), nativePage.waitForTimeout(100)]);

        await mirrorPage.bringToFront();
        const mirrorShot = await mirrorPage.screenshot({ timeout: 60000 });
        await nativePage.bringToFront();
        const nativeShot = await nativePage.screenshot({ timeout: 60000 });
        const imgMirror = PNG.sync.read(mirrorShot);
        const imgNative = PNG.sync.read(nativeShot);
        const diff = new PNG({ width: vp.width, height: vp.height });

        const mismatchedPixels = pixelmatch(
          imgMirror.data,
          imgNative.data,
          diff.data,
          vp.width,
          vp.height,
          { threshold: 0.1 }
        );

        const totalPixels = vp.width * vp.height;
        const diffRatio = (mismatchedPixels / totalPixels) * 100;
        console.log(`    Scroll ${Math.round(ratio * 100)}%: Unmasked Diff = ${diffRatio.toFixed(3)}% (${mismatchedPixels} px)`);

        parityMetrics.push({
          route,
          viewport: vp.name,
          scrollRatio: ratio,
          diffPercent: Number(diffRatio.toFixed(4)),
          mismatchedPixels
        });

        if (diffRatio > 0.2) {
          const safeRoute = route.replace(/\//g, '_') || 'root';
          const diffFile = path.join(REPORT_DIR, `diff-${safeRoute}-${vp.name}-${Math.round(ratio * 100)}.png`);
          fs.writeFileSync(diffFile, PNG.sync.write(diff));
          console.error(`    ❌ Visual diff ${diffRatio.toFixed(2)}% exceeded 0.2% threshold! Saved: ${diffFile}`);
          totalFailures++;
        }
      }

      // 3. Living Canvas, Smooth Scroll & Interactive Contracts Audit (Desktop, with live RAF unfrozen!)
      if (vp.name === 'desktop') {
        await Promise.all([
          mirrorPage.evaluate(() => { window.scrollTo(0, 0); window.__AGY_UNFREEZE_CLOCK__?.(); }).catch(() => { }),
          nativePage.evaluate(() => { window.scrollTo(0, 0); window.__AGY_UNFREEZE_CLOCK__?.(); }).catch(() => { })
        ]);
        await Promise.all([mirrorPage.waitForTimeout(200), nativePage.waitForTimeout(200)]);
        const living = await auditKineticAndLivingSurface({
          page: nativePage,
          route,
          forensicsDir: mirrorForensicsDir,
          mirrorPage
        });
        console.log(
          `    🎨 Living Surface: canvases=${living.summary.activeCanvases}/${living.summary.canvasCount}, rafDelta=${living.summary.rafDelta}, revealsChecked=${living.summary.mountRevealsChecked}, controls=${living.summary.testedControls}`
        );
        for (const lf of living.failures) {
          console.error(`    ❌ [LIVING GATE FAIL] ${lf}`);
          livingViolations.push({ route, error: lf });
          totalFailures++;
        }
      }

      // 4. Anti-Chunk Network Provenance, Errors, 404s, Escapes & CDP Audits
      if (nativeMonitor.forbiddenScripts.length > 0) {
        console.error(`    ❌ [CHUNK_BYPASS_DETECTED] Native server attempted to load mirrored chunks:`, nativeMonitor.forbiddenScripts);
        totalFailures++;
      }
      if (nativeMonitor.escapedExternal.length > 0) {
        console.error(`    ❌ Escaped external requests on Native app:`, nativeMonitor.escapedExternal);
        totalFailures++;
      }
      if (nativeMonitor.failedRequests.length > 0) {
        console.error(`    ❌ HTTP >= 400 errors on Native app:`, nativeMonitor.failedRequests);
        totalFailures++;
      }
      if (nativeMonitor.errors.length > 0) {
        console.error(`    ❌ Runtime/console errors on Native app:`, nativeMonitor.errors);
        totalFailures++;
      }

      const actionableCdpIssues = (nativeMonitor.cdpIssues || []).filter((i) => {
        const d = i?.issue?.details || i;
        return Boolean(d?.stylesheetLoadingIssueDetails || d?.lazyLoadImageIssueDetails);
      });
      if (actionableCdpIssues.length > 0) {
        console.error(
          `    ❌ CDP Audit Issues on Native app (${actionableCdpIssues.length}):`,
          JSON.stringify(actionableCdpIssues[0]?.issue?.details || actionableCdpIssues[0])
        );
        totalFailures++;
      }

      await mirrorCtx.close();
      await nativeCtx.close();
    }
  }

  await browser.close();

  fs.writeFileSync(
    path.join(REPORT_DIR, '01-native-parity-report.json'),
    JSON.stringify(
      {
        passed: totalFailures === 0 && !ALLOW_PARTIAL,
        failures: totalFailures,
        livingViolations,
        metrics: parityMetrics
      },
      null,
      2
    ),
    'utf8'
  );

  if (ALLOW_PARTIAL) {
    console.error(`⚠️ PARTIAL DEBUG RUN (--allow-partial-routes): Cannot certify Stage 1 until all routes are audited.`);
    process.exit(1);
  }

  console.log(`\n============================================================`);
  if (totalFailures > 0) {
    console.error(`💥 STAGE 1 DUAL-GATE VERIFICATION FAILED: ${totalFailures} hard-gate violation(s) detected.`);
    process.exit(1);
  } else {
    const cert = mintStageCert({
      stage: 1,
      dir: NATIVE_DIR,
      routes: ROUTES,
      summary: { mirrorUrl: MIRROR_URL, nativeUrl: NATIVE_URL, metricsCount: parityMetrics.length }
    });
    console.log(`🔒 Stage 1 Certificate Minted: ${cert.digest.slice(0, 16)}... (${cert.fileCount} files, ${ROUTES.length} routes)`);
    console.log(`✅ STAGE 1 DUAL-GATE VERIFICATION PASSED: 100% chunk-free author code, living surfaces & unmasked parity confirmed.`);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal Stage 1 verification error:', err);
  process.exit(1);
});
