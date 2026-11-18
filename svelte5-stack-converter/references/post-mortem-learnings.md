# Stage 2 Svelte 5 Converter: Post-Mortem Architectural Learnings

1. **SvelteKit 3.1+ Config Placement:**
   - SvelteKit 3 no longer relies on `svelte.config.js`. Having a `svelte.config.js` causes legacy drift and tooling conflicts.
   - Configure SvelteKit directly via `sveltekit({ adapter: adapter(), compilerOptions: { runes: true } })` inside `vite.config.ts`.

2. **Subpath Imports `#lib/`:**
   - Define subpath imports in `package.json` `"imports": { "#lib": "./src/lib/index.ts", "#lib/*": "./src/lib/*" }` and map them in `tsconfig.json` `compilerOptions.paths`.
   - Prefer `#lib/components/...` over legacy `$lib/` in all newly authored Svelte components.

3. **Pragmatic Strict TypeScript:**
   - Keep `"strict": true` and `"verbatimModuleSyntax": true`.
   - Set `"exactOptionalPropertyTypes": false` and `"noUncheckedIndexedAccess": false`. Enabling them produces pedantic TypeScript errors during DOM property manipulations (`element.style`, `dataset`) without improving runtime safety.

4. **Runes vs Legacy Svelte 4 Reactivity:**
   - Runes mode (`runes: true`) strictly disallows legacy `$:` reactive declarations or `export let prop`.
   - Always use `$props()`, `$state()`, `$derived()`, and `$effect()`.
   - For Snippets, always import `import type { Snippet } from 'svelte';` and render via `{@render snippet?.()}`.

5. **Event Handling in Svelte 5:**
   - Legacy `on:click` is deprecated. React camelCase `onClick` is invalid in Svelte.
   - Use standard lowercase HTML attributes: `onclick`, `onkeydown`, `onchange`, `oninput`.

6. **Audio / Video Scrubbing & HTTP 206 Streaming:**
   - Scroll-scrubbed `<video>` elements require byte-range request support (`Range: bytes=start-end`).
   - If the server returns a monolithic 200 response, browser media decoders freeze when setting `video.currentTime`.
   - `hooks.server.ts` must implement HTTP `206 Partial Content` streaming with `Accept-Ranges: bytes` and `Content-Range`.

7. **WebGL, Three.js & GSAP Reactivity Boundaries:**
   - Never put Three.js scenes, cameras, renderers, or GSAP timelines inside `$state()`. Svelte 5 deep reactive proxies will corrupt internal WebGL matrices and requestAnimationFrame loops.
   - Use `$state.raw<T>()` or keep non-reactive instances inside scoped lifecycle attachments (`Attachment<HTMLElement>`) with deterministic teardown returns.


## [2026-11-10] Target: https://www.apple.com/
- **Hard-Evidence Rule:** In SvelteKit 3.1+, import Handle from '@sveltejs/kit/hooks' in hooks.server.ts, serve extensionless CSS index.css and __api_fixtures__ in hooks.server.ts, escape literal JSON braces in HTML attributes as &#123;/&#125;, and use a MutationObserver in parity verifiers to enforce deterministic [data-holiday-default] theme selection before module scripts execute.

## [2026-11-11] Target: https://cinetic-creatives.com/
- **Hard-Evidence Rule:** Clean any scaffolded static HTML route files from static/ so SvelteKit SSR serves all routes natively; merge per-route WordPress core-block-supports-inline-css container rules into wp-global.css; and dynamically import browser-only Three.js/GSAP controllers inside onMount while registering all GSAP plugins including Flip.

## [2026-11-11] Target: https://www.contentarchitecture.dev/
- **Hard-Evidence Rule:** Extract root-layout overlays (FloatingCapture) into interactive-data.json and author idiomatic Svelte 5 components with runes ($state, $props); mirror cookie-based suppression (tca-captured=1, tca-prompt-<location>=1), delay timer timeouts, and exit-intent mouseleave triggers alongside keyboard Escape listeners and accessible ARIA dialog attributes.

## [2026-11-12] Target: https://www.itsoffbrand.com/
- **Hard-Evidence Rule:** When targeting sites with aggressive runtime text splitting (GSAP SplitText, Webflow interactions), set csr = false in +layout.server.ts to prevent Svelte hydration from trashing the split DOM; isolate utility pages (/404, /search) from the global WebGL shell via derived state in +layout.svelte and hooks.server.ts transformPageChunk; and avoid specifying invalid ignoreDeprecations versions in tsconfig.json.

