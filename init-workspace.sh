#!/usr/bin/env bash
set -euo pipefail

# Register this specific workflow in a new workspace. Existing project files are preserved.
target="${1:-.}"
mkdir -p "$target"
target="$(cd "$target" && pwd -P)"
vault="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
node --input-type=module - "$vault" "$target" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const [, , vault, target] = process.argv;
const skills = ['har-ground-truth-mirror','raw-dom-cloner','native-stack-decompiler','svelte5-stack-converter'];
const mappings = skills.map(name => [path.join('.agent','skills',name), path.join(vault,name)]);
mappings.push(
  ['clone.mjs', path.join(vault,'clone.mjs')],
  ['.agent/rules/pipeline-rules.md', path.join(vault,'pipeline-rules.md')],
  ['.agent/skills/VAULT_ROUTER.md', path.join(vault,'VAULT_ROUTER.md')],
  ['.antigravity/rules.md', path.join(vault,'har-ground-truth-mirror/.antigravity/rules.md')]
);
for (const [name,source] of mappings) {
  const dest = path.join(target,name);
  if (fs.lstatSync(dest,{throwIfNoEntry:false}) && (!fs.existsSync(dest) || fs.realpathSync(dest)!==fs.realpathSync(source))) {
    throw new Error('Already occupied: '+dest+'. Run the workflow directly or choose a new workspace.');
  }
}
for (const [name,source] of mappings) {
  const dest=path.join(target,name);
  if(fs.existsSync(dest)) continue;
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.symlinkSync(path.relative(path.dirname(dest),source),dest);
}
console.log('Run node clone.mjs URL in '+target);
JS
