#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  formatSafeHtml,
  harmonizeFormA11y,
  sanitizeAndFormatCss
} from './ast-humanizer.mjs';
import { unpackAllMirrorBundles } from './unpack-bundler-modules.mjs';
import { decomposeRouteSections } from './decompose-route-sections.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_DIR = path.resolve(getArg('--mirror-dir', './00-mirror'));
const OUT_DIR = path.resolve(getArg('--out-dir', './01-native'));

console.log(`🧩 Stage 1 Mode A Decompiler: Compiled VDOM Framework (Zero-Chunk Author Source)`);
console.log(`  Mirror Source: ${MIRROR_DIR}`);
console.log(`  Output Native: ${OUT_DIR}`);

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

fs.mkdirSync(path.join(OUT_DIR, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'controllers'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'styles'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'forensics'), { recursive: true });

const BANNED_JS_BUNDLE_PATH = /(?:^|\/)(?:_next\/static\/.*\.m?js|_astro\/.*\.m?js|_nuxt\/.*\.m?js|(?:webpack|turbopack|chunk|bundle|runtime)[^/]*\.m?js|.*\.(?:min|built)\.m?js)$/i;

/**
 * Copies ONLY genuine non-bundle assets (media, fonts, images, CSS, API fixtures, forensics).
 * Strictly blocks all compiled JS chunks so Stage 1 can NEVER bypass decoding via Stage 0 chunks!
 */
