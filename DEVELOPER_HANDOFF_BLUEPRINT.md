# Antigravity Developer Hand-Off Blueprint: Universal Architecture & Protocol

## 1. Executive Overview

The **Developer Hand-Off Standard** is the core operational principle of the Antigravity Autonomous Engineering Pipeline. It mandates that any cloned, decompiled, or converted application must be indistinguishable from a clean, modular repository authored by the original engineering team.

### The Anti-Patterns Banned Under This Standard
1. **Opaque Chunk Bundles:** Emitting files like `04ai5m7_557lv.jsx` or `chunk-*.js`.
2. **Bundler Runtime Leakage:** Emitting code polluted with `TURBOPACK`, `__webpack_require__`, or `self.__next_f`.
3. **Monolithic Route Dumps:** Inlining hundreds of kilobytes of static HTML directly into `src/routes/+page.svelte`.
4. **Minified / Dummy Variable Soup:** Keeping single-letter parameters (`e, t, n, r`) or generic AST pools (`elem`, `nextVal`, `target2`).

---

## 2. Root Cause Analysis & Turbopack Decompilation Architecture

### Why Previous Decompilations Failed
Modern Next.js (App Router + Turbopack) does not generate traditional single-entry bundles. Instead, it generates:
1. **RSC Flight Streams:** Embedded in `index.html` or `.rsc` files containing serializations like:
   `8:I[988051,["$5","$6","$7"],"CrashScreen"]`
2. **Hashed Code Chunks:** Small JavaScript chunks named by content hashes (e.g. `04ai5m7_557lv.js`).

When naive decompilation tools encounter these chunks, they write them directly to disk using the chunk file name (`04ai5m7_557lv.jsx`). This fails the human-code quality gate because chunk files do not correspond to individual components; they are arbitrary bundler slices containing multiple modules and runtime bootstrap logic.

### The Correct Decompilation Blueprint
1. **Step 1: Parse the Flight Stream Symbol Table:**
   - Scan all HTML/RSC payloads for chunk declarations: `5:"/_next/static/immutable/chunks/1ep8vr8v02eva.js"`.
   - Scan for module definitions: `8:I[988051,["$5","$6","$7"],"CrashScreen"]`.
   - Resolve `$5` -> chunk path, `988051` -> Module ID, `"CrashScreen"` -> authentic author component name.
2. **Step 2: Unpack Bundler Modules:**
   - Inspect the chunk code for `(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push([..., moduleId, factory])`.
   - Extract the AST of the module factory corresponding to that module ID.
   - Deobfuscate with Babel and `webcrack` in JSX mode.
   - Output directly to `src/components/<ComponentName>.jsx` (e.g. `src/components/CrashScreen.jsx`).
3. **Step 3: Strip Bundler Runtime Polyfills:**
   - Remove `__webpack_require__` / `TURBOPACK` wrappers.
   - Unroll sequence expressions and eliminate dead branches.
   - Restore standard React/ES module import/export declarations.

---

## 3. The 28 Authentic Domain Components for contentarchitecture.dev

