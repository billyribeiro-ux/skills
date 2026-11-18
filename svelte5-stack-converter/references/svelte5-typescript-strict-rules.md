# Canonical Svelte 5 & SvelteKit 3.1+ Strict TypeScript Standards

## 1. Strict Component Props, Snippets & State (<script lang="ts">)
- Always import `Snippet` type when handling children or slots:
  ```svelte
  <script lang="ts">
    import type { Snippet } from 'svelte';

    interface Props {
      title: string;
      active?: boolean;
      selectedId?: string | null;
      onSelect?: (id: string) => void;
      header?: Snippet<[{ total: number }]>;
      children?: Snippet;
      class?: string;
    }

    let {
      title,
      active = false,
      selectedId = $bindable<string | null>(null),
      onSelect,
      header,
      children,
      class: className = ''
    }: Props = $props();
  </script>
  ```
- Use `const uid = $props.id();` for accessible SSR-safe element IDs.
- For children rendering: `{@render children?.()}` or `{@render header?.({ total: 10 })}`.
- For derived values:
  - Simple expressions: `const count = $derived(items.length);`
  - Multi-step computation: `const filtered = $derived.by(() => { ... return result; });`

## 2. Event Handlers & DOM Bindings
- Svelte 5 uses standard lowercase HTML attributes for event handlers:
  - `onclick={handleClick}` (NEVER `on:click`)
  - `onkeydown={handleKeyDown}`
  - `onchange={handleChange}`
  - `oninput={handleInput}`
- Element references:
  ```ts
  let containerEl = $state<HTMLElement | null>(null);
  ```
  ```svelte
  <div bind:this={containerEl}></div>
  ```

## 3. Subpath Imports (`#lib/`)
Per SvelteKit 3.1+ standards, imports from the library use the `#lib/` subpath configured in `package.json`:
```ts
import { Header } from '#lib/components/Header.svelte';
import { HeroVideo } from '#lib/components/HeroVideo.svelte';
import { useScrollScrubber } from '#lib/controllers/useScrollScrubber.js';
import type { NavItem } from '#lib/types/index.js';
```

## 4. WebGL, Three.js, GSAP & Animations with `$state.raw<T>()` and Attachments
- Never put Three.js scenes, cameras, renderers, or GSAP timelines inside deep reactive `$state()` proxies.
- Use `$state.raw<T>()` or keep non-reactive instances inside scoped lifecycle functions or attachments:
  ```svelte
  <script lang="ts">
    import type { Attachment } from 'svelte/attachments';
    import gsap from 'gsap';
    import { ScrollTrigger } from 'gsap/ScrollTrigger';

    gsap.registerPlugin(ScrollTrigger);

    const initScrollAnim: Attachment<HTMLElement> = (element) => {
      const tween = gsap.to(element, {
        scrollTrigger: {
          trigger: element,
          start: 'top top',
          end: 'bottom bottom',
          scrub: true
        },
        opacity: 0
      });

      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    };
  </script>

  <div {@attach initScrollAnim}></div>
  ```
- For continuous RAF loops, always return a teardown function cancelling the animation frame.

## 5. CLS Image Sizing & WAI-ARIA Invariants
- **Explicit Dimensions & CLS Prevention:**
  - Always provide explicit `width` and `height` attributes (and/or CSS `aspect-ratio`) on every `<img>` element to prevent Cumulative Layout Shift (CLS).
  - Never set `loading="lazy"` on unmeasured images or elements rendered inside orbital spinners, rotating canvases, or containers with `content-visibility: auto` (Chromium evaluates off-screen skipped layouts as 0x0, triggering `LazyLoadImageIssue` audit failures). Use `loading="eager"` or omit `loading` instead.
- **WAI-ARIA Focus Safety:**
  - Never place `aria-hidden="true"` on an `<a>` tag, button, or any interactive element that retains focus (even with `tabindex="-1"` pointer focus).
  - Use descriptive `aria-label` or semantic child headers for accessible card linking.
- **Clean TypeScript Configuration:**
  - Always extend `$app/tsconfig` cleanly without passing deprecated or invalid flags (such as `ignoreDeprecations`).
