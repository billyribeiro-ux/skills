---
name: native-stack-decompiler
description: Recover embedded source files, reconstruct supported browser entries, and verify a native project against its captured mirror.
---

# Stage 1 native recovery

Run the dispatcher on a certified Stage 0 capture and choose a fresh destination. Paths below are relative to the skill root unless a project path is supplied.

```sh
node scripts/decompile-native.mjs --mirror-dir /project/00-mirror --out-dir /project/01-native --mode auto
```

The decoder writes the source text embedded in published maps beneath `recovered-source/` with its reported folder hierarchy. `forensics/source-recovery.json` records the original map path, source root, script URL, index, recovered path and SHA-256. Relative traversal and virtual roots are confined to the recovery directory. Conflicting contents are retained under `forensics/source-variants/`. Unavailable text and unsupported map sections are recorded individually. The recovered tree reflects the published map, which can represent an intermediate compiler stage.

For static sites, HTML, public JavaScript, imports and CSS preserve their captured URL layout and route ownership. The native server can serve a uniquely identified byte-identical embedded source at the original script URL. A complete, self-contained browser ES module graph with one identifiable TypeScript or JavaScript entry can be rebuilt from its embedded original files. Captured split modules with literal relative dynamic imports rebuild as separately loaded files. The recovery ledger lists compiler inputs, outputs, and dynamic import edges. Relative imports of embedded GLSL, vertex, and fragment shader text are supported. The emitted HTML loads the locally rebuilt module. A portable `pnpm run build` is supplied for that case and requires installation of the generated package's dev dependencies. `pnpm start` serves the emitted project on loopback.

Framework and custom engine reconstructions also write inferred modules, shaders and route sections. Their module dispositions appear in `forensics/module-outcomes.json`. The dispatcher exits with status 2 and retains partial output when the runtime still needs implementation. Incomplete split maps, externalized dependencies, ambiguous or multiple entries, private server source and unpublished modules can require additional evidence or adapters. Preserve the evidence ledger with the handoff.

Run the verifier with the mirror and native servers active. It compares measured route behavior after checking the ledger and prerequisite certificate. Use the same installed skill directory for both commands.

```sh
node scripts/verify-stage1-native.mjs --mirror http://localhost:3010 --native http://localhost:3011 --mirror-dir /project/00-mirror --native-dir /project/01-native
node --test tests/native-recovery.test.mjs
```

The browser regression uses the installed Playwright Chromium and SwiftShader on loopback. It reads rendered pixel channels after animation frames, pointer input and wheel scrolling.

Site-specific observations are in `references/post-mortem-learnings.md`.

For a partial result that needs new source, follow [Continue from a partial native project](references/reconstruct-runtime.md). This produces a separate candidate with per-route evidence and an explicitly reconstructed runtime, ready for the existing Stage 1 parity verifier.
