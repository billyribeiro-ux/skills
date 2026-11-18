# Antigravity Autonomous Ground-Truth Pipeline Rules

## 1. Permanent 3-Stage Progression
Every clone or modernization task must strictly advance through the 3 deterministic stages:
- **Stage 0 (`./00-mirror/` on `:3010`):** Air-gapped forensic capture with exact per-route CSS isolation, binary magic-byte validation, deep media harvesting, authentic API fixtures, and HTTP 206 range streaming.
- **Stage 1 (`./01-native/` on `:3011`):** Universal native stack decompiler (React/Next.js VDOM, Static/CMS, or Custom JS/WebGL) producing 100% human-readable, author-grade code validated by Dual Gate (AST Code Quality + Visual/Kinetic Parity).
- **Stage 2 (`./02-svelte5/` on `:3012`):** Modern SvelteKit 3.1+ & Svelte 5 Strict Runes conversion via dependency-ranked micro-batches, `#lib/` subpaths, and pragmatic strict TypeScript.

---

## 2. Non-Negotiable Invariants: The "Developer Hand-Off" Standard

### Invariant 1: Domain-Authentic Entity Naming (Zero Opaque Chunks)
- In Stage 1 (`01-native`) and Stage 2 (`02-svelte5`), **all components must carry authentic domain names** derived from original exports, AST function identifiers, and DOM landmarks (e.g. `SiteNav`, `MainHeroStage`, `IdeStage`, `ReadmeExplorer`, `BlossomCarousel`, `PricingTicket`, `FloatingCapture`, `FaqAccordion`, `SiteFooter`).
- **Strictly Banned:**
  - Opaque bundler chunk names (`04ai5m7_557lv.jsx`, `chunk-*.js`, `module-*.js`).
  - Bundler runtime bootstrap pollution (`TURBOPACK`, `__webpack_require__`, `self.__next_f`, `Symbol.toStringTag` `Module` wrappers, `definePublicField`).
  - Minified idioms (`!0`, `!1`, `void 0`, `void (...)`, comma `SequenceExpression`s outside `for` headers, Yoda comparisons).
  - Dummy parameter/variable pools (`e, t, n, r, o, s, c, l`, `elem`, `nextVal`, `prevVal`, `target2`, `var_*`, `param_*`).

### Invariant 2: Anti-Monolithic Component Decomposition
- **Zero Monolithic Route HTML Dumps:**
  - Route files (such as `src/routes/+page.svelte` or `src/pages/HomePage.jsx`) are strictly forbidden from dumping raw multi-kilobyte DOM trees.
  - Route files must cleanly compose modular components imported from `#lib/components/` (or `src/components/`).
- **Svelte 5 Runes for Dynamic State:**
  - Interactive UI state (active tab, active carousel slide, modal open/close, tier pricing calculations) MUST use Svelte 5 runes: `$state()`, `$derived()`, `$props()`, `$effect()`.
  - Zero dead code cheats (`{#if false}`), zero `{@html}` DOM snapshots, zero `react-dom` runtime leaks inside Svelte code.

### Invariant 3: Target-Specific Overlay Mandate
- Dynamic popups and overlays (such as `FloatingCapture` email prompt) must be modularized with:
  - Cookie suppression (`tca-captured=1`, `tca-prompt-<location>=1`).
  - Delay timer timeouts and exit-intent `mouseleave` triggers.
  - Keyboard `Escape` listener and accessible ARIA dialog attributes (`role="dialog"`, `aria-modal="true"`).

### Invariant 4: Dynamic Kinetic & Living Parity (Zero Dead Canvases)
- **Zero Dead Canvases Mandate:**
  - Every `<canvas>` element (Hero WebGL spiral, ASCII curtain transition, Minimap scroll radar, Seam glyph fields, and Showcase cards) MUST have an active WebGL or 2D render loop attached.
  - Canvases that exist as inert HTML shells without an active context or drawing routine fail verification automatically.
- **Active Motion & Smooth Scroll Coordinator:**
  - Smooth scrolling engines (e.g. Lenis) must be active and wired in the root layout, intercepting wheel/touch inputs and maintaining continuous RAF interpolation.
- **Interactive State Machine Fidelity:**
  - Shader and canvas interactions (e.g. "Click & hold" -> "Keep holding" -> "Release") must react to pointer events (`pointerdown`, `pointermove`, `pointerup`), update state runes, mutate shader uniforms, and trigger visual transitions.
- **Dynamic Minimap / HUD Radars:**
  - Scroll progress and active viewport rectangles must be rendered live to HUD radar canvases as the user scrolls.

### Invariant 5: Multi-Gate Verification Standard
- **Gate 1 (AST Human Code Quality):**
  - Fails if any opaque filename, bundler token, minified idiom, or monolithic HTML dump exists.
- **Gate 2 (Static Visual & Layout Parity):**
  - Desktop `scrollHeight` delta `<= 2px` against `:3010`.
  - Landmark bounding-box delta `<= 1px`.
  - Stepped 50px scroll-scrub lockstep check.
  - `pixelmatch` visual diff `<= 0.2%`.
- **Gate 3 (Dynamic Kinetic & Living Parity):**
  - All `<canvas>` elements have non-null active WebGL2 or 2D contexts.
  - Pixel buffers change across consecutive RAF frames (zero frozen canvases).
  - Pointer interactions trigger active state machine transitions.
  - Lenis smooth scroll coordinator active and ticking.
- **Gate 4 (SvelteKit 3.2 & TypeScript Health):**
  - `svelte-check --tsconfig ./tsconfig.json` must yield **0 errors and 0 warnings**.
  - `@sveltejs/mcp` `svelte-autofixer` must yield **0 issues and 0 suggestions**.

---

## 3. Zero Binary / Media Corruption Tolerance
- Always validate binary magic bytes (`wOF2`, `\0asm`, `DRACO`, `OggS`, `«KTX 20»`, `ftyp`). Never trust HTTP 200 alone from edge CDNs.
- Route video files through HTTP 206 partial content range streaming to enable smooth video scrubs.
- Enforce explicit `width`/`height` or CSS `aspect-ratio` on all `loading="lazy"` images to guarantee zero CLS.
