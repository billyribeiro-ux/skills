---
name: svelte5-stack-converter
description: >
  Stage 2 Ground-Truth Native Stack -> SvelteKit 3.2+ & Svelte 5 Strict Runes Converter.
  Translates chunk-free Stage 1 source (./01-native/ on :3011) and Stage 0 CDP animation/layout forensics
  into production Svelte 5 (./02-svelte5/ on :3012) via 3-4 file micro-batches, @sveltejs/mcp auditing,
  motion-preserving attachments, and an unmasked 5-Gate Nuclear Parity Verifier across 100% of routes.
---

# Stage 2 — `svelte5-stack-converter`

## Overview
`svelte5-stack-converter` translates the completely decoded, chunk-free Stage 1 codebase (`./01-native/` on `:3011`) + Stage 0 Chrome CDP forensics (`./02-svelte5/forensics/*`) into an idiomatic, production-ready **SvelteKit 3.2+ and Svelte 5 Runes** application (`./02-svelte5/` on `:3012`).

---

## 0. Nuclear Stage-Lock, Anti-Cheat & Architectural Invariants

0. **Mandatory Stage 0 + Stage 1 Certification Locks (`stage0-cert.json` + `stage1-cert.json`):**
   - `scaffold-sveltekit3.mjs`, `plan-svelte5-batches.mjs`, `preconvert-jsx-markup.mjs`, and `verify-stage2-svelte5.mjs` hard-fail immediately unless **both** `00-mirror/forensics/stage0-cert.json` and `01-native/forensics/stage1-cert.json` exist and match current on-disk hashes. Stage 2 can **never** run on an unverified or stale Stage 1 baseline.
1. **Zero Cheats, Zero Generic AST Wrappers, Zero Placeholders:**
   - Strictly banned: `{#if false}`, `react-dom`/`createRoot`, `verbatim-dom.json`, generic recursive DOM-AST shells (`RichNode`/`AstNode`), whole-section `{@html}` dumps, `hooks.server.ts` body hijacking, `svelte.config.js` (SvelteKit 3 configures inside `vite.config.ts`), ANY `.js`/`.html` file inside `static/`, `<script src="...">` external bundle tags, or unconverted `scaffold-placeholder` routes.
2. **100% Animation, Shader & Behavioral Preservation:**
   - Never drop Framer Motion props (`initial`, `animate`, `whileInView`, `whileHover`, `whileTap`, `transition`), GSAP `ScrollTrigger`s, Canvas 2D loops, WebGL shaders (`src/lib/shaders/*.glsl`), or HLS video players!
   - `ast-jsx-to-svelte.mjs` automatically converts `<motion.*>` props into Svelte 5 `{@attach animateMotion(...)}` (`#lib/motion/motionAttachment.js`).
   - Keep Three.js/WebGL/Canvas/GSAP instances out of deep `$state()` proxies—use `Attachment<HTMLElement>` (`{@attach ...}`) with deterministic teardown functions or `$state.raw()`.
   - Cross-check `forensics/animations-blueprint.json`, `kinetic-scroll-matrix.json`, and `interaction-contracts.json` so every easing curve, scroll-scrub trajectory, accordion/tab/dialog toggle, and Escape handler matches 1:1.
3. **Canonical Svelte 5 & `@sveltejs/mcp` Compliance:**
   - Always query `@sveltejs/mcp` (`list-sections` -> `get-documentation`) and validate every `.svelte` / `.svelte.ts` file with `svelte-autofixer` until **0 issues and 0 suggestions** remain.
   - Never use array index as a `{#each}` key—always key by unique item identity (`item.id ?? item.slug ?? item`).
   - Use `#lib/` subpath imports, `$props()`, `$state()`, `$derived()`, `<svelte:window>` / `<svelte:document>` for global listeners, lowercase event attributes (`onclick`), explicit `<img>` `width`/`height`, and valid `<label for>` + `autocomplete`.

---

## Execution Workflow

