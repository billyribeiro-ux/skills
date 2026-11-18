# Universal Spatial, SaaS Dashboard & WebApp Design Standards

## 1. Optical Surface & Elevation Hierarchy (Dark & Light Modes)
- **Layer 0 (App Canvas):** `#0A0A0C` (Dark) / `#F8FAFC` (Light)
- **Layer 1 (Primary Workspace / Panels / Cards):** `#111115` (Dark) / `#FFFFFF` (Light) with `1px solid rgba(255,255,255,0.07)` (Dark) or `rgba(15,23,42,0.08)` (Light).
- **Layer 2 (Sticky Headers / Collapsible Sidebars / Table Headers):** `backdrop-filter: blur(16px) saturate(180%)` with top/inner specular hairline border (`1px solid rgba(255,255,255,0.12)`).
- **Layer 3 (Modals / Slide-Over Drawers / Command Palettes):** `#16161C` (Dark) elevated surface + multi-layered ambient shadow + focus trap + `Escape` dismissal.

## 2. SaaS Dashboard, Data Table & Admin Panel Ergonomics
- **App Shell Geometry:** Fixed or collapsible sidebar (`240px-260px` expanded, `64px` rail collapsed) + fluid main workspace (`min-width: 0` to prevent flex/grid blowout).
- **High-Density Data Tables:**
  - Mandatory `font-variant-numeric: tabular-nums` on all numeric, financial, timestamp, and metric columns.
  - Right-align numeric/currency columns; left-align text/status columns.
  - Sticky header (`position: sticky; top: 0; z-index: var(--z-sticky)`) and isolated horizontal scroll wrapper (`overflow-x: auto`) so wide tables never blow out the viewport.
- **Complete State Matrix:** Every data-driven view MUST visually define:
  1. `loading` (shimmer skeleton matching exact row/card geometry)
  2. `empty` (actionable zero-state with primary CTA)
  3. `populated` (with pagination/virtualization rhythm)
  4. `error` (inline recovery banner with retry action)

## 3. Fluid Typography & Spacing Math
- Never use raw arbitrary pixel values for layout spacing or typography.
- Use 1:1 fluid `clamp()` tokens (`--space-xs` through `--space-3xl`, `--text-xs` through `--text-display`).
- Enforce reading measure `60ch-72ch` on prose/documentation blocks and `min-height: 44px` on mobile/tablet interactive targets.
