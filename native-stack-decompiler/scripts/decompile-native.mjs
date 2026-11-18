#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { assertStageCertified } from '../../shared/pipeline-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const MIRROR_DIR = path.resolve(getArg('--mirror-dir', './00-mirror'));
const OUT_DIR = path.resolve(getArg('--out-dir', './01-native'));
const explicitMode = getArg('--mode', 'auto').toUpperCase();

console.log(`🚀 Stage 1 Master Decompiler Dispatcher`);
console.log(`  Source Mirror: ${MIRROR_DIR}`);
console.log(`  Output Native: ${OUT_DIR}`);

// Enforce hard prerequisite: Stage 0 mirror MUST be verified & unmutated before Stage 1 decompilation runs
assertStageCertified({ requiredStage: 0, dir: MIRROR_DIR, callerName: 'decompile-native.mjs' });

let mode = explicitMode;
if (mode === 'AUTO') {
  const fingerprintPath = path.join(MIRROR_DIR, 'forensics', 'stack-fingerprint.json');
  if (fs.existsSync(fingerprintPath)) {
    try {
      const fp = JSON.parse(fs.readFileSync(fingerprintPath, 'utf8'));
      const modes = Object.values(fp).map(v => v.mode);
      if (modes.includes('A')) mode = 'A';
      else if (modes.includes('C')) mode = 'C';
      else mode = 'B';
    } catch {
      mode = 'B';
    }
  } else {
    // Heuristic detection
    const html = fs.existsSync(path.join(MIRROR_DIR, 'index.html'))
      ? fs.readFileSync(path.join(MIRROR_DIR, 'index.html'), 'utf8')
      : '';
    if (html.includes('self.__next_f') || html.includes('_next/static') || html.includes('data-reactroot')) {
      mode = 'A';
    } else if (html.includes('data-component-list') || html.includes('BubbleGum') || html.includes('data-anim-scroll-group')) {
      mode = 'C';
    } else {
      mode = 'B';
    }
  }
}

console.log(`🎯 Routing to Mode ${mode} Decompiler...`);

let scriptName = 'decode-mode-b-static.mjs';
if (mode === 'A') scriptName = 'decode-mode-a-framework.mjs';
else if (mode === 'C') scriptName = 'decode-mode-c-custom-engine.mjs';

const targetScript = path.join(__dirname, scriptName);
const child = fork(targetScript, ['--mirror-dir', MIRROR_DIR, '--out-dir', OUT_DIR], { stdio: 'inherit' });

function runPostDecompileAudit(outDir) {
  const issues = [];
  const skipDirs = new Set(['node_modules', '.git', 'forensics', '__api_fixtures__', '__external','recovered-source','.native-tools']);

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.isFile() && entry.name.endsWith('.css')) {
        try {
          postcss.parse(fs.readFileSync(full, 'utf8'));
        } catch (err) {
          issues.push(`CSS Syntax Error in ${path.relative(outDir, full)}: ${err.message}`);
        }
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const html = fs.readFileSync(full, 'utf8');
        const rel = path.relative(outDir, full);
        if (/<template\b[^>]*\bid=["']B:\d+["']/i.test(html) || /<div\b[^>]*\bid=["']S:\d+["']/i.test(html)) {
          issues.push(`Unresolved React Suspense boundary (B:x/S:x) in ${rel}`);
        }
        if (html.includes('>><pre')) {
          issues.push(`Corrupted ">><pre" tag sequence in ${rel}`);
        }
      }
    }
  }
  scan(outDir);

  if (issues.length > 0) {
    console.error(`\n❌ Post-Decompile Integrity Check FAILED (${issues.length} issue(s)):`);
    for (const iss of issues.slice(0, 15)) console.error(`  - ${iss}`);
    process.exit(1);
  }
  console.log(`  ✅ Post-Decompile Integrity Check passed (0 CSS syntax errors, 0 unresolved Suspense boundaries, 0 malformed tags).`);
}

child.on('exit', (code) => {
  if (code === 0) {
    runPostDecompileAudit(OUT_DIR);
    const evidence = JSON.parse(fs.readFileSync(path.join(OUT_DIR,'forensics','source-recovery.json')));
    if (evidence.runtimeStatus === 'requires-runtime-reconstruction') {
      console.error('Partial native output retained. Runtime reconstruction is required. See forensics/source-recovery.json.');
      process.exitCode = 2;
      return;
    }
    console.log(`Generated ${evidence.runtimeStatus}. Run Stage 1 verification before advancing.`);
  } else {
    console.error(`❌ Stage 1 Decompilation failed with exit code ${code}.`);
    process.exit(code || 1);
  }
});

