#!/usr/bin/env bash
set -eo pipefail

TARGET_DIR="${1:-.}"
TARGET_PATH="$(cd "$TARGET_DIR" >/dev/null 2>&1 && pwd || (mkdir -p "$TARGET_DIR" && cd "$TARGET_DIR" >/dev/null 2>&1 && pwd))"
VAULT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

echo "🔗 Initializing Antigravity Nuclear 3-Stage Cloning Workspace at: $TARGET_PATH"
echo "📦 Master Vault Root: $VAULT_DIR"

mkdir -p "$TARGET_PATH/.agent/skills"
mkdir -p "$TARGET_PATH/.antigravity"

# Symlink strictly the 3 cloning pipeline skills (zero version skew, zero unrelated skills)
ln -sfn "$VAULT_DIR/har-ground-truth-mirror" "$TARGET_PATH/.agent/skills/har-ground-truth-mirror"
ln -sfn "$VAULT_DIR/har-ground-truth-mirror" "$TARGET_PATH/.agent/skills/raw-dom-cloner"
ln -sfn "$VAULT_DIR/native-stack-decompiler" "$TARGET_PATH/.agent/skills/native-stack-decompiler"
ln -sfn "$VAULT_DIR/svelte5-stack-converter" "$TARGET_PATH/.agent/skills/svelte5-stack-converter"

mkdir -p "$TARGET_PATH/.agent/rules"
if [ -f "$VAULT_DIR/pipeline-rules.md" ]; then
  ln -sfn "$VAULT_DIR/pipeline-rules.md" "$TARGET_PATH/.agent/rules/pipeline-rules.md"
fi
if [ -f "$VAULT_DIR/har-ground-truth-mirror/.antigravity/rules.md" ]; then
  ln -sfn "$VAULT_DIR/har-ground-truth-mirror/.antigravity/rules.md" "$TARGET_PATH/.antigravity/rules.md"
fi

cat << 'EOF' > "$TARGET_PATH/package.json"
{
  "name": "cloned-workspace",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "mirror:capture": "node .agent/skills/har-ground-truth-mirror/scripts/capture-mirror.mjs",
    "mirror:forensics": "node .agent/skills/har-ground-truth-mirror/scripts/extract-cdp-forensics.mjs",
    "mirror:serve": "node .agent/skills/har-ground-truth-mirror/scripts/serve-mirror.mjs",
    "mirror:verify": "node .agent/skills/har-ground-truth-mirror/scripts/verify-stage0-mirror.mjs",
    "native:decompile": "node .agent/skills/native-stack-decompiler/scripts/decompile-native.mjs",
    "native:quality": "node .agent/skills/native-stack-decompiler/scripts/verify-human-code-quality.mjs",
    "native:serve": "node .agent/skills/native-stack-decompiler/scripts/serve-native.mjs",
    "native:verify": "node .agent/skills/native-stack-decompiler/scripts/verify-stage1-native.mjs",
    "svelte:scaffold": "node .agent/skills/svelte5-stack-converter/scripts/scaffold-sveltekit3.mjs",
    "svelte:plan": "node .agent/skills/svelte5-stack-converter/scripts/plan-svelte5-batches.mjs",
    "svelte:preconvert": "node .agent/skills/svelte5-stack-converter/scripts/preconvert-jsx-markup.mjs",
    "svelte:audit": "node .agent/skills/svelte5-stack-converter/scripts/audit-svelte5-mcp.mjs",
    "svelte:verify": "node .agent/skills/svelte5-stack-converter/scripts/verify-stage2-svelte5.mjs",
    "svelte:kinetic": "node .agent/skills/svelte5-stack-converter/scripts/verify-kinetic-parity.mjs"
  }
}
EOF

echo -e "packages:\n  - '.'\n  - '01-native'\n  - '02-svelte5'" > "$TARGET_PATH/pnpm-workspace.yaml"

echo "✅ Workspace initialized via symlinks:"
ls -la "$TARGET_PATH/.agent/skills"
