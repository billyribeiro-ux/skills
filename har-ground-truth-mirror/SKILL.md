---
name: har-ground-truth-mirror
description: Stage 0 Air-Gapped Forensic Ground-Truth Mirror & Chrome CDP Runtime Harvester. Autonomously captures website responses into ./00-mirror/ (:3010) with recursive route/chunk/HLS stream mirroring and Chrome CDP observations of animation, scroll, shaders, layout, and event listeners.
---

# Stage 0 — `har-ground-truth-mirror`

## Starting from one URL

For a complete website clone, invoke `clone.mjs` in the parent of this skill directory with the URL. It manages stage order, servers, certificates and logs. Read the adjacent vault router when a stage reports pending reconstruction. For a mirror-only request, use the capture commands below.

## Overview
`har-ground-truth-mirror` executes **Stage 0** of the Antigravity 3-Stage Cloning Pipeline. It captures raw document responses and an offline replay in `./00-mirror/` (served on `http://localhost:3010`) **AND** drives headless Chromium via the Chrome DevTools Protocol (`CDP`) to record runtime observations into `./00-mirror/forensics/`.

---

## Core Invariants & Golden Laws

### Law 1: Complete Recursive Route, Dynamic Chunk & HLS Stream Mirroring
- Auto-discovers internal routes (`routes-manifest.json`) unless `--single-route` is explicitly requested.
- Recursively crawls dynamic bundler chunk references (`/_next/static/chunks/`, `/_next/static/immutable/chunks/`, `/_astro/`, `/_nuxt/`, `/assets/`) inside downloaded JS bundles and records discovered dependencies for offline replay.
- Recursively mirrors every `.m3u8` master playlist and Mux `playbackId` (`stream.mux.com/<id>.m3u8`) through all child resolution/audio playlists and 100% of `.ts`/`.m4s`/`.vtt` segments, rewriting playlist URIs to local `/__external/<host>/...` paths (`0` missing segments).

### Law 2: Deep Chrome CDP Runtime, Animation & Behavioral Forensics (`./00-mirror/forensics/`)
`capture-mirror.mjs` automatically invokes `extract-cdp-forensics.mjs` (which can also be run standalone) to generate the following engineering artifacts:
1. `routes-manifest.json` — Every discovered route, title, mode, and exact stylesheet cascade order.
2. `stack-fingerprint.json` — Per-route Mode A / B / C classification.
3. `image-dimensions.json` — Intrinsic width/height parsed directly from PNG, JPEG, WEBP, AVIF (`ispe`), and SVG headers.
4. `animations-blueprint.json` — Chrome CDP `Animation` domain events + live `document.getAnimations({ subtree: true })` WAAPI keyframes, durations, delays, exact `cubic-bezier`/`linear` easing curves, CSS `@keyframes`/`transition` rules, and GSAP/`ScrollTrigger`/Lenis/Motion runtime inventory.
5. `kinetic-scroll-matrix.json` — 21-step (`0% -> 100%`) scroll sweep recording exact `scrollY -> { top, height, transform, opacity, clipPath, videoTime }` trajectories for every animated, sticky, canvas, and video element.
6. `interaction-contracts.json` — Chrome CDP `DOMDebugger.getEventListeners` map across interactive controls with exact event types and handler script locations.
7. `dom-component-blueprint.json` — Multi-viewport (`1440x900`, `768x1024`, `390x844`) semantic landmark hierarchy with computed CSS grid/flex/typography/surface values and inline `<svg>` catalog.
8. `webgl-shaders.json` — Pre-boot `WebGLRenderingContext.prototype.shaderSource` hook capturing observed vertex and fragment GLSL shaders and `<canvas>` contexts verbatim.

9. `canvas2d-blueprint.json` — sampled Canvas 2D drawing operations by route.

### Capture evidence and replay

- Read `forensics/routes-manifest.json` for the original document SHA-256, raw document path and replay file for each route. The replay copy may localize external URLs and third-party integrations.
- Read `forensics/assets.json` for URL-to-file mappings, including query-bearing representations. Each asset entry includes the replay path, original-content path and SHA-256. Read `forensics/source-maps.json` for inline and external map provenance, retained map bytes and retrieval failures.
- The module crawl resolves literal imports, re-exports and assets declared with `new URL(path, import.meta.url)` against each deployed module URL. CSS replay retains fragment identifiers for SVG resources. Computed imports and bare import-map specifiers depend on observed browser requests.
- Route discovery follows links rendered by Chromium until the queue is empty. A configured route budget or a failed document fetch leaves the run incomplete. Sites can also expose states and routes the captured interactions never reveal.
- Runtime traces are observations of the exercised viewports and interactions. The scroll and listener samples have finite bounds.

### Per-route CSS cascade
- Never concatenate external stylesheets into a monolithic bundle or strip `<link rel="stylesheet">` tags.
- Never inject `opacity: 1` or `HTMLMediaElement.prototype.play` overrides into mirrored scripts.

### Law 4: Binary Magic-Byte Validation & HTTP 206 Range Streaming
- Validates magic bytes across `.woff2`, `.woff`, `.ttf`, `.otf`, `.wasm`, `.mp4`, `.mov`, `.webm`, `.m4s`, `.ts`, `.m3u8`, `.glb`, `.drc`, `.ktx2`, `.png`, `.jpg`, `.webp`, `.avif`, `.gif`, `.svg`, and `.ico`.
- `serve-mirror.mjs` serves byte-range requests with `206 Partial Content` and `Accept-Ranges: bytes`.

---

## CLI Execution Workflow

```bash
# Set scripts to the absolute scripts directory next to this SKILL.md.
# 1. Capture Mirror + Deep Chrome CDP Forensics
node "$scripts"/capture-mirror.mjs \
  --url "https://example.com" \
  --out-dir "./00-mirror"

# 2. Serve Air-Gapped Mirror on :3010
node "$scripts"/serve-mirror.mjs \
  --dir "./00-mirror" \
  --port 3010

# 3. Run Unmasked Hard-Evidence Parity Gate across 100% of Captured Routes
node "$scripts"/verify-stage0-mirror.mjs \
  --live "https://example.com" \
  --local "http://localhost:3010" \
  --mirror-dir "./00-mirror"
```

Read `references/post-mortem-learnings.md` before capture and sign-off.
