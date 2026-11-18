# Antigravity Global Skill Vault — Nuclear 3-Stage Ground-Truth Cloning Router

## 0. Ironclad Engineering Mandate (Zero Chunk-Bypass, Zero Masks, Zero Lies)

Every target URL MUST progress sequentially through **Stage 0 -> Stage 1 -> Stage 2**. Every single module, component, stylesheet, shader, canvas renderer, and animation curve MUST be reverse-engineered end-to-end into authentic, stack-agnostic first-party source code—as if the original engineering team handed over their internal repository.

```
[Target URL]
     │
     ▼
Stage 0: Air-Gapped Ground-Truth Mirror + Deep Chrome CDP Forensics
     │  - Skill: har-ground-truth-mirror
     │  - Output: ./00-mirror/ served on http://localhost:3010
     │  - Mandatory Forensics (./00-mirror/forensics/):
     │      ├─ routes-manifest.json (100% auto-discovered internal routes)
     │      ├─ stack-fingerprint.json & image-dimensions.json (PNG/JPEG/WEBP/AVIF/SVG)
     │      ├─ animations-blueprint.json (CDP Animation + WAAPI keyframes/easings + @keyframes + GSAP/ScrollTrigger)
     │      ├─ kinetic-scroll-matrix.json (21-step 0%->100% scroll transform/opacity/sticky/video trajectories)
     │      ├─ interaction-contracts.json (CDP DOMDebugger listeners, mountReveals & state diffs)
     │      ├─ dom-component-blueprint.json (3-viewport computed layout/typography tree & inline SVGs)
     │      ├─ webgl-shaders.json (GLSL vertex/fragment shaders + boot/hover/hold/scroll live uniforms)
     │      ├─ canvas2d-blueprint.json (Canvas 2D draw calls, fonts, DPR & fillStyle telemetry)
     │      └─ stage0-cert.json (Hash-pinned passport minted ONLY on 100%-route pass)
     │  - Gate: verify-stage0-mirror.mjs (Unmasked <= 0.5% pixelmatch, 0 404s, 0 escapes, 0 missing HLS segments)
     │
     ▼
Stage 1: Zero-Chunk Native Stack & Animation Decompilation (REQUIRES stage0-cert.json)
     │  - Skill: native-stack-decompiler (Mode A: Framework VDOM/RSC, Mode B: Static/CMS, Mode C: Custom Engine/WebGL)
     │  - Output: ./01-native/ served on http://localhost:3011
     │  - NUCLEAR LAW: ZERO mirrored bundler JS chunks (_next/static/chunks/*, turbopack*, webpack*, *.min.js, *.built.js)
     │    may exist in ./01-native/ or be requested on :3011! serve-native.mjs enforces HTTP 403 CHUNK_BYPASS_FORBIDDEN.
     │  - Mandatory Dual Gate:
     │      ├─ Gate 1: verify-human-code-quality.mjs (0 chunks, 0 hashed filenames, 0 .jsx() calls, 0 Suspense leaks, 0 AST wrappers)
     │      └─ Gate 2: verify-stage1-native.mjs (Unmasked <= 0.2% pixelmatch vs :3010 + Living Canvas/Reveal Parity -> mints stage1-cert.json)
     │
     ▼
Stage 2: Production Svelte 5 (Runes) + SvelteKit 3.2 Conversion (REQUIRES stage0-cert.json + stage1-cert.json)
        - Skill: svelte5-stack-converter
        - Output: ./02-svelte5/ served on http://localhost:3012 (strictPort: true)
        - Mandatory 5-Gate Nuclear Verifier (verify-stage2-svelte5.mjs -> mints stage2-cert.json):
            ├─ Gate 1: Zero-Tolerance Anti-Cheat, No Generic AST Wrappers & 100% Route Completeness
            ├─ Gate 2: Senior Human Code Quality (AST scan across all .svelte <script>, .ts, .js, and .css files)
            ├─ Gate 3: Strict TypeScript (--fail-on-warnings) + Official @sveltejs/mcp svelte-autofixer (0 issues/suggestions)
            ├─ Gate 4: Dual-Baseline Unmasked Visual & Layout Parity (<= 0.2% pixelmatch vs BOTH :3011 AND :3010)
            └─ Gate 5: Measured Kinetic Scroll-Scrub, Living Canvas (drawCalls/RAF), Mount Reveal & Interactive Parity
```

---

## 1. Non-Negotiable Nuclear Prohibitions (Automatic Gate Failure)

