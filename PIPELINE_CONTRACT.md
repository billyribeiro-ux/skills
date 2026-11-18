# Antigravity Ground-Truth Pipeline Contract: The "Developer Hand-Off" Standard

> **Permanent Directive:** Every website or webapp cloned with the Antigravity Pipeline must be decoded and authored as if the original lead engineer handed you their clean, uncompiled Git repository. No shortcuts, no bundler debris, and no monolithic HTML dumps.

---

## 1. The Core Invariants

### Invariant 1: The "Developer Hand-Off" Domain Naming Mandate
- **Stage 1 (Native Stack):**
  - **Zero Opaque Chunk Hashes:** Banned from generating `04ai5m7_557lv.jsx`, `module-123.js`, or `chunk-*.jsx`.
  - **RSC Dynamic Resolution:** The decompiler must inspect RSC Flight manifests (`self.__next_f` / `I[moduleId, [chunks], "ExportName"]`) and AST function declarations to extract authentic component names.
  - **Output Components:** Every component in `01-native/src/components/` must be named after its real domain entity:
    - `SiteNav.jsx`
    - `MainHeroStage.jsx`
    - `MainHeroReel.jsx`
    - `IdeStage.jsx`
    - `IDE.jsx`
    - `ReadmeExplorer.jsx`
    - `BlossomCarousel.jsx` (TestimonialsCarousel)
    - `PricingTicket.jsx`
    - `EstimatePrintout.jsx`
    - `FaqAccordion.jsx`
    - `ShowcaseCreditsArea.jsx`
    - `FloatingCapture.jsx`
    - `EmailCapture.jsx`
    - `SiteFooter.jsx`
    - `IconMark.jsx`
    - `Minimap.jsx`
    - `GlyphSeam.jsx`
    - `GlyphFieldBackdrop.jsx`
    - `BenefitsSectionBackground.jsx`
    - `AnimatedText.jsx`
    - `AnimatedContent.jsx`
    - `SanityImage.jsx`
    - `SanityMuxVideo.jsx`
    - `AsciiImage.jsx`
    - `ReadingProgress.jsx`
    - `CheckoutFlow.jsx`
    - `RoadmapVoteButton.jsx`
    - `Credits.jsx`
    - `CrashScreen.jsx`
    - `Drawer.jsx`
    - `MotionProvider.jsx`
    - `Lenis.jsx`
  - **Zero Bundler Runtimes:** Turbopack bootstrap code, webpack runtime stubs, and Next.js internal context polyfills must be eradicated from `src/components/`.

### Invariant 2: Anti-Monolithic Component Decomposition (Stage 2)
- **Zero Monolithic Route HTML Dumps:**
  - `src/routes/+page.svelte` is strictly banned from containing monolithic static HTML dumps (e.g. 500KB rendered DOM walls).
  - Routes must compose clean, modular Svelte 5 components imported via `#lib/components/`:
    ```svelte
    <script lang="ts">
      import MainHeroStage from '#lib/components/MainHeroStage.svelte';
      import ReadmeExplorer from '#lib/components/ReadmeExplorer.svelte';
      import BlossomCarousel from '#lib/components/BlossomCarousel.svelte';
      import PricingTicket from '#lib/components/PricingTicket.svelte';
      import FaqAccordion from '#lib/components/FaqAccordion.svelte';
      import ShowcaseCreditsArea from '#lib/components/ShowcaseCreditsArea.svelte';
    </script>

    <main class="dive-track relative flex min-h-screen flex-col overflow-clip">
      <MainHeroStage />
      <ReadmeExplorer />
      <BlossomCarousel />
      <PricingTicket />
      <FaqAccordion />
      <ShowcaseCreditsArea />
    </main>
    ```
- **Svelte 5 Runes for Dynamic State:**
  - Dynamic UI state (active tab, active carousel slide, modal open/close, tier pricing calculations) MUST use Svelte 5 runes: `$state()`, `$derived()`, `$props()`, `$effect()`.
  - Zero dead code cheats (`{#if false}`), zero `{@html}` DOM snapshots, zero `react-dom` runtime leaks inside Svelte code.

### Invariant 3: The Target-Specific Overlay Mandate
- Overlays like `FloatingCapture` (email capture popup) must be extracted into root layout with:
  - Cookie suppression (`tca-captured=1`, `tca-prompt-<location>=1`).
  - Delay timer timeouts and exit-intent `mouseleave` triggers.
  - Keyboard `Escape` listener and accessible ARIA dialog attributes (`role="dialog"`, `aria-modal="true"`).

### Invariant 4: Dynamic Kinetic & Living Interaction Parity (Zero Dead Canvases)
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
1. **Gate 1: AST Human Code Quality Gate:**
   - Automated check passes only when 0 opaque filenames, 0 bundler tokens, 0 single-letter parameter soup, and 0 monolithic route dumps exist.
2. **Gate 2: Static Visual & Layout Parity Gate:**
   - 0px to <= 2px scroll height delta on desktop against `:3010`.
   - <= 1px landmark bounding box delta.
   - Stepped scroll-scrub parity.
3. **Gate 3: Dynamic Kinetic & Interactive Gate (`verify-kinetic-parity.mjs`):**
   - Every `<canvas>` element must have an active context (`webgl2`, `webgl`, or `2d`).
   - Living RAF loop test: pixel buffer sampling over consecutive animation frames must show non-zero rendered content and dynamic pixel changes.
   - Interactive input test: simulating pointer events on canvas triggers state transitions and shader response.
   - Smooth scroll test: wheel input produces interpolated scroll movement.
4. **Gate 4: SvelteKit 3.2 & TypeScript Health:**
   - `svelte-check --tsconfig ./tsconfig.json` must yield **0 errors and 0 warnings**.
   - `@sveltejs/mcp` `svelte-autofixer` must yield **0 issues and 0 suggestions**.

---

## 2. Directory Architecture & Port Mapping

```
./00-mirror/   -> Port 3010 | Ground-truth air-gapped capture & API fixtures
./01-native/   -> Port 3011 | Domain-named author-grade React/Next.js source
./02-svelte5/  -> Port 3012 | Modular SvelteKit 3.2 + Svelte 5 Runes app
```

---

## 3. The 3-Step Verification Checklist

Before marking any clone complete, verify:
- [ ] `./01-native/src/components/` contains **only domain-named components** (0 hash filenames).
- [ ] `./01-native/` passes `verify-human-code-quality.mjs` with 0 failures.
- [ ] `./02-svelte5/src/lib/components/` contains **only domain-named Svelte 5 components**.
- [ ] `./02-svelte5/src/routes/+page.svelte` composes components via `#lib/components/` (no monolithic HTML dump).
- [ ] `cd 02-svelte5 && pnpm check` outputs **0 errors, 0 warnings**.
- [ ] `@sveltejs/mcp` `audit-svelte5-mcp.mjs` outputs **0 issues, 0 suggestions**.
- [ ] Headless Chromium audits confirm **<= 2px scroll delta** across all 11 routes.
- [ ] `verify-kinetic-parity.mjs` confirms **all canvases have active WebGL/2D contexts**, RAF loops ticking, Lenis active, and interactive pointer state machines operational.
