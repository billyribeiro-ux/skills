#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import {
  formatSafeHtml,
  harmonizeFormA11y,
  humanizeJavaScript,
  sanitizeAndFormatCss
} from './ast-humanizer.mjs';
import { classifyVendorModule, unpackAllMirrorBundles } from './unpack-bundler-modules.mjs';
import { decomposeRouteSections } from './decompose-route-sections.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_DIR = path.resolve(getArg('--mirror-dir', './00-mirror'));
const OUT_DIR = path.resolve(getArg('--out-dir', './01-native'));

console.log(`🎬 Stage 1 Mode C Universal Decompiler: Custom JS / Scrollytelling / WebGL (Zero-Chunk)`);
console.log(`  Mirror Source: ${MIRROR_DIR}`);
console.log(`  Output Native: ${OUT_DIR}`);

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

fs.mkdirSync(path.join(OUT_DIR, 'src', 'components'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'controllers'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'animations'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'shaders'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'styles'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'forensics'), { recursive: true });

// Copy ONLY non-JS assets from mirror so zero .built.js / .min.js / bundler chunks leak into 01-native!
function copyAssetsWithoutBundles(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (['node_modules', '.git', '__sourcemaps__'].includes(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyAssetsWithoutBundles(path.join(src, child), path.join(dest, child));
    }
  } else {
    if (src.endsWith('.js') || src.endsWith('.mjs')) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

copyAssetsWithoutBundles(MIRROR_DIR, OUT_DIR);

let imageDimensions = {};
const dimFile = path.join(MIRROR_DIR, 'forensics', 'image-dimensions.json');
if (fs.existsSync(dimFile)) {
  try {
    imageDimensions = JSON.parse(fs.readFileSync(dimFile, 'utf8'));
  } catch { }
}

// 1. Extract strictly top-level :root tokens & sanitize all stylesheets
const tokens = new Map();
function processCssFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'forensics', '__api_fixtures__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) processCssFiles(full);
    else if (entry.isFile() && entry.name.endsWith('.css')) {
      const raw = fs.readFileSync(full, 'utf8');
      try {
        const root = postcss.parse(raw);
        for (const node of root.nodes) {
          if (node.type === 'rule' && node.selector === ':root') {
            node.walkDecls((decl) => {
              if (decl.prop.startsWith('--') && !tokens.has(decl.prop)) {
                tokens.set(decl.prop, decl.value);
              }
            });
          }
        }
      } catch { }
      fs.writeFileSync(full, sanitizeAndFormatCss(raw), 'utf8');
    }
  }
}
processCssFiles(OUT_DIR);

let tokensCss = ':root {\n';
for (const [k, v] of tokens.entries()) {
  tokensCss += `  ${k}: ${v};\n`;
}
tokensCss += '}\n';
fs.writeFileSync(path.join(OUT_DIR, 'src', 'styles', 'tokens.css'), tokensCss, 'utf8');

// 2. Unpack bundler chunks & GLSL shaders universally (zero hardcoded domain files!)
const unpackSummary = await unpackAllMirrorBundles(MIRROR_DIR, OUT_DIR);

// Also humanize standalone non-webpack/non-turbopack custom engine modules (< 65KB)
const standaloneImports = [];
let engineIdx = 1;
async function unpackStandaloneScripts(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '__sourcemaps__', 'forensics', '__api_fixtures__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await unpackStandaloneScripts(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      const raw = fs.readFileSync(full, 'utf8');
      if (
        raw.includes('webpackChunk') ||
        raw.includes('TURBOPACK') ||
        raw.length > 65000 ||
        classifyVendorModule(raw)
      ) {
        continue;
      }
      const stem = path
        .basename(entry.name, '.js')
        .replace(/\.(?:min|built|umd|bundle)$/i, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
      const modName = stem && !/^\d/.test(stem) ? `${stem}Engine` : `KineticController${engineIdx++}`;
      const humanized = await humanizeJavaScript(raw, { jsx: false });
      if (humanized.split('\n').length <= 1400) {
        const destFile = path.join(OUT_DIR, 'src', 'controllers', `${modName}.js`);
        if (!fs.existsSync(destFile)) {
          fs.writeFileSync(destFile, humanized, 'utf8');
          standaloneImports.push(`./controllers/${modName}.js`);
        }
      }
    }
  }
}
await unpackStandaloneScripts(MIRROR_DIR);

