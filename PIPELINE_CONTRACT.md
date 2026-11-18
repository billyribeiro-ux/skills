# Clone acceptance criteria

A URL starts a clone run. Use this version's router and tools together. Keep an editable native project and an editable Svelte 5 / SvelteKit 3.x project, and prove each against the captured browser experience. Record discoveries and limitations per route.

## Evidence of original authorship

| Available evidence | Supported conclusion | Deliverable |
| --- | --- | --- |
| Published source map with a path and embedded text | Exact embedded text and the path reported by this compilation | Recover the text without formatting, index the original path and map location, and hash the contents. |
| URL and response bytes | Exact delivered representation for this request | Retain raw bytes. Serve a separate localized replay when URL or origin changes are needed. |
| Factory identifiers, exports, manifests or traces | Module identity, dependencies, state or behavior with varying confidence | Record the evidence for each mapping and retain ambiguous cases. |
| An observed effect without its authored source | An implementable behavior contract | Write an editable reconstruction with a descriptive path and label it as reconstructed. |

An original repository location needs source-path evidence. A map can describe an intermediate compiler input. Capture the original map spelling as well as the safe local path. Preserve collisions, conflicting versions, missing contents and failed transformations in the recovery report.

## Runtime acceptance

1. The mirror inventories discovered routes, captures request variants and preserves evidence from scrolling, pointer input, media and drawing. Record failed fetches, unresolved routes and discovery bounds.
2. The native site builds or runs from its credited sources. For a rebuilt entry, edit an authored source in a fixture and observe the runtime change. Preserve dependencies, lazy boundaries, renderer setup and disposal, route ownership, original CSS order and asset addressing.
3. The Svelte project has a production build, hydrated components and traceable imports. Preserve script lifetimes and input behavior across navigation. Rebuilt graphics and motion controllers can remain ordinary editable modules. Convert component state and lifecycle to Svelte. Mark unsupported expressions and mounts for explicit implementation.
4. Compare the same route, viewport, scroll position, input and time window across versions. Include expected control changes, per-canvas drawing, easing and rendered pixel samples where available. Retain failing measurements. A passing screenshot documents the sampled frame.
5. Keep stage outputs and reports when a check fails. Rebuild an amended source in isolation. Issue a new certificate only after verification succeeds against the captured route inventory. Record wall time per stage before comparing revisions.

The Content Architecture developer handoff blueprint is a historical target-specific example. A new site's own evidence determines its component names, stack, routes and animation requirements.
