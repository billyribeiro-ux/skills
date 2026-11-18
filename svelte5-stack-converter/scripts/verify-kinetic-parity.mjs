#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { auditKineticAndLivingSurface, installKineticObserver } from '../../shared/kinetic-verifier.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const TARGET_URL = getArg('--url', 'http://localhost:3012');
const MIRROR_URL = getArg('--mirror', 'http://localhost:3010');
const SVELTE_DIR = path.resolve(getArg('--svelte-dir', './02-svelte5'));
const FORENSICS_DIR = path.resolve(
  getArg('--forensics-dir', fs.existsSync(path.join(SVELTE_DIR, 'forensics')) ? path.join(SVELTE_DIR, 'forensics') : './00-mirror/forensics')
);
const explicitRoutes = getArg('--routes', '');

let ROUTES = ['/'];
const manifestPath = path.join(FORENSICS_DIR, 'routes-manifest.json');
if (explicitRoutes) {
  ROUTES = explicitRoutes.split(',').map((r) => r.trim()).filter(Boolean);
} else if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(manifest.routes) && manifest.routes.length > 0) {
      ROUTES = manifest.routes.map((r) => (typeof r === 'string' ? r : r.route));
    }
  } catch {}
}

async function main() {
  console.log('🚀 Starting Site-Agnostic Gate 5: Dynamic Kinetic & Living Interaction Parity Verification...');
  console.log(`  Target URL:    ${TARGET_URL}`);
  console.log(`  Mirror URL:    ${MIRROR_URL}`);
  console.log(`  Forensics Dir: ${FORENSICS_DIR}`);
  console.log(`  Routes:        ${ROUTES.join(', ')}\n`);

  const browser = await chromium.launch({ headless: true });
  let totalFailures = 0;

  try {
    for (const route of ROUTES) {
      console.log(`--- Auditing Route: ${route} ---`);
      const targetCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const mirrorCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

      const targetPage = await targetCtx.newPage();
      const mirrorPage = await mirrorCtx.newPage();

      const pageErrors = [];
      targetPage.on('pageerror', (err) => pageErrors.push(err.message));

      await Promise.all([installKineticObserver(targetPage),installKineticObserver(mirrorPage)]);

      const targetHref = new URL(route, TARGET_URL).href;
      const mirrorHref = new URL(route, MIRROR_URL).href;

      await Promise.all([
        targetPage.goto(targetHref, { waitUntil: 'domcontentloaded', timeout: 30000 }),
        mirrorPage.goto(mirrorHref, { waitUntil: 'domcontentloaded', timeout: 30000 })
      ]);
      await Promise.all([
        targetPage.evaluate(() => document.fonts?.ready).catch(() => {}),
        mirrorPage.evaluate(() => document.fonts?.ready).catch(() => {})
      ]);
      await Promise.all([targetPage.waitForTimeout(1400), mirrorPage.waitForTimeout(1400)]);

      const living = await auditKineticAndLivingSurface({
        page: targetPage,
        route,
        forensicsDir: FORENSICS_DIR,
        mirrorPage
      });

      const [targetHeight, mirrorHeight] = await Promise.all([
        targetPage.evaluate(() => document.documentElement.scrollHeight),
        mirrorPage.evaluate(() => document.documentElement.scrollHeight)
      ]);
      const heightDelta = Math.abs(targetHeight - mirrorHeight);

      console.log(
        `  Canvases: ${living.summary.activeCanvases}/${living.summary.canvasCount} | RAF delta: ${living.summary.rafDelta} | Mount reveals checked: ${living.summary.mountRevealsChecked} | Controls tested: ${living.summary.testedControls} | Height delta vs mirror: ${heightDelta}px`
      );

      for (const errMsg of pageErrors) {
        console.error(`  ❌ [PageError] ${errMsg}`);
        totalFailures++;
      }
      if (heightDelta > 4) {
        console.error(`  ❌ Layout height drifted vs mirror (:3010): mirror=${mirrorHeight}px, target=${targetHeight}px (delta=${heightDelta}px)`);
        totalFailures++;
      }
      for (const wf of living.warnings) {
        console.warn(`  ⚠️  ${wf}`);
      }
      for (const ff of living.failures) {
        console.error(`  ❌ ${ff}`);
        totalFailures++;
      }

      await targetCtx.close();
      await mirrorCtx.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`\n============================================================`);
  if (totalFailures > 0) {
    console.error(`💥 GATE 5 KINETIC VERIFICATION FAILED (${totalFailures} issue(s)).`);
    process.exit(1);
  }
  console.log(`🎉 ALL KINETIC, LIVING-CANVAS & INTERACTION GATES PASSED ACROSS ${ROUTES.length} ROUTE(S)!`);
}

main().catch((err) => {
  console.error('Fatal kinetic verification error:', err);
  process.exit(1);
});