## [2026-11-12] Target: https://www.apple.com/
- **Hard-Evidence Rule:** 1) Never block HTMLMediaElement.prototype.play or replace TimeGroup/TweenGroup (t - this.now)/1e3 deltas with 1e5 in static runtime bundles so InlineMedia videos, IphoneDuo subhead sweeps, and EndlessEntertainmentGallery carousels animate natively without triggering 4s PLAY_TIMEOUT DOM removal. 2) Install capture-phase mousedown (preventDefault on [aria-hidden=true]), focusin, HTMLElement.prototype.focus, and Element.prototype.setAttribute('aria-hidden','true') blur guards in the runtime loader so clicking full-bleed overlay anchors (a.tile-link[aria-hidden=true][tabindex=-1]) navigates cleanly without triggering Blink's 'Blocked aria-hidden on an element because its descendant retained focus' warning. 3) Set Cache-Control: no-store on HTML responses in src/hooks.server.ts so data-sveltekit-reload route navigations never abort Vite HMR WebSockets into Chrome Back-Forward Cache.

## [2026-11-12] Target: https://windows.itsoffbrand.com/
- **Hard-Evidence Rule:** 1) Enforce explicit width, height, and CSS aspect-ratio on all lazy-loaded images (loading='lazy') in Svelte 5 components (ProductCard, MediaCarousel, HomeHero) to pass Chrome DevTools/Lighthouse CLS audit with zero LazyLoadImageIssue violations; omit loading='lazy' on orbital canvas loops or elements inside content-visibility: auto. 2) Remove aria-hidden='true' from hit-target overlay anchors in card components, setting tabIndex={-1} and an accessible aria-label instead. 3) Provide local favicon.ico to eliminate 404s and keep tsconfig.json free of invalid compiler options like ignoreDeprecations. 4) In `scaffold-sveltekit3.mjs`, never copy route HTML files (*.html) into static/ because Vite static file serving will shadow SvelteKit SSR routes, and always forward forensics/image-dimensions.json to the target.

## [2026-11-12] Target: https://www.itsoffbrand.com/
- **Hard-Evidence Rule:** Static asset filenames with spaces or encoded characters (%20, %26) must be decoded and served via hooks.server.ts with explicit MIME mapping (.webp, .png, .jpeg, .svg, .woff2) to prevent SvelteKit from returning fallback HTML; neutralizes 75% of visual diff.

## [2026-11-12] Target: https://crl-2026.webflow.io/
- **Hard-Evidence Rule:** Before parity sign-off, ensure every custom engine/controller module ported from Stage 1 (01-native/src -> 02-svelte5/src/lib/engine) has domain-authentic local identifiers, zero comma sequences, zero void wrappers, and zero Rollup Object.freeze/definePublicField artifacts; verify-human-code-quality.mjs checks src/lib/engine alongside Svelte 5 components.

## [2026-11-18] Target: vault-nuclear-audit-2026-11-18
- **Hard-Evidence Rule:** Preserve 100% of Framer Motion props via Svelte 5 {@attach animateMotion(...)} rather than stripping them, never use loop index as {#each} key, forbid static/*.js chunks and unconverted scaffold-placeholder routes, require official @sveltejs/mcp structured autofixer + svelte-check --fail-on-warnings, and verify 100% of routes unmasked on strictPort 3012 with measured scroll-scrub and interactive disclosure parity.

## [2026-11-18] Target: https://www.contentarchitecture.dev/ (Dynamic Kinetic & WebGL 2.0 Parity)
- **Hard-Evidence Rule:**
  1) Never treat a web application as a static document: static DOM scrollHeight delta checks will falsely pass even when `<canvas>` elements are completely unrendered and dead.
  2) Enforce Gate 5 (Dynamic Kinetic & Living Interaction Parity): every `<canvas>` must have an active WebGL2 or 2D rendering context and an active requestAnimationFrame loop verified across consecutive frame buffer updates.
  3) Mount Lenis smooth scroll coordinator at root layout level (`+layout.svelte`) via Svelte 5 `{@attach attachSmoothScroll}`, ensuring `window.__lenis` actively interpolates wheel and touch inputs.
  4) WebGL 2.0 shaders and interactive scenes (e.g. Hero 3D Spiral) must bind pointer interactions (`pointerdown`, `pointermove`, `pointerup`), trigger hold-charge state machines, and mutate shader uniforms live.
  5) Use Svelte 5 `{@attach ...}` on canvas and container nodes rather than mutating `$state` inside `$effect`, satisfying `@sveltejs/mcp` audits with 0 issues and 0 suggestions.