function copyAssetsExcludingChunks(src, dest, relFromRoot = '') {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (['node_modules', '.git', '__sourcemaps__'].includes(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      const nextRel = relFromRoot ? `${relFromRoot}/${child}` : child;
      copyAssetsExcludingChunks(path.join(src, child), path.join(dest, child), nextRel);
    }
  } else {
    const normRel = relFromRoot.replace(/\\/g, '/');
    if (BANNED_JS_BUNDLE_PATH.test(normRel)) return;
    if (normRel.endsWith('.js') && !normRel.startsWith('src/')) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log(`📦 Copying verified media, fonts, stylesheets, and API fixtures (purging 100% of JS chunks)...`);
copyAssetsExcludingChunks(MIRROR_DIR, OUT_DIR);

// Load intrinsic image dimensions for Zero-CLS attribute enforcement
let imageDimensions = {};
const dimFile = path.join(MIRROR_DIR, 'forensics', 'image-dimensions.json');
if (fs.existsSync(dimFile)) {
  try {
    imageDimensions = JSON.parse(fs.readFileSync(dimFile, 'utf8'));
  } catch { }
}

// Sanitize & modularize all CSS files (< 1,400 lines per file) and extract top-level :root tokens
const tokens = new Map();
function processAllCss(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'forensics', '__api_fixtures__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) processAllCss(full);
    else if (entry.isFile() && entry.name.endsWith('.css')) {
      const raw = fs.readFileSync(full, 'utf8');
      try {
        const parsed = postcss.parse(raw);
        for (const node of parsed.nodes) {
          if (node.type === 'rule' && node.selector === ':root') {
            node.walkDecls((d) => {
              if (d.prop.startsWith('--') && !tokens.has(d.prop)) {
                tokens.set(d.prop, d.value);
              }
            });
          }
        }
      } catch { }
      const cleanCss = sanitizeAndFormatCss(raw);
      fs.writeFileSync(full, cleanCss, 'utf8');
    }
  }
}
processAllCss(OUT_DIR);

let tokensCss = ':root {\n';
for (const [k, v] of tokens.entries()) {
  tokensCss += `  ${k}: ${v};\n`;
}
tokensCss += '}\n';
fs.writeFileSync(path.join(OUT_DIR, 'src', 'styles', 'tokens.css'), tokensCss, 'utf8');

// Unpack all bundler module factories, RSC Flight symbol maps, route props, and GLSL shaders!
console.log(`🔬 Unpacking bundler module registries, RSC Flight trees & GLSL shaders...`);
const unpackSummary = await unpackAllMirrorBundles(MIRROR_DIR, OUT_DIR);
console.log(
  `  ✅ Unpacked ${unpackSummary.writtenAuthorCount} first-party modules (${unpackSummary.rscSymbolCount} RSC symbols, ${unpackSummary.shaderCount} shaders)`
);

// Forward Stage 0 CDP animation, Canvas2D & interaction blueprints into src/animations/
for (const forensicFile of [
  'animations-blueprint.json',
  'kinetic-scroll-matrix.json',
  'interaction-contracts.json',
  'canvas2d-blueprint.json',
  'webgl-shaders.json'
]) {
  const srcF = path.join(MIRROR_DIR, 'forensics', forensicFile);
  if (fs.existsSync(srcF)) {
    fs.mkdirSync(path.join(OUT_DIR, 'src', 'animations'), { recursive: true });
    fs.copyFileSync(srcF, path.join(OUT_DIR, 'src', 'animations', forensicFile));
  }
}

/**
 * Statically resolves React 19 / Next.js streaming SSR Suspense boundaries ($RC / $RS)
 * so <template id="B:x">...</template> slots receive their resolved <div hidden id="S:x">...</div> DOM
 * BEFORE bundler scripts are stripped.
 */
function findMatchingDivCloseEnd(html, openTagEndIdx) {
  const divRe = /<\/?div\b[^>]*>/gi;
  divRe.lastIndex = openTagEndIdx;
  let depth = 1;
  let m;
  while ((m = divRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        return { innerEnd: m.index, outerEnd: m.index + m[0].length };
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }
  return null;
}

function resolveReactStreamingSuspenseHtml(rawHtml) {
  let html = rawHtml;
  const resolvedPairs = [];

  // Parse explicit $RC("B:x","S:y") mappings if present; also auto-pair matching B:N <-> S:N ids
  const rcPairs = new Map();
  for (const m of html.matchAll(/\$R[CS]\(\s*["']([BP]:[^"']+)["']\s*,\s*["'](S:[^"']+)["']\s*\)/g)) {
    rcPairs.set(m[2], m[1]);
  }

  // Locate all <div hidden id="S:..."> containers via balanced </div> scan
  const hiddenSlotRe = /<div\b(?=[^>]*\bhidden\b)[^>]*\bid=["'](S:[^"']+)["'][^>]*>/gi;
  let hm;
  const removals = [];
  while ((hm = hiddenSlotRe.exec(html)) !== null) {
    const sId = hm[1];
    const openEnd = hm.index + hm[0].length;
    const span = findMatchingDivCloseEnd(html, openEnd);
    if (!span) continue;
    const innerHtml = html.slice(openEnd, span.innerEnd);
    const targetBId = rcPairs.get(sId) || sId.replace(/^S:/, 'B:');
    resolvedPairs.push({ bId: targetBId, innerHtml });
    removals.push({ start: hm.index, end: span.outerEnd });
    hiddenSlotRe.lastIndex = span.outerEnd;
  }

  // Strip resolved <div hidden id="S:..."> blocks in reverse offset order
  for (let i = removals.length - 1; i >= 0; i--) {
    const r = removals[i];
    html = html.slice(0, r.start) + html.slice(r.end);
  }

  // Splice resolved innerHtml into corresponding <template id="B:...">...</template> slots
  for (const pair of resolvedPairs) {
    const escapedId = pair.bId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tmplWithMarkers = new RegExp(
      `(?:<!--\\$\\??-->)?<template\\b[^>]*\\bid=["']${escapedId}["'][^>]*>[\\s\\S]*?<\\/template>(?:<!--\\/\\$-->)?`,
      'gi'
    );
    html = html.replace(tmplWithMarkers, () => pair.innerHtml);
  }

  return html;
}

// Create clean first-party interactive controller runtime in src/main.js
const mainJs = `/**
 * Stage 1 First-Party Application Runtime Entrypoint
 * Zero bundler chunks — drives interactive UI states, lazy media, dialogs, tabs, and accordions cleanly.
 */
export function mountInteractiveControllers(rootNode = document) {
  const cleanupHandlers = [];

  // 1. Accessible Accordion / Disclosure toggles ([aria-expanded][aria-controls])
  const disclosures = rootNode.querySelectorAll('button[aria-expanded]');
  for (const trigger of disclosures) {
    const handleToggle = () => {
      const current = trigger.getAttribute('aria-expanded') === 'true';
      const next = !current;
      trigger.setAttribute('aria-expanded', next ? 'true' : 'false');
      const targetId = trigger.getAttribute('aria-controls');
      const panel = targetId ? document.getElementById(targetId) : trigger.nextElementSibling;
      if (panel) {
        panel.hidden = !next;
        panel.setAttribute('data-state', next ? 'open' : 'closed');
      }
      trigger.setAttribute('data-state', next ? 'open' : 'closed');
    };
    trigger.addEventListener('click', handleToggle);
    cleanupHandlers.push(() => trigger.removeEventListener('click', handleToggle));
  }

  // 2. Escape key dismissal for open <dialog> modals
  const handleEscape = (domEvent) => {
    if (domEvent.key === 'Escape') {
      document.querySelectorAll('dialog[open]').forEach((dlg) => dlg.close());
    }
  };
  window.addEventListener('keydown', handleEscape);
  cleanupHandlers.push(() => window.removeEventListener('keydown', handleEscape));

  return () => {
    for (const fn of cleanupHandlers) fn();
  };
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mountInteractiveControllers(), { once: true });
  } else {
    mountInteractiveControllers();
  }
}
`;
fs.writeFileSync(path.join(OUT_DIR, 'src', 'main.js'), mainJs, 'utf8');

// Clean, strip ALL bundler/RSC scripts, enforce image dimensions & form A11y, and format multi-line HTML across all routes
async function cleanAllRouteHtmlFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'src', 'forensics', '__api_fixtures__', '__external'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await cleanAllRouteHtmlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      let html = fs.readFileSync(full, 'utf8');

      // Resolve React streaming SSR Suspense boundaries ($RC / $RS) BEFORE stripping bundler/Flight scripts!
      html = resolveReactStreamingSuspenseHtml(html);

      // Strip ALL external bundler scripts (_next, turbopack, webpack, .min.js, .built.js) & RSC Flight/streaming scripts!
      html = html.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, '');
      html = html.replace(/<script\b[^>]*>[\s\S]*?(?:self\.__next_f|__NEXT_DATA__|TURBOPACK|__webpack_require__|function\s+\$R[CSBX]\b|\$R[CSBX]\(|requestAnimationFrame\(function\(\)\{\$RT|\$RT=performance\.now)[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<link\b[^>]*rel=["'](?:modulepreload|preload)["'][^>]*as=["']script["'][^>]*>/gi, '');

      // Strip aria-hidden="true" on clickable <a> elements
      html = html.replace(/<a\b([^>]*?)\s+aria-hidden=["']true["']/gi, '<a$1');

      // Inject explicit width/height on <img> from image-dimensions.json
      html = html.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
        let updated = attrs;
        const hasWidth = /\bwidth=/i.test(attrs);
        const hasHeight = /\bheight=/i.test(attrs);
        if (!hasWidth || !hasHeight) {
          const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
          if (srcMatch) {
            const rawSrc = srcMatch[1];
            const dim = imageDimensions[rawSrc] || imageDimensions[rawSrc.split('/').pop()?.split('?')[0] || ''];
            if (dim) {
              if (!hasWidth) updated += ` width="${dim[0]}"`;
              if (!hasHeight) updated += ` height="${dim[1]}"`;
            } else if (/\bloading=["']lazy["']/i.test(updated)) {
              updated = updated.replace(/\bloading=["']lazy["']/i, 'loading="eager"');
            }
          }
        }
        return `<img${updated}>`;
      });

      html = harmonizeFormA11y(html);

      if (!html.includes('/src/styles/tokens.css') && html.includes('<head>')) {
        html = html.replace('<head>', '<head>\n    <link rel="stylesheet" href="/src/styles/tokens.css" />');
      }
      if (!html.includes('/src/main.js') && html.includes('</body>')) {
        html = html.replace('</body>', '    <script type="module" src="/src/main.js"></script>\n  </body>');
      }

      const formattedHtml = await formatSafeHtml(html);
      fs.writeFileSync(full, formattedHtml, 'utf8');
    }
  }
}

await cleanAllRouteHtmlFiles(OUT_DIR);

const sectionSummary = decomposeRouteSections(OUT_DIR);
console.log(
  `  🧱 Pre-sliced ${sectionSummary.totalGeneratedSections} semantic route sections across ${sectionSummary.routeCount} route(s) -> forensics/route-section-map.json`
);

// Write clean package.json
const dependencies = {
  react: '^19.0.0',
  'react-dom': '^19.0.0'
};
for (const v of unpackSummary.detectedVendors) {
  if (v === 'three') dependencies.three = '^0.174.0';
  if (v === 'gsap') dependencies.gsap = '^3.12.7';
  if (v === 'hls.js') dependencies['hls.js'] = '^1.6.0';
  if (v === 'lenis') dependencies.lenis = '^1.2.3';
}

const pkgJson = {
  name: 'stage1-native-app',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: {
    dev: 'node ../.agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir . --port 3011',
    start: 'node ../.agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir . --port 3011'
  },
  dependencies
};
fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');

console.log(`✅ Stage 1 Mode A Decompilation completed cleanly into ${OUT_DIR} (0 bundler chunks).`);