### Step 1: Scaffold SvelteKit 3.2 + Svelte 5 Workspace
```bash
node .agent/skills/svelte5-stack-converter/scripts/scaffold-sveltekit3.mjs \
  --source ./01-native \
  --target ./02-svelte5 \
  --port 3012

cd ./02-svelte5 && pnpm install && cd ..
```
Scaffolds `vite.config.ts` (`strictPort: true` on `3012`), `src/lib/motion/motionAttachment.ts`, `src/hooks.server.ts` (API fixtures + HLS `.m3u8`/`.ts` + HTTP `206 Partial Content`), copies verified media/fonts into `static/`, forwards all `forensics/*.json` + `src/lib/data/` + `src/lib/shaders/`, and creates route skeletons for every route in `routes-manifest.json`.

### Step 2: Generate Topological Micro-Batch Plan (3–4 Files Max)
```bash
node .agent/skills/svelte5-stack-converter/scripts/plan-svelte5-batches.mjs \
  --source ./01-native \
  --out ./02-svelte5/conversion-batches.json
```

### Step 3: Micro-Batch Conversion Loop
For each batch `<N>`:
```bash
# 1. Babel AST Pre-Conversion (preserving motion props via @attach animateMotion)
node .agent/skills/svelte5-stack-converter/scripts/preconvert-jsx-markup.mjs \
  --batch <N> \
  --source ./01-native \
  --target ./02-svelte5

# 2. Refine Svelte 5 Runes, types, controllers & styles against ./02-svelte5/forensics/*

# 3. Mandatory Official @sveltejs/mcp Autofixer + Strict TypeScript Check (--fail-on-warnings)
node .agent/skills/svelte5-stack-converter/scripts/audit-svelte5-mcp.mjs --app ./02-svelte5 --batch <N>
cd ./02-svelte5 && pnpm check && cd ..
```

### Step 4: Final Dual-Baseline 5-Gate Nuclear Certification (100% of Routes, Unmasked)
```bash
# Ensure :3010 (Stage 0), :3011 (Stage 1), and :3012 (Stage 2: cd ./02-svelte5 && pnpm dev) are running, then execute:
node .agent/skills/svelte5-stack-converter/scripts/verify-stage2-svelte5.mjs \
  --mirror-url http://localhost:3010 \
  --native-url http://localhost:3011 \
  --svelte-url http://localhost:3012 \
  --mirror-dir ./00-mirror \
  --native-dir ./01-native \
  --svelte-dir ./02-svelte5

# Optional standalone Gate 5 Living Canvas & Interaction Audit:
node .agent/skills/svelte5-stack-converter/scripts/verify-kinetic-parity.mjs \
  --url http://localhost:3012 \
  --mirror http://localhost:3010 \
  --svelte-dir ./02-svelte5
```

All **5 Nuclear Gates** must pass simultaneously (minting `02-svelte5/forensics/stage2-cert.json`):
1. **Gate 1:** Anti-Cheat, Zero Static JS Bundles, No Generic AST Wrappers & 100% Captured Route Completeness.
2. **Gate 2:** Author-Grade Human Code Quality (`verify-human-code-quality.mjs` across all `.svelte` `<script>`, `.ts`, `.js`, `.css`).
3. **Gate 3:** `svelte-check --fail-on-warnings` (`0` errors, `0` warnings) + `@sveltejs/mcp` (`0` issues, `0` suggestions).
4. **Gate 4:** Dual-Baseline Unmasked Multi-Viewport (`1440x900`, `768x1024`, `390x844`) Visual (`<= 0.20%` pixelmatch vs BOTH `:3011` and `:3010`), Layout (`<= 4px` scroll vs BOTH, `<= 2px` landmarks), Zero Overflow, Zero 404s, Zero Network Escapes, and Zero CDP CLS/Stylesheet Issues.
5. **Gate 5 (Site-Agnostic Kinetic, Living Canvas & Interaction Parity):**
   - Driven automatically by `forensics/animations-blueprint.json`, `webgl-shaders.json`, `canvas2d-blueprint.json`, and `interaction-contracts.json`: verifies every `<canvas>` initializes an active context & draws non-zero pixels (`drawCalls > 0`), verifies RAF liveness, checks `mountReveals` (zero stuck `opacity: 0` elements), checks Lenis when present in Stage 0, and verifies disclosures/tabs toggle cleanly.

Read `references/post-mortem-learnings.md` before starting and before sign-off.