// 3. Forward Stage 0 CDP animation, scroll-scrub, Canvas2D, and shader blueprints into src/animations/
for (const forensicFile of [
  'animations-blueprint.json',
  'kinetic-scroll-matrix.json',
  'interaction-contracts.json',
  'canvas2d-blueprint.json',
  'webgl-shaders.json'
]) {
  const srcF = path.join(MIRROR_DIR, 'forensics', forensicFile);
  if (fs.existsSync(srcF)) {
    fs.copyFileSync(srcF, path.join(OUT_DIR, 'src', 'animations', forensicFile));
  }
}

// 4. Universal Stage 1 Mode C Entrypoint
const mainEntry = [
  '/**',
  ' * Stage 1 Mode C Universal Kinetic & Media Runtime Entrypoint',
  ' * Zero mirrored .built.js / .min.js chunks — executes strictly decoded ES source modules.',
  ' */',
  ...standaloneImports.map((imp) => `import '${imp}';`),
  '',
  'export function mountKineticSurface() {',
  '  const rootEl = document.documentElement;',
  '  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;',
  '  rootEl.classList.remove("no-js");',
  '  rootEl.classList.add("js");',
  '  if (!reducedMotion) rootEl.classList.add("enhanced");',
  '}',
  '',
  'if (typeof window !== "undefined") {',
  '  if (document.readyState === "loading") {',
  '    document.addEventListener("DOMContentLoaded", () => mountKineticSurface(), { once: true });',
  '  } else {',
  '    mountKineticSurface();',
  '  }',
  '}',
  ''
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, 'src', 'main.js'), mainEntry, 'utf8');

// 5. Clean & format all route HTML files (stripping all .built.js/.min.js script tags)
async function cleanRouteHtml(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'src', 'forensics', '__api_fixtures__', '__external'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await cleanRouteHtml(full);
    else if (entry.isFile() && entry.name.endsWith('.html')) {
      let html = fs.readFileSync(full, 'utf8');
      html = html.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, '');
      html = html.replace(/<a\b([^>]*?)\s+aria-hidden=["']true["']/gi, '<a$1');
      html = html.replace(/<img\b([^>]*?)>/gi, (match, attrs) => {
        let updated = attrs;
        if (!/\bwidth=/i.test(attrs) || !/\bheight=/i.test(attrs)) {
          const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
          const dim = srcMatch ? imageDimensions[srcMatch[1]] || imageDimensions[srcMatch[1].split('/').pop() || ''] : null;
          if (dim) {
            if (!/\bwidth=/i.test(attrs)) updated += ` width="${dim[0]}"`;
            if (!/\bheight=/i.test(attrs)) updated += ` height="${dim[1]}"`;
          } else if (/\bloading=["']lazy["']/i.test(updated)) {
            updated = updated.replace(/\bloading=["']lazy["']/i, 'loading="eager"');
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
      fs.writeFileSync(full, await formatSafeHtml(html), 'utf8');
    }
  }
}
await cleanRouteHtml(OUT_DIR);
decomposeRouteSections(OUT_DIR);

const dependencies = {};
for (const v of unpackSummary.detectedVendors) {
  if (v === 'three') dependencies.three = '^0.174.0';
  if (v === 'gsap') dependencies.gsap = '^3.12.7';
  if (v === 'hls.js') dependencies['hls.js'] = '^1.6.0';
  if (v === 'lenis') dependencies.lenis = '^1.2.3';
}

const pkgJson = {
  name: 'stage1-native-kinetic',
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

console.log(
  `✅ Stage 1 Mode C Universal Decompilation completed into ${OUT_DIR} (${unpackSummary.shaderCount} shaders, 0 legacy chunks).`
);
