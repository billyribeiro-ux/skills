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
import { classifyVendorModule } from './unpack-bundler-modules.mjs';
import { decomposeRouteSections } from './decompose-route-sections.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_DIR = path.resolve(getArg('--mirror-dir', './00-mirror'));
const OUT_DIR = path.resolve(getArg('--out-dir', './01-native'));

console.log(`📄 Stage 1 Mode B Decompiler: Clean Static / CMS Architecture (Zero-Chunk)`);
console.log(`  Mirror Source: ${MIRROR_DIR}`);
console.log(`  Output Native: ${OUT_DIR}`);

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}

fs.mkdirSync(path.join(OUT_DIR, 'src', 'controllers'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'src', 'styles'), { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'forensics'), { recursive: true });

function copyStaticAssetsWithoutJs(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (['node_modules', '.git', '__sourcemaps__'].includes(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyStaticAssetsWithoutJs(path.join(src, child), path.join(dest, child));
    }
  } else {
    if (src.endsWith('.js') || src.endsWith('.mjs')) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

copyStaticAssetsWithoutJs(MIRROR_DIR, OUT_DIR);

let imageDimensions = {};
const dimFile = path.join(MIRROR_DIR, 'forensics', 'image-dimensions.json');
if (fs.existsSync(dimFile)) {
  try {
    imageDimensions = JSON.parse(fs.readFileSync(dimFile, 'utf8'));
  } catch { }
}

// Extract top-level :root tokens & sanitize all CSS files
const tokens = new Map();
function sanitizeAllCss(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'forensics', '__api_fixtures__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sanitizeAllCss(full);
    else if (entry.isFile() && entry.name.endsWith('.css')) {
      const raw = fs.readFileSync(full, 'utf8');
      try {
        const root = postcss.parse(raw);
        for (const node of root.nodes) {
          if (node.type === 'rule' && node.selector === ':root') {
            node.walkDecls((d) => {
              if (d.prop.startsWith('--') && !tokens.has(d.prop)) tokens.set(d.prop, d.value);
            });
          }
        }
      } catch { }
      fs.writeFileSync(full, sanitizeAndFormatCss(raw), 'utf8');
    }
  }
}
sanitizeAllCss(OUT_DIR);

let tokensCss = ':root {\n';
for (const [k, v] of tokens.entries()) {
  tokensCss += `  ${k}: ${v};\n`;
}
tokensCss += '}\n';
fs.writeFileSync(path.join(OUT_DIR, 'src', 'styles', 'tokens.css'), tokensCss, 'utf8');

// Humanize first-party JS scripts from mirror into src/controllers/
const controllerImports = [];
let ctrlIdx = 1;
async function decompileFirstPartyScripts(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '__sourcemaps__', 'forensics', '__api_fixtures__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await decompileFirstPartyScripts(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const raw = fs.readFileSync(full, 'utf8');
      if (raw.length > 65000 || classifyVendorModule(raw)) continue;
      const cleanBase = path
        .basename(entry.name, '.js')
        .replace(/\.(?:min|built|bundle)$/i, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
      const moduleName = cleanBase && !/^\d/.test(cleanBase) ? `${cleanBase}Controller` : `SiteController${ctrlIdx++}`;
      const humanized = await humanizeJavaScript(raw, { jsx: false });
      if (humanized.split('\n').length <= 1400) {
        fs.writeFileSync(path.join(OUT_DIR, 'src', 'controllers', `${moduleName}.js`), humanized, 'utf8');
        controllerImports.push(`./controllers/${moduleName}.js`);
      }
    }
  }
}
await decompileFirstPartyScripts(MIRROR_DIR);

const mainJsLines = [
  '/**',
  ' * Stage 1 Mode B Entrypoint — Clean Semantic Static Architecture',
  ' */',
  ...controllerImports.map((imp) => `import '${imp}';`),
  '',
  'export function initStaticSurface() {',
  '  document.documentElement.classList.remove("no-js");',
  '  document.documentElement.classList.add("js");',
  '}',
  '',
  'if (typeof window !== "undefined") {',
  '  initStaticSurface();',
  '}',
  ''
];
fs.writeFileSync(path.join(OUT_DIR, 'src', 'main.js'), mainJsLines.join('\n'), 'utf8');

// Format multi-line HTML, harmonize forms, inject image dimensions, and replace script bundles with /src/main.js
async function formatAllRouteHtml(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'src', 'forensics', '__api_fixtures__', '__external'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await formatAllRouteHtml(full);
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
await formatAllRouteHtml(OUT_DIR);
decomposeRouteSections(OUT_DIR);

const pkgJson = {
  name: 'stage1-native-static',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: {
    dev: 'node ../.agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir . --port 3011',
    start: 'node ../.agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir . --port 3011'
  }
};
fs.writeFileSync(path.join(OUT_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');

console.log(`✅ Stage 1 Mode B Decompilation completed into ${OUT_DIR}`);
