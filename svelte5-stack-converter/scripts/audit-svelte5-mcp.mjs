#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const appDir = path.resolve(getArg('--app', './02-svelte5'));
const filesArg = getArg('--files', null);
const batchArg = getArg('--batch', null);
const planFile = path.resolve(getArg('--plan', path.join(appDir, 'conversion-batches.json')));

if (!fs.existsSync(appDir)) {
  console.error(`❌ Target Svelte app directory not found: ${appDir}`);
  process.exit(1);
}

// 1. Resolve exact Svelte semver version
let svelteVersion = '5.57.3';
const localPkgPath = path.join(appDir, 'package.json');
if (fs.existsSync(localPkgPath)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf8'));
    const depVer = pkg.devDependencies?.svelte || pkg.dependencies?.svelte;
    if (depVer) svelteVersion = depVer.replace(/^[\^~>=<]+/, '');
  } catch { }
}
const sveltePkgPath = path.join(appDir, 'node_modules', 'svelte', 'package.json');
if (fs.existsSync(sveltePkgPath)) {
  try {
    const sveltePkg = JSON.parse(fs.readFileSync(sveltePkgPath, 'utf8'));
    if (sveltePkg.version) svelteVersion = sveltePkg.version;
  } catch { }
}

// 2. Strictly require official @sveltejs/mcp structured autofixer (no loose CLI text scraping!)
let svelteAutofixer = null;
const mcpCandidatePaths = [
  path.join(appDir, 'node_modules', '@sveltejs/mcp', 'dist', 'handlers.mjs'),
  path.join(process.cwd(), 'node_modules', '@sveltejs/mcp', 'dist', 'handlers.mjs'),
  new URL('../../node_modules/@sveltejs/mcp/dist/handlers.mjs', import.meta.url).pathname
];

for (const cand of mcpCandidatePaths) {
  if (fs.existsSync(cand)) {
    try {
      const mod = await import(pathToFileURL(cand).href);
      if (typeof mod.svelteAutofixer === 'function') {
        svelteAutofixer = mod.svelteAutofixer;
        break;
      }
    } catch { }
  }
}

if (!svelteAutofixer) {
  console.error(`❌ @sveltejs/mcp is not installed in ${appDir}. Run 'pnpm install' inside ${appDir} first.`);
  process.exit(1);
}

async function runAutofixer(code, filename) {
  const result = await svelteAutofixer({
    code,
    filename,
    desired_svelte_version: svelteVersion
  });
  if (!result || !Array.isArray(result.issues) || !Array.isArray(result.suggestions)) {
    throw new Error(`Invalid structured response from @sveltejs/mcp svelteAutofixer for ${filename}`);
  }
  return result;
}

// 3. Collect Svelte files (HARD-FAIL on missing files or empty file set!)
function collectAllSvelteFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.svelte-kit' && entry.name !== '.git') {
        collectAllSvelteFiles(fullPath, acc);
      }
    } else if (
      entry.name.endsWith('.svelte') ||
      entry.name.endsWith('.svelte.ts') ||
      entry.name.endsWith('.svelte.js')
    ) {
      acc.push(fullPath);
    }
  }
  return acc;
}

let files = [];

if (filesArg) {
  const list = filesArg.split(',').map((f) => f.trim()).filter(Boolean);
  for (const item of list) {
    const full = path.isAbsolute(item) ? item : path.join(appDir, item);
    if (!fs.existsSync(full)) {
      console.error(`❌ Specified file does not exist: ${full}`);
      process.exit(1);
    }
    files.push(full);
  }
} else if (batchArg) {
  if (!fs.existsSync(planFile)) {
    console.error(`❌ Batch plan file not found: ${planFile}`);
    process.exit(1);
  }
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const batchNum = parseInt(batchArg, 10);
  const batch = plan.batches.find((b) => b.batchIndex === batchNum);
  if (!batch) {
    console.error(`❌ Batch #${batchNum} not found in plan.`);
    process.exit(1);
  }
  for (const f of batch.files) {
    const targetFile = path.join(appDir, f.targetSubpath);
    if (!fs.existsSync(targetFile)) {
      console.error(`❌ Batch target file missing: ${targetFile}`);
      process.exit(1);
    }
    if (
      targetFile.endsWith('.svelte') ||
      targetFile.endsWith('.svelte.ts') ||
      targetFile.endsWith('.svelte.js')
    ) {
      files.push(targetFile);
    }
  }
  if (files.length === 0) {
    console.log(`ℹ️ Batch #${batchNum} contains only non-Svelte modules (.ts/.js/.glsl); 0 Svelte files to autofix.`);
    process.exit(0);
  }
} else {
  files = collectAllSvelteFiles(path.join(appDir, 'src'));
}

files.sort();

if (files.length === 0) {
  console.error(`❌ [AUDIT FAIL] Zero Svelte files (.svelte/.svelte.ts/.svelte.js) found in ${appDir}!`);
  process.exit(1);
}

console.log(`🔍 Auditing ${files.length} Svelte 5 file(s) with official @sveltejs/mcp (Svelte v${svelteVersion})...`);

let totalIssues = 0;
let totalSuggestions = 0;
const findings = [];

for (const filePath of files) {
  const code = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath);
  const relPath = path.relative(appDir, filePath);

  const result = await runAutofixer(code, filename);
  if (result.issues.length > 0 || result.suggestions.length > 0) {
    totalIssues += result.issues.length;
    totalSuggestions += result.suggestions.length;
    findings.push({ relPath, issues: result.issues, suggestions: result.suggestions });
  }
}

if (findings.length > 0) {
  for (const item of findings) {
    console.error(`\n❌ [${item.relPath}]`);
    for (const issue of item.issues) console.error(`  ISSUE: ${issue}`);
    for (const suggestion of item.suggestions) console.error(`  SUGGESTION: ${suggestion}`);
  }
  console.error(
    `\n❌ @sveltejs/mcp audit failed: ${totalIssues} issue(s) and ${totalSuggestions} suggestion(s) across ${findings.length}/${files.length} files.`
  );
  process.exit(1);
} else {
  console.log(
    `\n✅ PASS: All ${files.length} Svelte 5 file(s) passed @sveltejs/mcp svelte-autofixer with 0 issues and 0 suggestions.`
  );
  process.exit(0);
}