1. **FORBIDDEN — Chunk-Bypass Illusion:** Copying `_next/static/chunks/*.js`, `turbopack-*.js`, `webpack-*.js`, `*.min.js`, or `*.built.js` into `01-native` or `02-svelte5/static/`, or keeping `self.__next_f` script tags so `:3011` or `:3012` secretly runs Stage 0 bundles instead of decoded source. Both `verify-human-code-quality.mjs` and `serve-native.mjs` hard-fail on sight (`CHUNK_BYPASS_DETECTED`).
2. **FORBIDDEN — Raw Cracked Chunk Dumps:** Dumping unsplit `webcrack` chunks (`04ai5m7_557lv.jsx`) into `src/components/`. Every bundler chunk must be unpacked into individual module factories (`unpack-bundler-modules.mjs`), vendor modules separated into `package.json`, compiled `.jsx()`/`.jsxs()` calls reconstructed into real `<Tag>` JSX, and variables semantically renamed.
3. **FORBIDDEN — Blinding Canvases, Videos, or Animations During Verification:** Never inject `canvas { opacity: 0 }`, `video { visibility: hidden }`, canvas rectangle blackouts, or `HTMLMediaElement.prototype.play` blockers. All visual parity checks run **100% unmasked** using deterministic PRNG seeding, WAAPI timeline settling, and video `currentTime = 0` frame seeking.
4. **FORBIDDEN — Partial Route Auditing:** Verification scripts auto-load `00-mirror/forensics/routes-manifest.json`. Passing `--routes /` when 10 routes were captured triggers an immediate hard failure.
5. **FORBIDDEN — Dropping Animations During Svelte Conversion:** Never strip `initial`, `animate`, `whileInView`, `whileHover`, `whileTap`, `transition`, GSAP `ScrollTrigger`s, Canvas 2D loops, or WebGL shaders. All motion choreography must be translated into Svelte 5 `{@attach animateMotion(...)}` attachments, `$state.raw` WebGL/Canvas controllers, and CSS `@keyframes` matching `animations-blueprint.json` and `kinetic-scroll-matrix.json`.
6. **GIT-TRACKED IMMUTABLE VERIFICATION HARNESS:** All scripts inside `.agent/skills/*/scripts/` and `shared/` are Git-tracked inside `skill-vault`. Agents executing a clone are strictly forbidden from modifying, weakening, or bypassing any verification gate script.

---

## 2. Exact Command Execution Sequence

### Stage 0: Capture Mirror + Deep Chrome CDP Forensics (`:3010`)
```bash
node .agent/skills/har-ground-truth-mirror/scripts/capture-mirror.mjs --url "<TARGET_URL>" --out-dir "./00-mirror"
node .agent/skills/har-ground-truth-mirror/scripts/serve-mirror.mjs --dir "./00-mirror" --port 3010
node .agent/skills/har-ground-truth-mirror/scripts/verify-stage0-mirror.mjs --live "<TARGET_URL>" --local "http://localhost:3010" --mirror-dir "./00-mirror"
```

### Stage 1: End-to-End Native Stack & Animation Decompilation (`:3011`)
```bash
node .agent/skills/native-stack-decompiler/scripts/decompile-native.mjs --mirror-dir "./00-mirror" --out-dir "./01-native" --mode auto
# Refine every component, animation controller, Canvas/WebGL shader & route in ./01-native/src/ using ./00-mirror/forensics/*
node .agent/skills/native-stack-decompiler/scripts/serve-native.mjs --dir "./01-native" --port 3011
node .agent/skills/native-stack-decompiler/scripts/verify-stage1-native.mjs --mirror "http://localhost:3010" --native "http://localhost:3011" --mirror-dir "./00-mirror" --native-dir "./01-native"
```

### Stage 2: Svelte 5 Runes + SvelteKit 3.2 Conversion (`:3012`)
```bash
node .agent/skills/svelte5-stack-converter/scripts/scaffold-sveltekit3.mjs --source "./01-native" --target "./02-svelte5" --port 3012
cd ./02-svelte5 && pnpm install && cd ..
node .agent/skills/svelte5-stack-converter/scripts/plan-svelte5-batches.mjs --source "./01-native" --out "./02-svelte5/conversion-batches.json"
# Convert in 3-4 file micro-batches (using @sveltejs/mcp list-sections -> get-documentation -> svelte-autofixer):
node .agent/skills/svelte5-stack-converter/scripts/preconvert-jsx-markup.mjs --batch <N> --source "./01-native" --target "./02-svelte5"
node .agent/skills/svelte5-stack-converter/scripts/audit-svelte5-mcp.mjs --app "./02-svelte5" --batch <N>
cd ./02-svelte5 && pnpm check && pnpm dev --port 3012
# Final 5-Gate Certification across 100% of captured routes:
node .agent/skills/svelte5-stack-converter/scripts/verify-stage2-svelte5.mjs --native-url "http://localhost:3011" --svelte-url "http://localhost:3012" --native-dir "./01-native" --svelte-dir "./02-svelte5"
```