| Module ID | Export Name | Domain Component | Role & Functionality |
| :--- | :--- | :--- | :--- |
| `207434` | `SiteNav` | `SiteNav.jsx` / `.svelte` | Header navigation, branding, mobile drawer trigger, active links |
| `27201` | `IconMark` | `IconMark.jsx` / `.svelte` | SVG vector logomark with theme awareness |
| `565980` | `MainHeroStage` | `MainHeroStage.jsx` / `.svelte` | Hero header, kinetic title, dynamic CTA buttons |
| `620114` | `MainHeroReel` | `MainHeroReel.jsx` / `.svelte` | Background interactive video loop & reel stage |
| `934691` | `IdeStage` | `IdeStage.jsx` / `.svelte` | Interactive IDE workbench section container |
| `274355` | `IDE` | `IDE.jsx` / `.svelte` | Code editor viewport, line numbers, syntax tokens |
| `428737` | `TypingQuote` / `ReadmeExplorer` | `ReadmeExplorer.jsx` / `.svelte` | Interactive README tabs, typing simulation, minimap sync |
| `942909` | `TestimonialsCarousel` | `BlossomCarousel.jsx` / `.svelte` | Blossom touch carousel with swipe snap & slide state |
| `990096` | `PricingTicket` | `PricingTicket.jsx` / `.svelte` | Interactive pricing matrix, edition toggle, purchase link |
| `999333` | `EstimatePrintout` | `EstimatePrintout.jsx` / `.svelte` | Dynamic cost calculator and breakdown printout |
| `949047` | `FaqAccordion` | `FaqAccordion.jsx` / `.svelte` | Expandable accordion with ARIA disclosures |
| `447849` | `ShowcaseCreditsArea` | `ShowcaseCreditsArea.jsx` / `.svelte` | Project credits, contributors, license disclosures |
| `752933` | `FloatingCapture` | `FloatingCapture.jsx` / `.svelte` | Exit-intent & delayed email prompt with cookie suppression |
| `367296` | `EmailCapture` | `EmailCapture.jsx` / `.svelte` | Email subscription form input with validation |
| `361944` | `Drawer` | `Drawer.jsx` / `.svelte` | Mobile navigation sheet / slide-over dialog |
| `968371` | `Minimap` | `Minimap.jsx` / `.svelte` | Sticky viewport reading radar and progress minimap |
| `871251` | `GlyphSeam` | `GlyphSeam.jsx` / `.svelte` | SVG decorative section divider seam |
| `886616` | `GlyphFieldBackdrop` | `GlyphFieldBackdrop.jsx` / `.svelte` | Grid background lattice texture |
| `404526` | `BenefitsSectionBackground` | `BenefitsSectionBackground.jsx` / `.svelte` | Decorative canvas gradient field |
| `407194` | `AnimatedText` | `AnimatedText.jsx` / `.svelte` | Split-text kinetic typography controller |
| `54154` | `AnimatedContent` | `AnimatedContent.jsx` / `.svelte` | Intersection-observer triggered fade-in container |
| `919848` | `SanityImage` | `SanityImage.jsx` / `.svelte` | Responsive Sanity CMS asset with explicit dimensions |
| `412431` | `SanityMuxVideo` | `SanityMuxVideo.jsx` / `.svelte` | Mux video player with HLS streaming & 206 range fallback |
| `917235` | `AsciiImage` | `AsciiImage.jsx` / `.svelte` | Dynamic ASCII art renderer |
| `124843` | `ReadingProgress` | `ReadingProgress.jsx` / `.svelte` | Top scroll progress bar for editorial blog posts |
| `258015` | `CheckoutFlow` | `CheckoutFlow.jsx` / `.svelte` | Stripe checkout embedding & payment flow wrapper |
| `257923` | `RoadmapVoteButton` | `RoadmapVoteButton.jsx` / `.svelte` | Upvote counter button for roadmap feature items |
| `434923` | `Credits` | `Credits.jsx` / `.svelte` | Footer colophon and copyright |
| `988051` | `CrashScreen` | `CrashScreen.jsx` / `.svelte` | Error boundary recovery fallback component |
| `491538` | `MotionProvider` | `MotionProvider.jsx` / `.svelte` | Reduced-motion & smooth-scroll context provider |
| `347073` | `Lenis` | `Lenis.jsx` / `.svelte` | Smooth scrolling runtime coordinator |

---

## 4. Stage 2 (Svelte 5 Runes) Component Architecture

Every Svelte 5 component must follow strict authoring principles:
1. **Explicit Runes:**
   - State: `let count = $state(0);`
   - Computed: `let isFull = $derived(count >= max);`
   - Props: `let { title, children }: Props = $props();`
   - Lifecycle / Effects: `$effect(() => { ... return () => cleanup(); });`
2. **Subpath Imports:**
   - Always import via `#lib/components/<Name>.svelte`.
3. **Clean Composition in Routes:**
   - `src/routes/+page.svelte` is a clean compositional template:
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
4. **Root Layout (`src/routes/+layout.svelte`):**
   - Composes global layout elements:
   ```svelte
   <script lang="ts">
     import SiteNav from '#lib/components/SiteNav.svelte';
     import SiteFooter from '#lib/components/SiteFooter.svelte';
     import FloatingCapture from '#lib/components/FloatingCapture.svelte';
     import Minimap from '#lib/components/Minimap.svelte';
     let { children } = $props();
   </script>

   <SiteNav />
   {@render children()}
   <SiteFooter />
   <FloatingCapture />
   <Minimap />
   ```

---

## 5. Automated Verification Checklist for 100% Success

```bash
# 1. Verify Stage 1 Native Code Quality
node .agent/skills/native-stack-decompiler/scripts/verify-human-code-quality.mjs --dir ./01-native

# 2. Verify Stage 1 Parity against Mirror
node .agent/skills/native-stack-decompiler/scripts/verify-stage1-native.mjs \
  --mirror http://localhost:3010 \
  --native http://localhost:3011 \
  --routes routes.txt

# 3. Verify Stage 2 Svelte 5 TypeScript & Runes
cd 02-svelte5 && pnpm check

# 4. Verify Stage 2 with Svelte MCP Autofixer
node .agent/skills/svelte5-stack-converter/scripts/audit-svelte5-mcp.mjs --app ./02-svelte5

# 5. Verify Stage 2 Static Parity against Native & Mirror
node .agent/skills/svelte5-stack-converter/scripts/verify-stage2-svelte5.mjs \
  --native-url http://localhost:3011 \
  --svelte-url http://localhost:3012 \
  --routes routes.txt

# 6. Verify Stage 2 Dynamic Kinetic & Living Interaction Parity
node scripts/verify-kinetic-parity.mjs \
  --url http://localhost:3012 \
  --mirror http://localhost:3010
```
