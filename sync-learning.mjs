#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const skill = getArg('--skill', '');
const target = getArg('--target', 'unspecified-target');
const lesson = getArg('--lesson', '');

const VALID_SKILLS = ['har-ground-truth-mirror', 'native-stack-decompiler', 'svelte5-stack-converter'];
if (!VALID_SKILLS.includes(skill) || !lesson) {
  console.error('Usage: node ~/.antigravity/skill-vault/sync-learning.mjs --skill <har-ground-truth-mirror|native-stack-decompiler|svelte5-stack-converter> --target "<site-or-app>" --lesson "<hard-evidence learning>"');
  process.exit(1);
}

const vaultRoot = path.dirname(new URL(import.meta.url).pathname);
const logFile = path.join(vaultRoot, skill, 'references', 'post-mortem-learnings.md');

fs.mkdirSync(path.dirname(logFile), { recursive: true });
const entry = `\n## [${new Date().toISOString().slice(0, 10)}] Target: ${target}\n- **Hard-Evidence Rule:** ${lesson}\n`;
fs.appendFileSync(logFile, entry, 'utf8');
console.log(`✅ Logged post-mortem learning to ${skill}/references/post-mortem-learnings.md`);
