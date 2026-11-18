#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const repoRoot = path.resolve(getArg('--repo', process.cwd()));
const outFile = path.resolve(getArg('--out', './audit-telemetry/codebase-surface-map.json'));

const IGNORE_DIRS = new Set(['node_modules', '.git', '.svelte-kit', '.next', 'dist', 'build', 'vendor', 'audit-telemetry']);

function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function classifyRoute(routePath) {
  const lower = routePath.toLowerCase();
  if (/admin|internal|super|manage|backoffice/.test(lower)) return 'admin-panel';
  if (/dashboard|app|workspace|portal|analytics|billing|settings|account|profile|projects/.test(lower)) return 'saas-workspace';
  if (/login|signin|signup|register|auth|forgot|onboarding/.test(lower)) return 'auth-onboarding';
  return 'public-marketing';
}

function dedupeRoutes(routes) {
  const seen = new Map();
  for (const r of routes) {
    if (!seen.has(r.route)) seen.set(r.route, r);
  }
  return Array.from(seen.values());
}

function detectFrameworkAndRoutes(files) {
  const routes = [];
  const interactiveComponents = [];
  let framework = 'vanilla-or-custom';

  for (const file of files) {
    const rel = path.relative(repoRoot, file).replace(/\\/g, '/');

    if (rel.startsWith('src/routes/') && /\+page\.(svelte|ts|js)$/.test(rel)) {
      framework = 'sveltekit';
      let routePath = '/' + rel
        .replace(/^src\/routes\//, '')
        .replace(/\/?\+page\.(svelte|ts|js)$/, '')
        .replace(/\([^)]+\)\/?/g, '');
      routePath = routePath.replace(/\/+/g, '/');
      if (routePath !== '/' && routePath.endsWith('/')) routePath = routePath.slice(0, -1);
      routes.push({
        route: routePath || '/',
        file: rel,
        isDynamic: /\[.*?\]/.test(routePath),
        category: classifyRoute(routePath)
      });
    }

    if ((rel.startsWith('app/') || rel.startsWith('src/app/')) && /\/page\.(tsx|jsx|ts|js)$/.test(rel)) {
      framework = 'nextjs-app';
      let routePath = '/' + rel
        .replace(/^(src\/)?app\//, '')
        .replace(/\/?page\.(tsx|jsx|ts|js)$/, '')
        .replace(/\([^)]+\)\/?/g, '');
      routePath = routePath.replace(/\/+/g, '/');
      routes.push({
        route: routePath || '/',
        file: rel,
        isDynamic: /\[.*?\]/.test(routePath),
        category: classifyRoute(routePath)
      });
    }

    if (/\.(svelte|tsx|jsx|vue|blade\.php|html)$/.test(rel)) {
      const content = fs.readFileSync(file, 'utf8');
      const signals = [];
      if (/modal|dialog|createDialog|showModal/i.test(content)) signals.push('modal-dialog');
      if (/drawer|sheet|slideover|offcanvas/i.test(content)) signals.push('slide-drawer');
      if (/cmdk|command-palette|MetaKey.*KeyK/i.test(content)) signals.push('command-palette');
      if (/table|datagrid|thead|tbody/i.test(content)) signals.push('data-table');
      if (/tabs|tablist|activeTab/i.test(content)) signals.push('tab-group');
      if (/dropdown|popover|menu/i.test(content)) signals.push('dropdown-popover');
      if (/chart|canvas|webgl|three|gsap/i.test(content)) signals.push('canvas-chart-motion');

      if (signals.length > 0) {
        interactiveComponents.push({ file: rel, signals });
      }
    }
  }

  return { framework, routes: dedupeRoutes(routes), interactiveComponents };
}

const allFiles = walkDir(repoRoot);
const surfaceMap = {
  scannedAt: new Date().toISOString(),
  repoRoot,
  ...detectFrameworkAndRoutes(allFiles)
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(surfaceMap, null, 2));
console.log(`✅ [codebase-route-scanner] Discovered ${surfaceMap.routes.length} routes and ${surfaceMap.interactiveComponents.length} stateful components -> ${outFile}`);
