
## [2026-11-10] Target: https://www.apple.com/
- **Hard-Evidence Rule:** Restrict CSS custom property token extraction (tokens.css) strictly to top-level :root rules so mobile @media custom property overrides are never hoisted into global :root, and place tokens.css at the start of <head>.

## [2026-11-11] Target: https://cinetic-creatives.com/
- **Hard-Evidence Rule:** When decompiling sourcemaps, verify whether the production bundle contains post-sourcemap patches (such as window.cineticSkipIntro or video poster guards) and split large CSS bundles (>1500 lines) into domain stylesheets (blocks-core.css, blocks-media.css) to satisfy Gate 1 AST quality limits.

## [2026-11-11] Target: https://www.contentarchitecture.dev/
- **Hard-Evidence Rule:** Decompile Turbopack client module registries to map dynamically loaded components and root layout overlays (e.g. module 752933 FloatingCapture, module 974273 dynamic chunk imports); extract root-level interactive props from RSC fixtures to ensure full feature parity during architectural decomposition.

## [2026-11-12] Target: https://www.itsoffbrand.com/
- **Hard-Evidence Rule:** Format base64 data URIs in CSS on a single line wrapped in double quotes url("data:...") without raw unquoted newlines to prevent css-rparentexpected/css-colonexpected syntax errors; pair vendor-prefixed properties (-webkit-appearance, -webkit-user-select, -webkit-transform) with their standard counterparts, remove obsolete speak:none, unstandardized tap-highlight-color, and vertical-align on block elements; and ensure all <label for=ID> match existing form input IDs with explicit autocomplete attributes.

## [2026-11-12] Target: https://www.apple.com/
- **Hard-Evidence Rule:** Preserve genuine (now - this.now) / 1e3 frame deltas in TimeGroup.onPlayTimeUpdate and TweenGroup.onTimeEmitterUpdate across all main.built.js bundles and never block HTMLMediaElement.prototype.play in globalheader.umd.js or telemetry stubs; replace deprecated AudioContext.createScriptProcessor with OfflineAudioContext and empty EME robustness with SW_SECURE_CRYPTO in verify.js to guarantee zero console warnings.

## [2026-11-12] Target: https://windows.itsoffbrand.com/
- **Hard-Evidence Rule:** 1) Never place aria-hidden='true' on clickable LinkOverlay anchor tags (<a class='absolute inset-0 z-1 drag-none'>); use tabIndex={-1} with explicit aria-label to prevent Chrome's 'Blocked aria-hidden on an element because its descendant retained focus' violation, and strip aria-hidden on <a> tags automatically during AST humanization. 2) In reconstructed monorepo component packages, generate clean human-authored TypeScript with explicit interfaces (ButtonProps, ButtonLinkProps, enum unions) and clean imports (clsx, react) rather than raw chunk dumps with single-letter variables and bundle-relative imports (./iframe-ZPRyzrME.js). 3) Map image asset dimensions to width/height and aspect-ratio on all custom Image components from forensics/image-dimensions.json. In JSX attribute spreads, place width, height, style, and loading after ...u so computed sizing is never overwritten by undefined keys; omit loading="lazy" on orbital or continuous canvas loops inside content-visibility: auto. 4) Ensure native server scripts provide fallback favicon.ico to eliminate 404s.

## [2026-11-12] Target: https://crl-2026.webflow.io/
- **Hard-Evidence Rule:** Never ship AST-cracked code using cycled dummy pools (elem, nextVal, prevVal, target2, factor/config/ratio), Rollup Symbol.toStringTag Module wrappers, definePublicField helpers, nested SequenceExpressions, void (...) wrappers, Yoda comparisons, or single-line Webflow HTML; recursively unroll AST expressions, rename locals to domain-authentic identifiers, format Stage 1 HTML with htmlWhitespaceSensitivity: 'strict', and enforce all of these in verify-human-code-quality.mjs Gate 1.

## [2026-11-18] Target: vault-nuclear-audit-2026-11-18
- **Hard-Evidence Rule:** CHUNK_BYPASS_FORBIDDEN: Never copy mirrored JS bundles (_next/static/chunks/*.js, turbopack*, webpack*, *.min.js, *.built.js) or self.__next_f scripts into 01-native. Unpack individual module factories via unpack-bundler-modules.mjs, separate vendor packages to package.json, reconstruct compiled .jsx()/.jsxs() calls into real <Tag> JSX, extract GLSL shaders to src/shaders/, and enforce HTTP 403 chunk blocking on :3011 plus unmasked visual and measured scroll-scrub parity across 100% of captured routes.
