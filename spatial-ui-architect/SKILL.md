---
name: spatial-ui-architect
description: >
  Universal Forensic UI/UX Audit and Spatial Interface Redesign Engine for public websites,
  complex webapps, authenticated SaaS dashboards, and admin panels. Works BOTH standalone
  (in-place within any existing framework: Svelte 5/SvelteKit, Next.js/React, Vue/Nuxt,
  Laravel/Blade, Electron/Tauri, or vanilla HTML/CSS) AND as Stage 3 of the Antigravity
  cloning pipeline. Mandatory trigger whenever auditing, redesigning, modernizing, or
  fixing spatial/UI/UX architecture across an entire site or application.
---

# Spatial UI Architect (Universal Forensic Audit & Redesign Engine)

## 0. Model & Reasoning Level Protocol (Hard-Evidence Mandate)
1. **Interactive Discovery & Telemetry Triage (Phase 1 & Phase 4):**
   - **Model:** `gemini-3.8-flash` | **`thinking_level`: `"high"`**
   - **Role:** Execute deterministic AST route scanning, drive Playwright interactive state permutations (modals, drawers, tabs, SaaS tables, auth flows), and run post-redesign parity gates.
2. **Forensic Synthesis & Master Architecture Plan (Phase 2 & Phase 3):**
   - **Model:** `gemini-4-argon` | **`thinking_level`: `"high"`** (Explicitly set; NEVER leave on default `"medium"` for architectural synthesis) | **`max_output_tokens`: `65536`**
   - **Cache Preservation Rule:** Do NOT toggle `thinking_level` mid-session inside Argon. Argon's 95% implicit prompt cache requires identical model + `thinking_level` parameters across turns. If delegating mechanical file edits to `"medium"` or `gemini-3.8-flash`, spawn an isolated sub-agent session using the exported `redesign-blueprint.json`.

---

## 1. Dual Operating Modes

### Mode A: Standalone In-Place Mode (Existing or Brand-New Apps/Sites)
- **Target:** Any live URL + local repository (Marketing Websites, SaaS Workspaces, Admin Dashboards, Internal CRUD Tools, Desktop/Mobile WebApps).
- **Rule:** Preserve 100% of the existing framework conventions, backend bindings, form actions, API contracts, and business logic while systematically overhauling spatial rhythm, layout architecture, surface hierarchy, states, and accessibility.

### Mode B: Pipeline Stage 3 Mode (Antigravity Cloning & Elevation Pipeline)
- **Target:** Output from Stage 1 (`raw-dom-cloner` manifests in `dist-vanilla/`) or Stage 2 (`svelte5-stack-converter` Svelte 5 + SvelteKit 3.1 codebase).
- **Rule:** Ingest `site-manifest.json`, `design-tokens.json`, `dom-computed-tree.json`, and `motion-manifest.json`, audit structural deficiencies in the source reference, and elevate the layout, token math, and interaction choreography.

---

## 2. Ironclad Law: Full-Surface Interactive Exhaustion BEFORE Planning
**YOU ARE FORBIDDEN FROM PROPOSING A REDESIGN PLAN AFTER INSPECTING ONLY A LANDING PAGE OR SINGLE ROUTE.**
Before generating `FORENSIC_AUDIT_REPORT.md` or `redesign-blueprint.json`, you MUST execute Phase 1 across the **entire application surface area**:
- Every public page, dynamic route, and blog/resource template.
- Every authenticated SaaS workspace, user dashboard, billing/settings view, and role-gated Admin Panel.
- Every interactive UI permutation: Modals, Slide-Over Drawers, Dropdowns, Popovers, Command Palettes (`Cmd+K`), Tabs, Accordions, Multi-Step Wizards, Data Table States (sorting, filtering, pagination, sticky columns, empty/loading/error states), and Mobile Navigation Drawers.

---

## 3. Deterministic 4-Phase Execution Workflow

### Phase 1: Full-Surface Codebase + Live Interactive Crawl (Deterministic Scripts)
1. **Scan Local Codebase Routes & Hidden States (if local repo exists):**
   `node ~/.antigravity/skill-vault/spatial-ui-architect/scripts/codebase-route-scanner.mjs --repo ./ --out ./audit-telemetry/codebase-surface-map.json`
2. **Execute Interactive Multi-Viewport Playwright Crawl:**
   Pass `--auth-state ./auth-storage.json` when auditing authenticated SaaS/Admin dashboards:
   `node ~/.antigravity/skill-vault/spatial-ui-architect/scripts/full-surface-crawler.mjs --url "<TARGET_URL>" --routes-file ./audit-telemetry/codebase-surface-map.json --out ./audit-telemetry`

### Phase 2: Holistic Forensic Audit & Master Blueprint (`gemini-4-argon` @ `high`)
Ingest `./audit-telemetry/full-surface-manifest.json`, `./audit-telemetry/codebase-surface-map.json`, and all captured viewport/state screenshots. Load `references/saas-spatial-standards.md` and produce two artifacts:
1. **`./audit-telemetry/FORENSIC_AUDIT_REPORT.md`**:
   - **Executive Spatial Diagnosis:** Macro grid failures, visual hierarchy confusion, navigation friction across public + SaaS/admin views.
   - **Token & Typography Forensics:** Arbitrary pixel/rem chaos, broken fluid scaling, line-length (`ch`) violations, contrast failures.
   - **SaaS & Admin Ergonomics:** Data table density, sticky header/column collisions, form validation UX, modal/drawer z-index stacking bugs, missing empty/loading/error states.
   - **Interactive & Functional Bugs:** Dead links, broken skip-links, clipped overflows, horizontal scroll leaks, inaccessible interactive targets (< 44x44px on touch, missing ARIA/focus rings).
2. **`./audit-telemetry/redesign-blueprint.json`**:
   - Deterministic token replacement map (`--space-*`, `--text-*`, `--surface-*`, `--border-specular`, `--radius-*`, `--z-*`).
   - Route-by-route and component-by-component structural transformation specs.

### Phase 3: Systematic Implementation
Execute the approved `redesign-blueprint.json` across the target stack:
- **CSS & Token Architecture:** Enforce 1:1 fluid responsive `clamp()` primitives, optical surface layering (base canvas -> elevated card -> floating glass/specular overlay), and strict z-index tokens.
- **SaaS/Admin Shell & Views:** Standardize app shell geometry (collapsible sidebar, sticky topbar/breadcrumbs, fluid workspace container, tabular-nums data grids, slide-over detail drawers).
- **Zero Regression Contract:** Never delete business logic, event handlers, API calls, or accessibility attributes.

### Phase 4: Deterministic Verification & Post-Mortem Sync
1. **Run the Redesign Parity & Spatial Gate:**
   `node ~/.antigravity/skill-vault/spatial-ui-architect/scripts/verify-redesign-parity.mjs --url "<LOCAL_DEV_OR_STAGING_URL>" --baseline ./audit-telemetry/full-surface-manifest.json --out ./audit-telemetry/verification-report.json`
   Must achieve **0 horizontal overflow leaks**, **0 z-index/clipping collisions**, **0 broken links/actions**, and **100% route/state coverage**.
2. **Post-Mortem Skill Evolution:**
   Append any newly discovered framework quirks, UI anti-patterns, or layout edge cases to `references/post-mortem-learnings.md`.
