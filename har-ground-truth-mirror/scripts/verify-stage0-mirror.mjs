#!/usr/bin/env node
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { invalidateStageCert, mintStageCert, manifestRoutes as loadManifestRoutes } from '../../shared/pipeline-gate.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const LIVE_URL = getArg('--live', process.env.LIVE_URL);
const LOCAL_URL = getArg('--local', 'http://localhost:3010');
const MIRROR_DIR = path.resolve(getArg('--mirror-dir', './00-mirror'));
const REPORT_DIR = path.resolve(getArg('--report-dir', path.join(MIRROR_DIR, 'forensics', 'parity-reports')));
const THRESHOLD = parseFloat(getArg('--threshold', '0.12'));
const MAX_DIFF_PERCENT = parseFloat(getArg('--max-diff-pct', '0.5'));
const ALLOW_PARTIAL = args.includes('--allow-partial-routes');

if (!LIVE_URL) {
  console.error(
    'Usage: node verify-stage0-mirror.mjs --live <LIVE_URL> [--local http://localhost:3010] [--routes /,/route2]'
  );
  process.exit(1);
}

// Auto-load ALL captured routes from forensics/routes-manifest.json unless overridden
const explicitRoutes = getArg('--routes', '');
const manifestRoutes = loadManifestRoutes(MIRROR_DIR);

const ROUTES = explicitRoutes
  ? explicitRoutes.split(',').map((r) => r.trim()).filter(Boolean)
  : manifestRoutes;

if (explicitRoutes && !ALLOW_PARTIAL) {
  const missingFromAudit = manifestRoutes.filter((mr) => !ROUTES.includes(mr));
  if (missingFromAudit.length > 0) {
    console.error(
      `❌ [STAGE 0 NUCLEAR GATE FAIL] Partial route audit forbidden! Missing captured route(s): ${missingFromAudit.join(', ')}`
    );
    console.error(`   Omit --routes to audit all ${manifestRoutes.length} routes, or pass --allow-partial-routes for local debug only.`);
    process.exit(1);
  }
}

invalidateStageCert(0, MIRROR_DIR);
fs.mkdirSync(REPORT_DIR, { recursive: true });

const VIEWPORTS = [
  { width: 1440, height: 900, name: 'desktop', isMobile: false, hasTouch: false },
  { width: 768, height: 1024, name: 'tablet', isMobile: false, hasTouch: true },
  { width: 390, height: 844, name: 'mobile', isMobile: true, hasTouch: true }
];

const SCROLL_CHECKPOINTS = [0.0, 0.25, 0.5, 0.75, 1.0];

/**
 * Verifies on-disk HLS (.m3u8) playlists & /__external/ references have ZERO missing child files.
 */
function verifyOfflineStreamAndExternalIntegrity(mirrorDir) {
  const missingChildren = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__sourcemaps__', 'forensics'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.m3u8')) {
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const refs = [];
          if (trimmed.startsWith('#')) {
            for (const m of trimmed.matchAll(/URI="([^"]+)"/g)) refs.push(m[1]);
          } else {
            refs.push(trimmed);
          }
          for (const ref of refs) {
            if (ref.startsWith('http://') || ref.startsWith('https://')) {
              missingChildren.push(`${path.relative(mirrorDir, full)} -> unlocalized remote URI: ${ref}`);
            } else {
              const targetFile = ref.startsWith('/')
                ? path.join(mirrorDir, ref.slice(1))
                : path.resolve(path.dirname(full), ref);
              if (!fs.existsSync(targetFile)) {
                missingChildren.push(`${path.relative(mirrorDir, full)} -> missing segment/playlist: ${ref}`);
              }
            }
          }
        }
      }
    }
  }
  walk(mirrorDir);
  return missingChildren;
}

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

