#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const baseUrl = getArg('--url', 'http://localhost:5173');
const routesFile = getArg('--routes-file', '');
const authStateFile = getArg('--auth-state', '');
const outDir = path.resolve(getArg('--out', './audit-telemetry'));
const maxRoutes = parseInt(getArg('--max-routes', '50'), 10);

const VIEWPORTS = [
  { name: 'desktop-wide', width: 1920, height: 1080 },
  { name: 'desktop-std', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 }
];

fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });

async function runFullSurfaceCrawl() {
  const browser = await chromium.launch({ headless: true });
  const contextOptions = authStateFile && fs.existsSync(authStateFile)
    ? { storageState: authStateFile }
    : {};

  const origin = new URL(baseUrl).origin;
  const queue = new Set(['/']);
  const visited = new Set();

  if (routesFile && fs.existsSync(routesFile)) {
    const map = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
    for (const r of map.routes || []) {
      if (!r.isDynamic) queue.add(r.route);
    }
  }

  const manifest = {
    crawledAt: new Date().toISOString(),
    baseUrl,
    authenticated: Boolean(contextOptions.storageState),
    summary: {
      totalRoutesAudited: 0,
      totalInteractiveStatesTriggered: 0,
      totalOverflowViolations: 0,
      totalCollisionViolations: 0,
      totalDeadLinksOrButtons: 0
    },
    routes: []
  };

  const context = await browser.newContext({ ...contextOptions, viewport: VIEWPORTS[1] });
  const page = await context.newPage();

  const apiSchemas = [];
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (ct.includes('application/json') && res.url().startsWith(origin)) {
        const urlPath = new URL(res.url()).pathname;
        if (apiSchemas.length < 100) {
          apiSchemas.push({ url: urlPath, status: res.status() });
        }
      }
    } catch {}
  });

  while (queue.size > 0 && visited.size < maxRoutes) {
    const currentRoute = queue.values().next().value;
    queue.delete(currentRoute);
    if (visited.has(currentRoute)) continue;
    visited.add(currentRoute);

    const targetUrl = new URL(currentRoute, origin).href;
    console.log(`🔍 [Crawling Route ${visited.size}/${maxRoutes}] ${targetUrl}`);

    const routeReport = {
      route: currentRoute,
      url: targetUrl,
      viewports: {},
      interactiveStates: [],
      brokenTargets: []
    };

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      const res = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 25000 });
      routeReport.httpStatus = res ? res.status() : 0;
      await page.waitForTimeout(500);

      const discoveredLinks = await page.evaluate((orig) => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href'))
          .filter(Boolean)
          .map((href) => {
            try {
              const u = new URL(href, orig);
              return u.origin === orig ? u.pathname : null;
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }, origin);

      for (const link of discoveredLinks) {
        if (!visited.has(link) && !/\.(pdf|zip|png|jpg|svg|webp)$/i.test(link)) {
          queue.add(link);
        }
      }

      for (const vp of VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.waitForTimeout(250);

        const slug = currentRoute === '/' ? 'index' : currentRoute.replace(/[^a-zA-Z0-9_-]/g, '_');
        const shotPath = path.join(outDir, 'screenshots', `${slug}__${vp.name}.png`);
        await page.screenshot({ path: shotPath, fullPage: true });

        const metrics = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const docScrollWidth = document.documentElement.scrollWidth;
          const hasHorizontalOverflow = docScrollWidth > vw + 2;

          const overflowCulprits = [];
          const touchTargetViolations = [];
          const clippingViolations = [];
          const fontSet = new Set();
          const bgSet = new Set();

          const allElements = Array.from(document.querySelectorAll('*'));
          for (const el of allElements) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden') continue;

            fontSet.add(`${style.fontFamily.split(',')[0].replace(/['"]/g, '').trim()} | ${style.fontSize} | ${style.fontWeight}`);
            if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') bgSet.add(style.backgroundColor);

            if (rect.right > vw + 4 && style.position !== 'fixed') {
              overflowCulprits.push({
                tag: el.tagName.toLowerCase(),
                id: el.id || undefined,
                className: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
                rightEdge: Math.round(rect.right),
                viewportWidth: vw
              });
            }

            if (el.children.length === 0 && el.textContent.trim().length > 0) {
              if (el.scrollWidth > el.clientWidth + 4 && style.overflowX === 'visible') {
                clippingViolations.push({
                  tag: el.tagName.toLowerCase(),
                  textSample: el.textContent.trim().slice(0, 40),
                  scrollWidth: el.scrollWidth,
                  clientWidth: el.clientWidth
                });
              }
            }
          }

          const interactives = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]'));
          const deadTargets = [];
          for (const item of interactives) {
            const r = item.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (vw <= 768 && (r.width < 36 || r.height < 36)) {
              touchTargetViolations.push({
                tag: item.tagName.toLowerCase(),
                text: (item.textContent || item.getAttribute('aria-label') || '').trim().slice(0, 30),
                width: Math.round(r.width),
                height: Math.round(r.height)
              });
            }
            if (item.tagName === 'A') {
              const href = item.getAttribute('href');
              if (!href || href === '#' || href.startsWith('javascript:void')) {
                deadTargets.push({ type: 'empty-anchor', text: item.textContent.trim().slice(0, 40), href });
              }
            }
          }

          return {
            viewportWidth: vw,
            docScrollWidth,
            hasHorizontalOverflow,
            overflowCulprits: overflowCulprits.slice(0, 15),
            clippingViolations: clippingViolations.slice(0, 15),
            touchTargetViolations: touchTargetViolations.slice(0, 15),
            deadTargets: deadTargets.slice(0, 15),
            typographyTokensSample: Array.from(fontSet).slice(0, 30),
            surfaceColorsSample: Array.from(bgSet).slice(0, 25)
          };
        });

        routeReport.viewports[vp.name] = metrics;
        if (metrics.hasHorizontalOverflow) manifest.summary.totalOverflowViolations++;
        manifest.summary.totalCollisionViolations += metrics.clippingViolations.length;
        manifest.summary.totalDeadLinksOrButtons += metrics.deadTargets.length;
      }

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });

      const triggers = await page.evaluate(() => {
        const selectors = [
          '[role="tab"]',
          '[aria-haspopup="dialog"]',
          '[aria-haspopup="menu"]',
          '[data-state="closed"]',
          'button[aria-expanded="false"]',
          'summary'
        ];
        const found = [];
        document.querySelectorAll(selectors.join(',')).forEach((el, idx) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && found.length < 12) {
            el.setAttribute('data-audit-trigger-id', String(idx));
            found.push({
              id: String(idx),
              tag: el.tagName.toLowerCase(),
              label: (el.textContent || el.getAttribute('aria-label') || 'unnamed-trigger').trim().slice(0, 40),
              role: el.getAttribute('role') || el.getAttribute('aria-haspopup') || 'expandable'
            });
          }
        });
        return found;
      });

      for (const trig of triggers) {
        try {
          const loc = page.locator(`[data-audit-trigger-id="${trig.id}"]`).first();
          if (await loc.isVisible()) {
            await loc.click({ timeout: 2000 });
            await page.waitForTimeout(350);

            const slug = currentRoute === '/' ? 'index' : currentRoute.replace(/[^a-zA-Z0-9_-]/g, '_');
            const stateShot = path.join(outDir, 'screenshots', `${slug}__state_${trig.id}.png`);
            await page.screenshot({ path: stateShot });

            const activeOverlay = await page.evaluate(() => {
              const dialog = document.querySelector('[role="dialog"], [role="menu"], [data-state="open"], dialog[open]');
              if (!dialog) return null;
              const r = dialog.getBoundingClientRect();
              const s = window.getComputedStyle(dialog);
              return {
                tag: dialog.tagName.toLowerCase(),
                width: Math.round(r.width),
                height: Math.round(r.height),
                zIndex: s.zIndex
              };
            });

            routeReport.interactiveStates.push({
              trigger: trig,
              overlayDetected: activeOverlay,
              screenshot: path.basename(stateShot)
            });
            manifest.summary.totalInteractiveStatesTriggered++;

            await page.keyboard.press('Escape');
            await page.waitForTimeout(200);
          }
        } catch {}
      }

    } catch (err) {
      routeReport.error = err.message;
    }

    manifest.routes.push(routeReport);
    manifest.summary.totalRoutesAudited++;
  }

  manifest.apiEndpointsObserved = apiSchemas;
  await browser.close();

  const manifestPath = path.join(outDir, 'full-surface-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ [full-surface-crawler] Audited ${manifest.summary.totalRoutesAudited} routes & ${manifest.summary.totalInteractiveStatesTriggered} interactive states -> ${manifestPath}`);
}

runFullSurfaceCrawl();
