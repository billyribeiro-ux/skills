#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { assertStageCertified } from '../../shared/pipeline-gate.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const SOURCE_DIR = path.resolve(getArg('--source', './01-native'));
const OUT_FILE = path.resolve(getArg('--out', './02-svelte5/conversion-batches.json'));

console.log(`📋 Generating 4-Tier Flash-Safe Svelte 5 Micro-Batch Plan (Max 3 Files/Batch)`);
console.log(`  Source Native Stack: ${SOURCE_DIR}`);
console.log(`  Output Plan:         ${OUT_FILE}`);

assertStageCertified({ requiredStage: 1, dir: SOURCE_DIR, callerName: 'plan-svelte5-batches.mjs' });

const srcDir = path.join(SOURCE_DIR, 'src');
if (!fs.existsSync(srcDir)) {
  console.error(`❌ Source 'src' directory not found at: ${srcDir}`);
  process.exit(1);
}

function scanFiles(dir) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory() && f.name !== 'node_modules') list.push(...scanFiles(full));
    else if (
      f.isFile() &&
      (f.name.endsWith('.js') ||
        f.name.endsWith('.jsx') ||
        f.name.endsWith('.ts') ||
        f.name.endsWith('.tsx') ||
        f.name.endsWith('.glsl'))
    ) {
      list.push(full);
    }
  }
  return list;
}

const recoveryFile = path.join(SOURCE_DIR, 'forensics', 'source-recovery.json');
const recovery = fs.existsSync(recoveryFile) ? JSON.parse(fs.readFileSync(recoveryFile,'utf8')) : null;
const staticMode = recovery?.mode === 'B' || ['reconstructed-runtime', 'source-built-runtime'].includes(recovery?.runtimeStatus);
const allFiles = scanFiles(srcDir).filter(file => !staticMode || !/^(?:sections|reconstructed)\//.test(path.relative(srcDir,file)));
const fileMetadata = [];

for (const f of allFiles) {
  const rel = path.relative(srcDir, f).replace(/\\/g, '/');
  const base = path.basename(f);

  let tier = 1;
  let mode = 'Mode A (Component)';
  let targetSubpath = '';

  if (rel.startsWith('shaders/') || f.endsWith('.glsl')) {
    tier = 2;
    mode = 'Mode C (GLSL Shader)';
    targetSubpath = `src/lib/${rel}`;
  } else if (rel.startsWith('controllers/') || rel.startsWith('animations/')) {
    tier = 2;
    mode = 'Mode C (Kinetic Controller)';
    targetSubpath = `src/lib/${rel}`;
  } else if (rel.startsWith('sections/')) {
    tier = 3;
    mode = 'Pre-Sliced Route Section';
    targetSubpath = `src/lib/${rel.replace(/\.(jsx?|tsx?)$/, '.svelte')}`;
  } else if (f.endsWith('.jsx') || f.endsWith('.tsx')) {
    tier = 1;
    mode = 'Mode A (Interactive Island / UI)';
    targetSubpath = `src/lib/${rel.replace(/\.(jsx?|tsx?)$/, '.svelte')}`;
  } else {
    tier = 1;
    mode = 'Domain Utility';
    targetSubpath = `src/lib/${rel}`;
  }

  const importSubpath = targetSubpath
    .replace(/^src\/lib\//, '#lib/')
    .replace(/\.(ts|js)$/, '.js');

  fileMetadata.push({
    sourcePath: path.relative(SOURCE_DIR, f).replace(/\\/g, '/'),
    fileName: base,
    mode,
    tier,
    targetSubpath,
    importSubpath
  });
}

// Tier 4: Explicit Route Assembly Descriptor from route-section-map.json
const routeMapPath = path.join(SOURCE_DIR, 'forensics', 'route-section-map.json');
const routeAssemblyGuide = {};
if (fs.existsSync(routeMapPath)) {
  try {
    const parsedMap = JSON.parse(fs.readFileSync(routeMapPath, 'utf8'));
    for (const [route, info] of Object.entries(parsedMap)) {
      const routeFile =
        route === '/'
          ? 'src/routes/+page.svelte'
          : `src/routes/${route.replace(/^\/+/, '').replace(/\/+$/, '')}/+page.svelte`;
      routeAssemblyGuide[route] = {
        routeFile,
        orderedSectionImports: (info.sections || []).map((s) => ({
          componentName: s.componentName,
          svelteImport: `#lib/sections/${info.routeSlug}/${s.componentName}.svelte`
        }))
      };
    }
  } catch { }
}

fileMetadata.sort((a, b) => a.tier - b.tier || a.sourcePath.localeCompare(b.sourcePath));

const BATCH_SIZE = 3;
const batches = [];
for (let i = 0; i < fileMetadata.length; i += BATCH_SIZE) {
  const chunk = fileMetadata.slice(i, i + BATCH_SIZE);
  batches.push({
    batchIndex: Math.floor(i / BATCH_SIZE) + 1,
    tier: chunk[0].tier,
    fileCount: chunk.length,
    files: chunk
  });
}

const plan = {
  totalFiles: fileMetadata.length,
  totalBatches: batches.length,
  batchSizeLimit: 3,
  strategy:
    'Flash-Safe 4-Tier Bottom-Up Plan: Tier 1 Islands/Utils -> Tier 2 Shaders/Controllers -> Tier 3 Pre-Sliced Route Sections -> Tier 4 Route Assembly',
  routeAssemblyGuide,
  batches
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(plan, null, 2), 'utf8');

console.log(`✅ 4-Tier Flash-Safe Plan written to: ${OUT_FILE}`);
console.log(`  Total Files:   ${fileMetadata.length}`);
console.log(`  Total Batches: ${batches.length} (Max 3 files/batch)`);
console.log(`  Routes Mapped: ${Object.keys(routeAssemblyGuide).length}`);