async function inspectSurface(page, isLocalAirgap) {
  const errors = [];
  const failedRequests = [];
  const escapedExternal = [];
  const cdpIssues = [];

  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Audits.enable');
    client.on('Audits.issueAdded', (issue) => {
      cdpIssues.push(issue);
    });
  } catch { }

  // Deterministic canvas-scoped PRNG + target-bounded native-RAF virtual clock — ZERO canvas masking, ZERO video hiding!
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

    let virtualNowMs = 1000;
    try {
      Object.defineProperty(performance, 'now', { value: () => virtualNowMs, configurable: true });
    } catch { }

    const origSetTimeout = window.setTimeout.bind(window);
    const origClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = (fn, delay = 0, ...rest) => {
      if (typeof fn === 'function' && Number(delay) >= 3000) {
        return 900001;
      }
      return origSetTimeout(fn, delay, ...rest);
    };
    window.clearTimeout = (id) => {
      if (typeof id === 'number' && id >= 900001) return;
      return origClearTimeout(id);
    };

    let nextRafId = 1;
    const pendingRafs = new Map();
    let nextIntervalId = 1;
    const intervals = new Map();

    window.setInterval = (fn, delay = 16, ...rest) => {
      const id = nextIntervalId++;
      const ms = Math.max(16, Number(delay) || 16);
      intervals.set(id, { fn, ms, nextAt: virtualNowMs + ms, rest });
      return id;
    };
    window.clearInterval = (id) => {
      intervals.delete(id);
    };

    window.requestAnimationFrame = (cb) => {
      const id = nextRafId++;
      pendingRafs.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pendingRafs.delete(id);
    };
    window.__AGY_ADVANCE_CLOCK__ = (deltaMs = 256) => {
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
    window.__AGY_CLOCK_SETTLED__ = () => true;
  });

  page.on('pageerror', (err) => errors.push(`PageError: ${err.message}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(`ConsoleError: ${text}`);
    else if (text.includes('Missing i18n key') || text.includes('Blocked aria-hidden')) {
      errors.push(`[A11y/i18n violation] ${text}`);
    }
  });

  if (isLocalAirgap) {
    const localOrigin = new URL(LOCAL_URL).origin;
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (!u.startsWith(localOrigin) && !u.startsWith('data:') && !u.startsWith('blob:')) {
        const parsed = new URL(u);
        if (TELEMETRY_HOSTS.some((t) => parsed.hostname.includes(t) || u.includes(t))) {
          return route.fulfill({
            status: 200,
            body: '/* airgap telemetry noop */',
            contentType: 'application/javascript; charset=utf-8'
          });
        }
        escapedExternal.push(u);
        return route.abort('failed');
      }
      return route.continue();
    });
  } else {
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (!u.startsWith('data:') && !u.startsWith('blob:')) {
        try {
          const parsed = new URL(u);
          if (TELEMETRY_HOSTS.some((t) => parsed.hostname.includes(t) || u.includes(t))) {
            return route.fulfill({
              status: 200,
              body: '/* airgap telemetry noop */',
              contentType: 'application/javascript; charset=utf-8'
            });
          }
        } catch { }
      }
      return route.continue();
    });
  }

  page.on('response', (res) => {
    const u = res.url();
    if (TELEMETRY_HOSTS.some((t) => u.includes(t))) return;
    if (res.status() >= 400) {
      failedRequests.push(`${res.status()} ${u}`);
    }
  });

  return { errors, failedRequests, escapedExternal, cdpIssues };
}

/**
 * Deterministic frame stabilization for screenshot parity WITHOUT hiding canvases or videos!
 * Pauses infinite CSS/WAAPI loops at t=0 and seeks active videos to 0.0s while keeping them 100% visible.
 */
async function freezeFrameDeterministically(page) {
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
                const onSeeked = () => {
                  v.removeEventListener('seeked', onSeeked);
                  resolve();
                };
                v.addEventListener('seeked', onSeeked, { once: true });
                v.currentTime = 0;
                setTimeout(resolve, 250);
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

async function run() {
  console.log(`============================================================`);
  console.log(`⚖️  STAGE 0 NUCLEAR HARD-EVIDENCE PARITY GATE (UNMASKED)`);
  console.log(`============================================================`);
  console.log(`  Live URL:   ${LIVE_URL}`);
  console.log(`  Local URL:  ${LOCAL_URL}`);
  console.log(`  Mirror Dir: ${MIRROR_DIR}`);
  console.log(`  Routes:     ${ROUTES.join(', ')}`);

  let totalFailures = 0;
  const comparisons = [];

  // Check 0: Verify Forensics Suite & HLS Stream Completeness on Disk
  const requiredForensics = [
    'stack-fingerprint.json',
    'routes-manifest.json',
    'image-dimensions.json',
    'animations-blueprint.json',
    'kinetic-scroll-matrix.json',
    'interaction-contracts.json',
    'dom-component-blueprint.json',
    'canvas2d-blueprint.json',
    'webgl-shaders.json'
  ];
  for (const reqFile of requiredForensics) {
    const fp = path.join(MIRROR_DIR, 'forensics', reqFile);
    if (!fs.existsSync(fp)) {
      console.error(`❌ Missing mandatory Stage 0 CDP forensic artifact: forensics/${reqFile}`);
      totalFailures++;
    } else {
      try {
        const doc = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (['animations-blueprint.json', 'kinetic-scroll-matrix.json', 'interaction-contracts.json', 'dom-component-blueprint.json', 'canvas2d-blueprint.json'].includes(reqFile) && !ROUTES.every(route => Object.hasOwn(doc.routes || {}, route))) {
          throw new Error('Missing forensic route');
        }
      } catch (error) {
        console.error(reqFile, error.message);
        totalFailures++;
      }
    }
  }

  const capture = JSON.parse(fs.readFileSync(path.join(MIRROR_DIR, 'forensics/routes-manifest.json'), 'utf8'));
  if (capture.captureVersion === 2) {
    const digestMatches = (file, expected) => typeof file === 'string' && fs.existsSync(path.join(MIRROR_DIR, file)) &&
      createHash('sha256').update(fs.readFileSync(path.join(MIRROR_DIR, file))).digest('hex') === expected;
    const maps = JSON.parse(fs.readFileSync(path.join(MIRROR_DIR, 'forensics/source-maps.json'), 'utf8'));
    const assets = JSON.parse(fs.readFileSync(path.join(MIRROR_DIR, 'forensics/assets.json'), 'utf8'));
    if (!maps.maps.every(map => digestMatches(map.file, map.sha256)) ||
        !capture.routes.every(route => digestMatches(route.rawDocument, route.rawSha256)) ||
        !assets.assets.every(asset => typeof asset.relPath === 'string' && fs.existsSync(path.join(MIRROR_DIR, asset.relPath)) && digestMatches(asset.rawFile, asset.sha256))) {
      throw new Error('Captured document, source map or listed asset is missing or inconsistent.');
    }
  }

  const missingStreamSegments = verifyOfflineStreamAndExternalIntegrity(MIRROR_DIR);
  if (missingStreamSegments.length > 0) {
    console.error(`❌ Incomplete HLS (.m3u8) stream mirror (${missingStreamSegments.length} missing segments):`);
    for (const m of missingStreamSegments.slice(0, 10)) console.error(`   - ${m}`);
    totalFailures++;
  }

  // Verify local mirror server actually returns 200 OK
  try {
    const ping = await fetch(new URL(ROUTES[0] || '/', LOCAL_URL).href, { signal: AbortSignal.timeout(4000) });
    if (!ping.ok) {
      console.error(`❌ Local mirror server at ${LOCAL_URL} returned HTTP ${ping.status} (expected 200 OK).`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Local mirror server at ${LOCAL_URL} is unreachable: ${err.message}`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ]
  });

  for (const route of ROUTES) {
    const liveTarget = new URL(route, LIVE_URL).href;
    const localTarget = new URL(route, LOCAL_URL).href;

    console.log(`\n----------------------------------------`);
    console.log(`Checking Route: ${route}`);

    for (const vp of VIEWPORTS) {
      console.log(`  📱 Viewport: ${vp.name} (${vp.width}x${vp.height})`);

      const liveCtx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch
      });
      const localCtx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch
      });

      const livePage = await liveCtx.newPage();
      const localPage = await localCtx.newPage();

      const liveMonitor = await inspectSurface(livePage, false);
      const localMonitor = await inspectSurface(localPage, true);

      const [liveRes, localRes] = await Promise.all([
        livePage.goto(liveTarget, { waitUntil: 'load', timeout: 45000 }),
        localPage.goto(localTarget, { waitUntil: 'load', timeout: 45000 })
      ]);

      if (!localRes || localRes.status() >= 400) {
        console.error(`  ❌ Local route ${route} returned HTTP ${localRes?.status() ?? 'ERR'}`);
        totalFailures++;
      }

      await Promise.all([livePage.waitForTimeout(500), localPage.waitForTimeout(500)]);
      await Promise.all([
        livePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { }),
        localPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(32)).catch(() => { })
      ]);
      await Promise.all([
        livePage.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => { }),
        localPage.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => { })
      ]);
      await Promise.all([
        livePage.evaluate(() => document.fonts?.ready).catch(() => { }),
        localPage.evaluate(() => document.fonts?.ready).catch(() => { })
      ]);
      await Promise.all([livePage.waitForTimeout(1000), localPage.waitForTimeout(1000)]);
      await Promise.all([
        livePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { }),
        localPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1000)).catch(() => { })
      ]);
      await Promise.all([
        livePage.waitForFunction(() => window.__AGY_CLOCK_SETTLED__?.(), { timeout: 4000 }).catch(() => { }),
        localPage.waitForFunction(() => window.__AGY_CLOCK_SETTLED__?.(), { timeout: 4000 }).catch(() => { })
      ]);

      await Promise.all([freezeFrameDeterministically(livePage), freezeFrameDeterministically(localPage)]);
      await Promise.all([livePage.waitForTimeout(250), localPage.waitForTimeout(250)]);

      // Scroll Height Delta (<= 8px)
      const [liveHeight, localHeight] = await Promise.all([
        livePage.evaluate(() => document.documentElement.scrollHeight),
        localPage.evaluate(() => document.documentElement.scrollHeight)
      ]);
      const heightDelta = Math.abs(liveHeight - localHeight);
      console.log(`    Scroll Height: Live=${liveHeight}px | Local=${localHeight}px | Delta=${heightDelta}px`);
      if (heightDelta > 8) {
        console.error(`    ❌ Scroll height delta ${heightDelta}px exceeded 8px limit!`);
        totalFailures++;
      }

      // Surface Buffer Integrity (Images, Videos, Canvases — NO MASKING)
      const bufferAudit = await localPage.evaluate(() => {
        const brokenImages = Array.from(document.querySelectorAll('img')).filter(
          (img) =>
            img.naturalWidth === 0 &&
            img.getBoundingClientRect().width > 0 &&
            !img.closest('[data-lazy]') &&
            img.getAttribute('loading') !== 'lazy'
        ).length;
        const unreadyVideos = Array.from(document.querySelectorAll('video')).filter(
          (v) =>
            v.readyState < 2 &&
            v.getBoundingClientRect().width > 0 &&
            v.getAttribute('preload') !== 'none' &&
            Boolean(v.currentSrc || v.getAttribute('src'))
        ).length;
        return { brokenImages, unreadyVideos };
      });

      if (bufferAudit.brokenImages > 0) {
        console.error(`    ❌ Broken visible images on local mirror: ${bufferAudit.brokenImages}`);
        totalFailures++;
      }
      if (bufferAudit.unreadyVideos > 0) {
        console.error(`    ❌ Unready visible videos on local mirror: ${bufferAudit.unreadyVideos}`);
        totalFailures++;
      }

      // Landmark Bounding Box Parity (<= 2px)
      const landmarkQuery = 'header, nav, main, section, footer, h1, h2';
      const grabLandmarks = (p) =>
        p.evaluate((q) => {
          return Array.from(document.querySelectorAll(q))
            .filter((el) => !el.closest('.giga-cc, #giga-cc, #CybotCookiebotDialog, [data-consent]'))
            .map((el) => {
              const r = el.getBoundingClientRect();
              return { tag: el.tagName, top: Math.round(r.top), height: Math.round(r.height) };
            });
        }, landmarkQuery);

      const [liveLandmarks, localLandmarks] = await Promise.all([grabLandmarks(livePage), grabLandmarks(localPage)]);
      let landmarkMaxDelta = 0;
      if (liveLandmarks.length !== localLandmarks.length) {
        console.error('Landmark count differs', liveLandmarks.length, localLandmarks.length);
        totalFailures++;
      }
      const count = Math.min(liveLandmarks.length, localLandmarks.length);
      for (let i = 0; i < count; i++) {
        landmarkMaxDelta = Math.max(
          landmarkMaxDelta,
          Math.abs(liveLandmarks[i].top - localLandmarks[i].top),
          Math.abs(liveLandmarks[i].height - localLandmarks[i].height)
        );
      }
      console.log(`    Landmark Max Delta: ${landmarkMaxDelta}px`);
      if (landmarkMaxDelta > 2) {
        console.error(`    ❌ Landmark delta ${landmarkMaxDelta}px exceeded 2px limit!`);
        totalFailures++;
      }

      // Unmasked Pixelmatch Visual Diff across scroll checkpoints (<= 0.5%)
      for (const ratio of SCROLL_CHECKPOINTS) {
        const liveY = Math.round(Math.max(0, liveHeight - vp.height) * ratio);
        const localY = Math.round(Math.max(0, localHeight - vp.height) * ratio);

        await Promise.all([
          livePage.evaluate((y) => window.scrollTo(0, y), liveY),
          localPage.evaluate((y) => window.scrollTo(0, y), localY)
        ]);
        await Promise.all([livePage.waitForTimeout(250), localPage.waitForTimeout(250)]);
        if (liveY > 0 || localY > 0) {
          await Promise.all([
            livePage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { }),
            localPage.evaluate(() => window.__AGY_ADVANCE_CLOCK__?.(1600)).catch(() => { })
          ]);
        }
        await Promise.all([livePage.waitForTimeout(450), localPage.waitForTimeout(450)]);
        await Promise.all([
          livePage.waitForFunction(() => window.__AGY_CLOCK_SETTLED__?.(), { timeout: 4000 }).catch(() => { }),
          localPage.waitForFunction(() => window.__AGY_CLOCK_SETTLED__?.(), { timeout: 4000 }).catch(() => { })
        ]);
        await Promise.all([freezeFrameDeterministically(livePage), freezeFrameDeterministically(localPage)]);
        await Promise.all([livePage.waitForTimeout(150), localPage.waitForTimeout(150)]);

        await livePage.bringToFront();
        const liveShot = await livePage.screenshot({ timeout: 10000 });
        await localPage.bringToFront();
        const localShot = await localPage.screenshot({ timeout: 10000 });
        const imgLive = PNG.sync.read(liveShot);
        const imgLocal = PNG.sync.read(localShot);
        const diff = new PNG({ width: vp.width, height: vp.height });

        const mismatchedPixels = pixelmatch(
          imgLive.data,
          imgLocal.data,
          diff.data,
          vp.width,
          vp.height,
          { threshold: THRESHOLD }
        );

        const totalPixels = vp.width * vp.height;
        const diffPct = (mismatchedPixels / totalPixels) * 100;
        console.log(`    Scroll ${Math.round(ratio * 100)}%: Unmasked Diff = ${diffPct.toFixed(3)}% (${mismatchedPixels} px)`);

        comparisons.push({
          route,
          viewport: vp.name,
          scrollPercent: Math.round(ratio * 100),
          diffPercent: Number(diffPct.toFixed(4)),
          heightDelta,
          landmarkMaxDelta
        });

        if (diffPct > MAX_DIFF_PERCENT) {
          const safeRoute = route.replace(/\//g, '_') || 'root';
          const diffFile = path.join(REPORT_DIR, `diff-${safeRoute}-${vp.name}-${Math.round(ratio * 100)}.png`);
          fs.writeFileSync(diffFile, PNG.sync.write(diff));
          console.error(`    ❌ Unmasked visual diff ${diffPct.toFixed(2)}% exceeded ${MAX_DIFF_PERCENT}%! Saved: ${diffFile}`);
          totalFailures++;
        }
      }

      // Network, Console & Airgap Escape Checks (evaluated AFTER full scroll sweep)
      if (localMonitor.failedRequests.length > 0) {
        console.error(`    ❌ HTTP >= 400 responses on local mirror:`, localMonitor.failedRequests);
        totalFailures++;
      }
      if (localMonitor.escapedExternal.length > 0) {
        console.error(`    ❌ Escaped external requests on air-gapped mirror:`, localMonitor.escapedExternal);
        totalFailures++;
      }
      if (localMonitor.errors.length > 0) {
        console.error(`    ❌ Uncaught runtime/console errors on local mirror:`, localMonitor.errors);
        totalFailures++;
      }

      const localStyleIssues = (localMonitor.cdpIssues || []).filter(
        (i) => Boolean((i?.issue?.details || i)?.stylesheetLoadingIssueDetails)
      );
      const localLazyIssues = (localMonitor.cdpIssues || []).filter(
        (i) => Boolean((i?.issue?.details || i)?.lazyLoadImageIssueDetails)
      );
      const liveLazyIssues = (liveMonitor.cdpIssues || []).filter(
        (i) => Boolean((i?.issue?.details || i)?.lazyLoadImageIssueDetails)
      );
      const actionableCdpIssues = [
        ...localStyleIssues,
        ...(localLazyIssues.length > liveLazyIssues.length ? localLazyIssues.slice(liveLazyIssues.length) : [])
      ];
      if (actionableCdpIssues.length > 0) {
        console.error(
          `    ❌ Chrome CDP Audit Violations (${actionableCdpIssues.length}):`,
          JSON.stringify(actionableCdpIssues[0]?.issue?.details || actionableCdpIssues[0])
        );
        totalFailures++;
      }

      await liveCtx.close();
      await localCtx.close();
    }
  }

  await browser.close();

  fs.writeFileSync(
    path.join(REPORT_DIR, 'stage0-parity-report.json'),
    JSON.stringify({ passed: totalFailures === 0 && !ALLOW_PARTIAL, totalFailures, comparisons }, null, 2),
    'utf8'
  );

  if (ALLOW_PARTIAL) {
    console.error(`\n⚠️ PARTIAL DEBUG RUN (--allow-partial-routes): Stage 0 cert NOT minted until 100% of routes pass.`);
    process.exit(1);
  }

  console.log(`\n============================================================`);
  if (totalFailures > 0) {
    console.error(`💥 STAGE 0 VERIFICATION FAILED: ${totalFailures} hard-gate violation(s) detected.`);
    process.exit(1);
  } else {
    const cert = mintStageCert({
      stage: 0,
      dir: MIRROR_DIR,
      routes: ROUTES,
      summary: { liveUrl: LIVE_URL, localUrl: LOCAL_URL, comparisonsCount: comparisons.length }
    });
    console.log(`🔒 Stage 0 Certificate Minted: ${cert.digest.slice(0, 16)}... (${cert.fileCount} files, ${ROUTES.length} routes)`);
    console.log(`✅ STAGE 0 VERIFICATION PASSED: 100% air-gapped & unmasked parity confirmed across ${ROUTES.length} route(s).`);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal Stage 0 verification error:', err);
  process.exit(1);
});
