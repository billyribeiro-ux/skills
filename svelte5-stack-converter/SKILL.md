---
name: svelte5-stack-converter
description: Convert certified native browser surfaces into editable Svelte 5 components and SvelteKit 3.x routes. Verify the production build, captured route inventory, authored asset provenance, and browser behavior.
---

# Convert the native project to Svelte 5

Use the verified native project, its source-recovery report, and the Stage 0 evidence. The destination is a new project directory. Scaffolding writes starter files, including the root page. Use a fresh destination when existing files contain edits.

## Conversion

Resolve the script directory relative to this skill. Use the same workflow version for all stages. The following commands assume a shell variable named `scripts` containing the absolute path to this skill's `scripts` directory.

```sh
node "$scripts/scaffold-sveltekit3.mjs" --source ./01-native --target ./02-svelte5 --port 3012
node "$scripts/plan-svelte5-batches.mjs" --source ./01-native --out ./02-svelte5/conversion-batches.json
```

Convert the ordered batch plan with a single prerequisite check. To rerun one batch, replace `--all` with `--batch N`. A static project may need zero component batches.

```sh
node "$scripts/preconvert-jsx-markup.mjs" --source ./01-native --target ./02-svelte5 --all
```

Compile route documents into Svelte components. The assembler uses native document paths, generates route-specific section components, and retains original stylesheet links and verified standalone browser controllers. It preserves their browser URL and classic or module loading semantics. Self-contained recovered module graphs supported by Stage 1 are rebuilt from their embedded source files. The generated project includes those sources and its local build command. Generated public assets are checked against the verified native copy. The SvelteKit pages hydrate on every supported route. Full document navigation preserves per-document script lifetimes.

```sh
node "$scripts/assemble-svelte-routes.mjs" --source ./01-native --target ./02-svelte5
cd ./02-svelte5
pnpm install
pnpm check
pnpm build
```

For a recovered React entry, the mapped-root adapter recognizes a named `createRoot` import from `react-dom/client`, a literal `document.getElementById` selector, and `.render(<Component />)` with a local default component import. It resolves nested component and helper imports from the supplied graph and mounts the translated Svelte component at the recorded element. More complex roots need an explicit adapter. This stage depends on upstream evidence for the entry, component source files, and DOM anchor.

For an authored Stage 1 continuation, assembly requires the `reconstructed-runtime` report, complete native route measurements, and current Stage 0 and Stage 1 certificates. It validates each route's referenced evidence hash against the captured file, rebuilds the declared source inputs, checks that each rebuilt file matches the native output, and preserves the verified module mount. The generated `forensics/reconstruction-provenance.json` distinguishes these authored sources from exact recovered originals. Separately mapped lazy modules are emitted alongside their rebuilt entry and retain dynamic import timing.

The JSX transformer handles simple exported components, local imports, simple state hooks, and common motion properties. Inspect component and controller imports, effect cleanup, prop types, component identity, focus behavior, and custom canvas and shader lifecycles. Cross-check the captured motion and interaction evidence. Unsupported JSX structures, route forms, inline handlers, and inline executable scripts require explicit conversion. A native report marked `requires-runtime-reconstruction` needs a working native runtime before assembly. Route documents with framework-owned state or mixed rendering modes require explicit component wiring. Author a Svelte component for each such interaction and retest it against the captured event sequence.

## Verification

Start the generated production preview and the verified mirror and native servers. Use full-project checks and the original Stage 0 route manifest for final verification.

```sh
node "$scripts/audit-svelte5-mcp.mjs" --app ./02-svelte5
node "$scripts/verify-stage2-svelte5.mjs" --mirror-dir ./00-mirror --native-dir ./01-native --svelte-dir ./02-svelte5
node "$scripts/verify-kinetic-parity.mjs" --forensics-dir ./00-mirror/forensics --url http://localhost:3012 --mirror http://localhost:3010
```

The verifier checks a production build, strict Svelte diagnostics, the structured autofixer, multi-viewport image and layout differences, and observed browser behavior. It records a Stage 2 certificate after a successful full run. Verify any effect outside the recorded contract with an explicit route and input trace. Pixel comparisons at sampled frames cannot establish every possible interaction.

Run the isolated converter regression suite with `node --test <skill directory>/tests/conversion.test.mjs`. Install the pinned dependencies in `tests/toolchain` to run the production preview tests. Each test clones the toolchain into a private directory. The WebGL fixture verifies rendered pixels as time advances, the pointer is pressed and released, and the viewport scrolls. You can override the toolchain using `SVELTE_FIXTURE_NODE_MODULES` and the browser using `SVELTE_FIXTURE_CHROME`. See `references/svelte5-typescript-strict-rules.md` for examples and `references/post-mortem-learnings.md` for historical site-specific observations.
