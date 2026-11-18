---
name: har-ground-truth-mirror
description: Stage 0 Air-Gapped Forensic Ground-Truth Mirror & Chrome CDP Runtime Harvester. Autonomously captures zero-mutation live sites into ./00-mirror/ (:3010) with recursive route/chunk/HLS stream mirroring and full Chrome CDP animation, scroll-scrub, shader, layout, and event-listener blueprints.
---

# Stage 0 — `har-ground-truth-mirror`

## Overview
`har-ground-truth-mirror` executes **Stage 0** of the Antigravity 3-Stage Cloning Pipeline. It captures an exact, zero-mutation offline ground-truth mirror in `./00-mirror/` (served on `http://localhost:3010`) **AND** drives headless Chromium via the Chrome DevTools Protocol (`CDP`) to extract complete runtime engineering forensics into `./00-mirror/forensics/`.

---

## Core Invariants & Golden Laws

### Law 1: Complete Recursive Route, Dynamic Chunk & HLS Stream Mirroring
- Auto-discovers internal routes (`routes-manifest.json`) unless `--single-route` is explicitly requested.
- Recursively crawls dynamic bundler chunk references (`/_next/static/chunks/`, `/_next/static/immutable/chunks/`, `/_astro/`, `/_nuxt/`, `/assets/`) inside downloaded JS bundles so lazy imports never trigger `ChunkLoadError`.
- Recursively mirrors every `.m3u8` master playlist and Mux `playbackId` (`stream.mux.com/<id>.m3u8`) through all child resolution/audio playlists and 100% of `.ts`/`.m4s`/`.vtt` segments, rewriting playlist URIs to local `/__external/<host>/...` paths (`0` missing segments).

### Law 2: Deep Chrome CDP Runtime, Animation & Behavioral Forensics (`./00-mirror/forensics/`)
`capture-mirror.mjs` automatically invokes `extract-cdp-forensics.mjs` (which can also be run standalone) to generate 9 ground-truth engineering artifacts:
1. `routes-manifest.json` — Every discovered route, title, mode, and exact stylesheet cascade order.
2. `stack-fingerprint.json` — Per-route Mode A / B / C classification.
3. `image-dimensions.json` — Intrinsic width/height parsed directly from PNG, JPEG, WEBP, AVIF (`ispe`), and SVG headers.
4. `animations-blueprint.json` — Chrome CDP `Animation` domain events + live `document.getAnimations({ subtree: true })` WAAPI keyframes, durations, delays, exact `cubic-bezier`/`linear` easing curves, CSS `@keyframes`/`transition` rules, and GSAP/`ScrollTrigger`/Lenis/Motion runtime inventory.
5. `kinetic-scroll-matrix.json` — 21-step (`0% -> 100%`) scroll sweep recording exact `scrollY -> { top, height, transform, opacity, clipPath, videoTime }` trajectories for every animated, sticky, canvas, and video element.
6. `interaction-contracts.json` — Chrome CDP `DOMDebugger.getEventListeners` map, boot-to-settled `mountReveals`, and automated interactive control (`aria-expanded`, `[role="tab"]`) before/after state diffs.
7. `dom-component-blueprint.json` — Multi-viewport (`1440x900`, `768x1024`, `390x844`) semantic landmark hierarchy with computed CSS grid/flex/typography/surface values and inline `<svg>` catalog.
8. `webgl-shaders.json` — Pre-boot WebGL/WebGL2 hook capturing 100% of live vertex/fragment GLSL shaders, `<canvas>` contexts, texture metadata, and live uniform values (`boot`, `afterHover`, `afterHold`, `afterScrollMid`).
9. `canvas2d-blueprint.json` — Pre-boot `CanvasRenderingContext2D` draw-call telemetry recording DPR scaling, fonts, fill styles, and initial geometry ops per 2D canvas.

### Law 5: Hard Stage 0 Certification Lock (`stage0-cert.json`)
- `verify-stage0-mirror.mjs` MUST pass across 100% of captured routes cleanly (partial route flags forbid certification) to mint a hash-pinned `00-mirror/forensics/stage0-cert.json`. Stage 1 decompilation and verification hard-fail unless this certificate is present and matches `./00-mirror` hashes.

### Law 3: Exact Per-Route CSS Cascade & Zero Virgin SSR Mutation
- Never concatenate external stylesheets into a monolithic bundle or strip `<link rel="stylesheet">` tags.
- Never inject `opacity: 1` or `HTMLMediaElement.prototype.play` overrides into mirrored scripts.

### Law 4: Binary Magic-Byte Validation & HTTP 206 Range Streaming
- Validates magic bytes across `.woff2`, `.woff`, `.ttf`, `.otf`, `.wasm`, `.mp4`, `.mov`, `.webm`, `.m4s`, `.ts`, `.m3u8`, `.glb`, `.drc`, `.ktx2`, `.png`, `.jpg`, `.webp`, `.avif`, `.gif`, `.svg`, and `.ico`.
- `serve-mirror.mjs` serves byte-range requests with `206 Partial Content` and `Accept-Ranges: bytes`.

---

## CLI Execution Workflow

```bash
# 1. Capture Mirror + Deep Chrome CDP Forensics
node .agent/skills/har-ground-truth-mirror/scripts/capture-mirror.mjs \
  --url "https://example.com" \
  --out-dir "./00-mirror"

# 2. Serve Air-Gapped Mirror on :3010
node .agent/skills/har-ground-truth-mirror/scripts/serve-mirror.mjs \
  --dir "./00-mirror" \
  --port 3010

# 3. Run Unmasked Hard-Evidence Parity Gate across 100% of Captured Routes
node .agent/skills/har-ground-truth-mirror/scripts/verify-stage0-mirror.mjs \
  --live "https://example.com" \
  --local "http://localhost:3010" \
  --mirror-dir "./00-mirror"
```

Read `references/post-mortem-learnings.md` before capture and sign-off.
