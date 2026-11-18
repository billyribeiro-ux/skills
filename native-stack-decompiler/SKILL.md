---
name: native-stack-decompiler
description: Stage 1 Zero-Chunk Native Stack & End-to-End Animation Decompiler. Unpacks bundler module registries, RSC Flight trees, GLSL shaders, and CDP animation curves from ./00-mirror/ into 100% chunk-free, author-grade first-party code in ./01-native/ (:3011), enforced by an unbypassable Anti-Chunk + Unmasked Visual/Kinetic Dual Gate.
---

# Stage 1 — `native-stack-decompiler`

## Overview
`native-stack-decompiler` executes **Stage 1** of the Antigravity 3-Stage Pipeline. Using `./00-mirror/` (`:3010`) and `./00-mirror/forensics/*` as ground truth, it decodes **every single component, module, stylesheet, shader, canvas renderer, and animation** end-to-end into clean, human-authored, stack-agnostic source in `./01-native/src/` served on `http://localhost:3011`.

---

## Nuclear Law: STAGE LOCK + ZERO CHUNK-BYPASS (`CHUNK_BYPASS_DETECTED`)

0. **Cryptographic Stage 0 Gate (`stage0-cert.json`):**
   - `decompile-native.mjs` and `verify-stage1-native.mjs` strictly refuse to run unless `00-mirror/forensics/stage0-cert.json` exists and matches `./00-mirror`'s SHA-256 content digest.
1. **Zero Mirrored JS Bundles in `./01-native/`:**
   - Copying or serving `_next/static/chunks/*.js`, `turbopack-*.js`, `webpack-*.js`, `chunk-*.js`, `*.min.js`, `*.built.js`, or `self.__next_f` inside `./01-native/` is **STRICTLY FORBIDDEN**.
   - `serve-native.mjs` enforces `HTTP 403 CHUNK_BYPASS_FORBIDDEN` on any bundler chunk URL, `verify-human-code-quality.mjs` scans `./01-native/` (also rejecting unresolved `$RC`/`$RS` Suspense shells & generic AST wrappers), and `verify-stage1-native.mjs` audits live browser script requests + Living Canvases/Mount Reveals on `:3011`, minting `stage1-cert.json` ONLY upon 100%-route parity with `:3010`.
2. **True Per-Module Bundler Unpacking (`unpack-bundler-modules.mjs`):**
   - Never dump multi-module `webcrack` chunk files (`04ai5m7_557lv.jsx`) into `src/components/`.
   - Unpack individual Webpack/Turbopack module factories by `moduleId`, separate third-party vendor packages (`react`, `three`, `gsap`, `hls.js`, `lenis`) into `package.json`, map RSC Flight exports (`I[moduleId, [...], "ExportName"]`) and route payloads (`src/data/routes/*.json`), reconstruct compiled `.jsx()`/`.jsxs()` calls into genuine `<Tag>` JSX (`ast-humanizer.mjs`), and extract GLSL shaders into `src/shaders/*.glsl`.
3. **End-to-End Animation & Behavioral Decoding:**
   - Cross-reference `./00-mirror/forensics/animations-blueprint.json`, `kinetic-scroll-matrix.json`, `interaction-contracts.json`, `dom-component-blueprint.json`, and `webgl-shaders.json` (plus live Chrome DevTools inspection when needed) so **every** scroll scrub, WAAPI/CSS keyframe, `cubic-bezier` curve, Canvas 2D / WebGL shader loop, modal/dialog, tab, accordion, and hover interaction is explicitly implemented in clean, documented modules inside `./01-native/src/` — ready to be ported 1:1 to Svelte 5 or any other stack.
4. **Author-Grade Code Standard:**
   - Zero hashed/opaque filenames, zero bundler tokens, zero compiled `.jsx()` calls, zero `!0`/`!1`/`void 0`/comma `SequenceExpression`s/Yoda comparisons/Rollup `Symbol.toStringTag` wrappers, zero single-letter or synthetic dummy locals (`elem`, `localValue`, `nextVal`, `target2`), multi-line formatted HTML (`htmlWhitespaceSensitivity: "strict"`), paired CSS vendor prefixes, quoted single-line data URIs, valid `<label for>` + `autocomplete`, and explicit `<img>` `width`/`height`.

---

## CLI Execution Workflow

```bash
# 1. Automated Bundler Unpacking, RSC Decoding, Shader Extraction & AST Humanization
node .agent/skills/native-stack-decompiler/scripts/decompile-native.mjs \
  --mirror-dir "./00-mirror" \
  --out-dir "./01-native" \
  --mode auto

# 2. Inspect ./00-mirror/forensics/* and refine ./01-native/src/ until every route,
#    component, shader, canvas renderer, and interactive state works natively from src/

# 3. Serve Stage 1 Native App on :3011 (Zero-Chunk Enforced)
node .agent/skills/native-stack-decompiler/scripts/serve-native.mjs \
  --dir "./01-native" \
  --port 3011

# 4. Run Mandatory Dual Gate (Gate 1 AST/Anti-Chunk + Gate 2 Unmasked Visual & Kinetic Parity across 100% of routes)
node .agent/skills/native-stack-decompiler/scripts/verify-stage1-native.mjs \
  --mirror "http://localhost:3010" \
  --native "http://localhost:3011" \
  --mirror-dir "./00-mirror" \
  --native-dir "./01-native"
```

Read `references/post-mortem-learnings.md` before decompiling and sign-off.
