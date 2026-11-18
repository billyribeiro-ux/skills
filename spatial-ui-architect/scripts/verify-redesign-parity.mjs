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
const baselineFile = path.resolve(getArg('--baseline', './audit-telemetry/full-surface-manifest.json'));
const outFile = path.resolve(getArg('--out', './audit-telemetry/verification-report.json'));

async function verify() {
  if (!fs.existsSync(baselineFile)) {
    console.error(`❌ Baseline manifest not found: ${baselineFile}`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const origin = new URL(baseUrl).origin;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const report = {
    verifiedAt: new Date().toISOString(),
    passed: true,
    failures: [],
    routesChecked: 0
  };

  for (const r of baseline.routes) {
    const targetUrl = new URL(r.route, origin).href;
    report.routesChecked++;

    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const res = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
      if (!res || res.status() >= 400) {
        report.passed = false;
        report.failures.push({ route: r.route, viewport: width, reason: `HTTP ${res ? res.status() : 'ERR'}` });
        continue;
      }

      const check = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        return { overflow: sw > vw + 2, vw, sw };
      });

      if (check.overflow) {
        report.passed = false;
        report.failures.push({
          route: r.route,
          viewport: width,
          reason: `Horizontal overflow detected: scrollWidth(${check.sw}) > viewport(${check.vw})`
        });
      }
    }
  }

  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  if (!report.passed) {
    console.error(`❌ [verify-redesign-parity] FAILED with ${report.failures.length} violations. See ${outFile}`);
    process.exit(1);
  }
  console.log(`✅ [verify-redesign-parity] PASSED across ${report.routesChecked} routes x 4 viewports!`);
}

verify();
