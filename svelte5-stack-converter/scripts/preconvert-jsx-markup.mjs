#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertJsxSourceToSvelte } from './ast-jsx-to-svelte.mjs';
import { assertStageCertified } from '../../shared/pipeline-gate.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const fileArg = getArg('--file', null);
const batchArg = getArg('--batch', null);
const sourceDir = path.resolve(getArg('--source', './01-native'));
const targetDir = path.resolve(getArg('--target', './02-svelte5'));
const planFile = path.resolve(getArg('--plan', path.join(targetDir, 'conversion-batches.json')));
const stdoutMode = args.includes('--stdout');

let cachedDims = null;
function loadDimensionsMap() {
  if (cachedDims) return cachedDims;
  cachedDims = {};
  const candidates = [
    path.join(targetDir, 'forensics', 'image-dimensions.json'),
    path.join(sourceDir, 'forensics', 'image-dimensions.json'),
    path.join(path.dirname(sourceDir), '00-mirror', 'forensics', 'image-dimensions.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        cachedDims = JSON.parse(fs.readFileSync(c, 'utf8'));
        break;
      } catch { }
    }
  }
  return cachedDims;
}

export function convertJsxToSvelte(sourceCode, options = {}) {
  const imgDims = loadDimensionsMap();
  const astResult = convertJsxSourceToSvelte(sourceCode, { ...options, imgDims });
  if (astResult) return astResult;

  // Fallback for raw HTML snippets
  let html = sourceCode
    .replace(/\{\/\*([\s\S]*?)\*\/\}/g, (_, comment) => `<!-- ${comment.trim()} -->`)
    .replace(/\bclassName=/g, 'class=')
    .replace(/\bhtmlFor=/g, 'for=')
    .replace(/\btabIndex=/g, 'tabindex=')
    .replace(/<a\b([^>]*?)\s+aria-hidden=["']true["']/gi, '<a$1');

  return `<script lang="ts">\n  let { class: className = '' }: { class?: string } = $props();\n</script>\n\n${html.trim()}\n`;
}

if (
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    (fs.existsSync(process.argv[1]) && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])))
) {
  if (fileArg) {
    const filePath = path.resolve(fileArg);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const base = path.basename(filePath);
    const compName = base.replace(/\.[^.]+$/, '');
    const converted = convertJsxToSvelte(content, { name: compName });

    if (stdoutMode) {
      process.stdout.write(converted);
    } else {
      const outPath = path.join(path.dirname(filePath), `${compName}.svelte`);
      fs.writeFileSync(outPath, converted, 'utf8');
      console.log(`✅ AST Pre-Converted ${filePath} -> ${outPath}`);
    }
  } else if (batchArg) {
    assertStageCertified({ requiredStage: 1, dir: sourceDir, callerName: 'preconvert-jsx-markup.mjs' });
    if (!fs.existsSync(planFile)) {
      console.error(`Error: Batch plan file not found: ${planFile}`);
      process.exit(1);
    }
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    const batchNum = parseInt(batchArg, 10);
    const batch = plan.batches.find((b) => b.batchIndex === batchNum);
    if (!batch) {
      console.error(`Error: Batch #${batchNum} not found in plan (total batches: ${plan.batches.length})`);
      process.exit(1);
    }

    console.log(`🚀 AST Pre-Converting Batch #${batchNum} (${batch.files.length} files)...`);
    for (const f of batch.files) {
      const fullSrcPath = path.join(sourceDir, f.sourcePath);
      if (!fs.existsSync(fullSrcPath)) {
        console.error(`❌ Source file missing: ${fullSrcPath}`);
        process.exit(1);
      }
      const targetFile = path.join(targetDir, f.targetSubpath);
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });

      const content = fs.readFileSync(fullSrcPath, 'utf8');
      if (targetFile.endsWith('.js') || targetFile.endsWith('.ts') || targetFile.endsWith('.glsl')) {
        fs.writeFileSync(targetFile, content, 'utf8');
        console.log(`  ✓ Copied module: ${f.sourcePath} -> ${f.targetSubpath}`);
      } else {
        const converted = convertJsxToSvelte(content, {
          name: f.fileName.replace(/\.[^.]+$/, '')
        });
        fs.writeFileSync(targetFile, converted, 'utf8');
        console.log(`  ✓ AST Pre-converted (preserving motion): ${f.sourcePath} -> ${f.targetSubpath}`);
      }
    }
    console.log(`Batch #${batchNum} Svelte 5 skeletons generated.`);
  } else {
    console.error(`Usage: node preconvert-jsx-markup.mjs --batch <N> | --file <Component.jsx>`);
    process.exit(1);
  }
}
