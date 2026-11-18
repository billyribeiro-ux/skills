# Antigravity Autonomous Cloning Harness — Non-Negotiable Rules

1. **Strict 3-Stage Ground-Truth Progression:**
   - **Stage 0 (`./00-mirror/` on `:3010`):** `pnpm run mirror:capture -- --url "<URL>"` -> `pnpm run mirror:serve` -> `pnpm run mirror:verify -- --live "<URL>"`
   - **Stage 1 (`./01-native/` on `:3011`):** `pnpm run native:decompile` -> End-to-end first-party component & animation reconstruction in `./01-native/src/` -> `pnpm run native:serve` -> `pnpm run native:verify`
   - **Stage 2 (`./02-svelte5/` on `:3012`):** `pnpm run svelte:scaffold` -> `pnpm install` -> `pnpm run svelte:plan` -> 3–4 file micro-batches (`svelte:preconvert`, `svelte:audit`, `pnpm check`) -> `pnpm run svelte:verify`
2. **Zero Chunk-Bypass Tolerance (`CHUNK_BYPASS_DETECTED`):**
   - Never copy or load mirrored JS bundles (`_next/static/chunks/*.js`, `turbopack-*.js`, `webpack-*.js`, `*.min.js`, `*.built.js`, `self.__next_f`) inside `./01-native/` or `./02-svelte5/`. Every single component, shader, canvas renderer, and animation timeline must be decoded end-to-end into clean, human-authored source files before Stage 1 can pass.
3. **Deep Chrome CDP Forensics First:**
   - Always inspect `./00-mirror/forensics/` (`routes-manifest.json`, `animations-blueprint.json`, `kinetic-scroll-matrix.json`, `interaction-contracts.json`, `dom-component-blueprint.json`, `webgl-shaders.json`, `image-dimensions.json`) and live Chrome DevTools MCP before authoring or converting components and animations.
4. **Zero Canvas/Video Masking & 100% Route Coverage:**
   - Never hide `<canvas>` (`opacity: 0`) or `<video>` (`visibility: hidden`) or block `HTMLMediaElement.prototype.play()` to fake pixelmatch scores. Every route in `routes-manifest.json` must pass unmasked visual, layout, kinetic scroll-scrub, and interactive parity across Desktop (`1440x900`), Tablet (`768x1024`), and Mobile (`390x844`).
5. **Zero Binary Corruption & Complete Offline Streams:**
   - Validate magic bytes on every font, image, video, WASM, and GLB binary, and recursively mirror 100% of `.m3u8` master/variant playlists and `.ts`/`.m4s` segments with HTTP `206 Partial Content` range support.
6. **Immutable Verification Scripts:**
   - Never edit, weaken, or bypass any script in `.agent/skills/*/scripts/`. Fix the application code until all gates exit `0`.
