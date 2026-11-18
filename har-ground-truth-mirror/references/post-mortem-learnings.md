# Stage 0 (Ground-Truth Mirror) Post-Mortem Architecture Learnings

## Target: Next.js App Router / Turbopack Application
- **Law 1 (Apex vs `www.` Hostname Normalization):** Strip `^www\.` when comparing origins so `307/308` redirects (`example.com` -> `www.example.com`) never dump main-site HTML and `/_next/static/` chunks into `/__external/`.
- **Law 2 (`domcontentloaded` + Settle Delay over `networkidle`):** Never use `waitUntil: 'networkidle'` on `page.goto()` for modern App Router sites; use `waitUntil: 'domcontentloaded'` + scroll traversal (`0% -> 100% -> 0%`) to trigger all lazy chunks without hanging.
- **Law 3 (Internal Route Auto-Discovery & `?_rsc=` Prefetch Capture):** Automatically crawl internal `<a href="/...">` routes (`/blog`, `/pricing`, `/product`, etc.) and capture `?_rsc=` Flight responses (`text/x-component`) alongside static HTML so viewport link prefetching never triggers `404` errors.
- **Law 4 (Phase 1 Untouched Baseline Boundary):** Keep the Stage 0 mirror intact at `./00-mirror/` on port `:3010` via `serve-mirror.mjs` as the immutable live control group for Stage 1.
- **Law 5 (Exact Per-Route CSS Cascade Preservation):** Never concatenate external stylesheets into a monolithic bundle. Preserve each stylesheet at its exact localized path and maintain `<link>` order in `<head>`.
- **Law 6 (Deep Attribute Probing for Video Scrubbing):** Generically scan `data-video-basepath` and probe all resolution variants (`large_2x`, `large`, etc.) across `.mp4` and `.webm` so interactive scrubbers never un-enhance to fallback modes.
- **Law 7 (First-Party API Fixture Mirroring):** Capture all 200 OK same-origin JSON payloads into `__api_fixtures__` rather than stubbing with `{}`.

## Target: WebGL & Scrollytelling Custom Runtime
- **Law 8 (Binary Magic-Byte Validation):** Validate binary headers (`wOF2`, `wOFF`, `\0asm`, `DRACO`, `OggS`, `PNG`, `JPEG`, `MP4`, `WebM`) before saving assets to prevent HTML 404 pages from corrupting local binary caches.
- **Law 9 (206 Partial Content Range Support):** Always serve media streams with `Accept-Ranges: bytes` and `206 Partial Content` headers to support video seek and scroll-scrub animations.

## [2026-11-10] Target: https://www.apple.com/
- **Hard-Evidence Rule:** Save Virgin SSR HTML before client JS mutations, store extensionless CSS endpoints (e.g. /wss/fonts) as <path>/index.css to prevent file-vs-directory collisions with child font binaries, fetch full 200 OK binary streams for 206 Partial Content MP4 responses, and rewrite external CDN media (mzstatic.com) to root-relative /__external/<host>/<path>.

## [2026-11-11] Target: https://cinetic-creatives.com/
- **Hard-Evidence Rule:** Include .mov alongside .mp4/.webm in media asset discovery and HTTP 206 byte-range streaming handlers; synchronize cookie consent state (cinetic_cookie_consent=accepted) across HTTPS live and HTTP local mirrors.

## [2026-11-11] Target: https://www.contentarchitecture.dev/
- **Hard-Evidence Rule:** Recursively crawl Turbopack dynamic code-split chunks from JS chunk registries to prevent ChunkLoadError; rewrite SSR HTML with case-insensitive attribute checks (srcSet vs srcset) while strictly preserving React 19 Flight streams (self.__next_f) without mutating chunk string offsets; install an unhandledrejection guard to suppress external browser extension message channel disconnects on form/input interactions.

## [2026-11-12] Target: https://www.itsoffbrand.com/
- **Hard-Evidence Rule:** Sanitize embedded head comments: convert raw CSS comments /* ... */ inside <head> into standard HTML comments <!-- ... --> to prevent browser HTML parsers from prematurely terminating <head> and leaking 21.33px line-height anonymous text nodes into <body>.

## [2026-11-12] Target: https://www.apple.com/
- **Hard-Evidence Rule:** Never inject HTMLMediaElement.prototype.play pause overrides (__appleDetMedia) or 1e5 frame-jump deltas (0===this._repeats?1e5:0) into mirrored scripts—blocking .play() stalls InlineMedia and triggers 4s PLAY_TIMEOUT DOM self-destruction (this.inlineMediaWrapper.remove()), while 1e5 deltas break TimeGroup/TweenGroup keyframe interpolation; keep media/timelines 100% native and let verification scripts pause media only at screenshot time. In bot-defense scripts (shop/shld/v3/verify.js), set EME robustness to SW_SECURE_CRYPTO and replace deprecated ScriptProcessorNode with OfflineAudioContext + AnalyserNode.

## [2026-11-12] Target: https://windows.itsoffbrand.com/
- **Hard-Evidence Rule:** 1) In Storybook/micro-frontend mirrors, initialize default i18n dictionaries (MZ) with video controls fallback keys (playVideo, pauseVideo, play, pause) so pre-mount component evaluation never triggers [@msft/components] console warnings. 2) Provide explicit width/height and CSS aspect-ratio from asset metadata on all images rendering with loading=lazy to eliminate Chrome CDP LazyLoadImageIssue violations (CLS); for images rendered inside orbital spinners, marquee tickers, or containers with `content-visibility: auto`, omit `loading="lazy"` (use `loading="eager"`) because off-screen layout skipping evaluates them as 0x0. 3) Strip commented external stylesheets (e.g. microsoft.com/onerfstatics) and enforce `<base href='/'>` to prevent 'Verify stylesheet URLs: failed to load from about:blank:1' warnings. 4) Extract intrinsic image dimensions directly from binary headers into `forensics/image-dimensions.json` and ensure a valid fallback `favicon.ico` is served so `/favicon.ico` never 404s.

## [2026-11-18] Target: vault-nuclear-audit-2026-11-18
- **Hard-Evidence Rule:** Always run extract-cdp-forensics.mjs during Stage 0 to emit routes-manifest.json, animations-blueprint.json, kinetic-scroll-matrix.json, interaction-contracts.json, dom-component-blueprint.json, and webgl-shaders.json, recursively mirror dynamic bundler chunks and HLS .m3u8/.ts trees, and run verify-stage0-mirror.mjs completely UNMASKED (never hide <canvas> or <video>).
