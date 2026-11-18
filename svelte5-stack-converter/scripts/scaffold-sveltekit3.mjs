#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeAndFormatCss } from '../../native-stack-decompiler/scripts/ast-humanizer.mjs';
import { assertStageCertified } from '../../shared/pipeline-gate.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const SOURCE_DIR = path.resolve(getArg('--source', './01-native'));
const MIRROR_DIR = path.resolve(getArg('--mirror-dir', path.join(path.dirname(SOURCE_DIR), '00-mirror')));
const TARGET_DIR = path.resolve(getArg('--target', './02-svelte5'));
const PORT = parseInt(getArg('--port', '3012'), 10);

console.log(`🚀 Scaffolding SvelteKit 3.2 + Svelte 5 Strict Runes & TypeScript Workspace`);
console.log(`  Mirror Ground-Truth: ${MIRROR_DIR}`);
console.log(`  Source Native Stack: ${SOURCE_DIR}`);
console.log(`  Target Directory:    ${TARGET_DIR}`);
console.log(`  Strict Dev Port:     ${PORT}`);

// Hard Gate: Refuses to scaffold Stage 2 unless Stage 0 AND Stage 1 are certified & unmutated
assertStageCertified({ requiredStage: 0, dir: MIRROR_DIR, callerName: 'scaffold-sveltekit3.mjs' });
assertStageCertified({ requiredStage: 1, dir: SOURCE_DIR, callerName: 'scaffold-sveltekit3.mjs' });

fs.mkdirSync(TARGET_DIR, { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'lib', 'components'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'lib', 'controllers'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'lib', 'motion'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'lib', 'shaders'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'lib', 'data'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'lib', 'types'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'routes'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'src', 'styles'), { recursive: true });
fs.mkdirSync(path.join(TARGET_DIR, 'static'), { recursive: true });

// Ensure NO legacy svelte.config.js exists
const legacyConfig = path.join(TARGET_DIR, 'svelte.config.js');
if (fs.existsSync(legacyConfig)) {
  fs.unlinkSync(legacyConfig);
}

fs.writeFileSync(path.join(TARGET_DIR, '.nvmrc'), '26.13.0\n', 'utf8');

const pkgJson = {
  name: 'app-svelte5',
  version: '1.0.0',
  private: true,
  type: 'module',
  engines: {
    node: '>=26.13.0'
  },
  imports: {
    '#lib': './src/lib/index.ts',
    '#lib/types': './src/lib/types/index.ts',
    '#lib/*': './src/lib/*'
  },
  scripts: {
    dev: `vite dev --port ${PORT}`,
    build: 'vite build',
    preview: `vite preview --port ${PORT}`,
    check: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --fail-on-warnings',
    'check:watch': 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch',
    'audit:svelte': 'node scripts/audit-svelte5-mcp.mjs --app .'
  },
  devDependencies: {
    '@sveltejs/adapter-auto': '8.0.1',
    '@sveltejs/kit': '3.2.1',
    '@sveltejs/mcp': '0.1.31',
    '@sveltejs/vite-plugin-svelte': '7.3.1',
    '@types/node': '26.6.6',
    svelte: '5.57.3',
    'svelte-check': '4.7.8',
    typescript: '6.0.3',
    vite: '8.3.8'
  }
};

// Forward clean runtime libraries from Stage 1 package.json (never react/react-dom!)
const stage1PkgPath = path.join(SOURCE_DIR, 'package.json');
if (fs.existsSync(stage1PkgPath)) {
  try {
    const s1Pkg = JSON.parse(fs.readFileSync(stage1PkgPath, 'utf8'));
    const allowedRuntimeDeps = {};
    for (const [dep, ver] of Object.entries(s1Pkg.dependencies || {})) {
      if (!['react', 'react-dom', 'next'].includes(dep)) {
        allowedRuntimeDeps[dep] = ver;
      }
    }
    if (Object.keys(allowedRuntimeDeps).length > 0) {
      pkgJson.dependencies = allowedRuntimeDeps;
    }
  } catch { }
}

fs.mkdirSync(path.join(TARGET_DIR, 'scripts'), { recursive: true });
fs.copyFileSync(new URL('./audit-svelte5-mcp.mjs', import.meta.url), path.join(TARGET_DIR,'scripts','audit-svelte5-mcp.mjs'));
fs.writeFileSync(path.join(TARGET_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf8');

// Canonical SvelteKit 3 vite.config.ts (strictPort: true prevents silent port drift!)
const viteConfig = `import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      compilerOptions: { runes: true }
    })
  ],
  server: { host: '127.0.0.1', port: ${PORT}, strictPort: true },
  preview: { host: '127.0.0.1', port: ${PORT}, strictPort: true }
});
`;
fs.writeFileSync(path.join(TARGET_DIR, 'vite.config.ts'), viteConfig, 'utf8');

const tsconfig = `{
  "extends": "$app/tsconfig",
  "compilerOptions": {
    "strict": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "noUncheckedIndexedAccess": false
  },
  "include": ["src"],
  "exclude": ["src/service-worker"]
}
`;
fs.writeFileSync(path.join(TARGET_DIR, 'tsconfig.json'), tsconfig, 'utf8');

const appHtml = `<!doctype html>
<html data-site-document>
  <head>
    <meta charset="utf-8" />
    %sveltekit.head%
  </head>
  <body data-site-body data-sveltekit-reload>
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'app.html'), appHtml, 'utf8');

// Native Svelte 5 Motion Attachment Engine (preserves Framer Motion / WAAPI choreography without React!)
const motionAttachmentTs = `import type { Attachment } from 'svelte/attachments';

export interface MotionState {
  opacity?: number;
  x?: number | string;
  y?: number | string;
  scale?: number;
  rotate?: number;
  [key: string]: string | number | undefined;
}

export interface MotionTransition {
  duration?: number;
  delay?: number;
  ease?: string | number[];
}

export interface MotionOptions {
  initial?: MotionState | false;
  animate?: MotionState;
  whileInView?: MotionState;
  whileHover?: MotionState;
  whileTap?: MotionState;
  transition?: MotionTransition;
  viewport?: { once?: boolean; amount?: number };
}

function stateToKeyframe(state?: MotionState): Keyframe | null {
  if (!state) return null;
  const frame: Keyframe = {};
  const transforms: string[] = [];
  if (state.x !== undefined) {
    transforms.push(\`translateX(\${typeof state.x === 'number' ? \`\${state.x}px\` : state.x})\`);
  }
  if (state.y !== undefined) {
    transforms.push(\`translateY(\${typeof state.y === 'number' ? \`\${state.y}px\` : state.y})\`);
  }
  if (state.scale !== undefined) {
    transforms.push(\`scale(\${state.scale})\`);
  }
  if (state.rotate !== undefined) {
    transforms.push(\`rotate(\${state.rotate}deg)\`);
  }
  if (transforms.length > 0) {
    frame.transform = transforms.join(' ');
  }
  if (state.opacity !== undefined) {
    frame.opacity = state.opacity;
  }
  return frame;
}

function resolveEasing(ease?: string | number[]): string {
  if (Array.isArray(ease) && ease.length === 4) {
    return \`cubic-bezier(\${ease.join(', ')})\`;
  }
  if (ease === 'easeIn') return 'cubic-bezier(0.4, 0, 1, 1)';
  if (ease === 'easeOut') return 'cubic-bezier(0, 0, 0.2, 1)';
  if (ease === 'easeInOut') return 'cubic-bezier(0.4, 0, 0.2, 1)';
  if (typeof ease === 'string' && ease.length > 0) return ease;
  return 'cubic-bezier(0.22, 1, 0.36, 1)';
}

export function animateMotion(options: MotionOptions): Attachment<HTMLElement> {
  return (element) => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const durationMs = reducedMotion ? 0 : Math.round((options.transition?.duration ?? 0.5) * 1000);
    const delayMs = reducedMotion ? 0 : Math.round((options.transition?.delay ?? 0) * 1000);
    const easing = resolveEasing(options.transition?.ease);

    const initialFrame = options.initial !== false ? stateToKeyframe(options.initial) : null;
    if (initialFrame && !reducedMotion) {
      if (initialFrame.opacity !== undefined) element.style.opacity = String(initialFrame.opacity);
      if (initialFrame.transform) element.style.transform = String(initialFrame.transform);
    }

    const runTarget = (target?: MotionState) => {
      const targetFrame = stateToKeyframe(target);
      if (!targetFrame) return;
      const keyframes = initialFrame && !reducedMotion ? [initialFrame, targetFrame] : [targetFrame];
      const anim = element.animate(keyframes, {
        duration: durationMs,
        delay: delayMs,
        easing,
        fill: 'forwards'
      });
      anim.finished
        .then(() => {
          if (targetFrame.opacity !== undefined) element.style.opacity = String(targetFrame.opacity);
          if (targetFrame.transform) element.style.transform = String(targetFrame.transform);
        })
        .catch(() => {});
    };

    if (options.animate) {
      runTarget(options.animate);
    }

    let observer: IntersectionObserver | null = null;
    if (options.whileInView) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              runTarget(options.whileInView);
              if (options.viewport?.once !== false) {
                observer?.unobserve(element);
              }
            }
          }
        },
        { threshold: options.viewport?.amount ?? 0.15 }
      );
      observer.observe(element);
    }

    const cleanups: Array<() => void> = [];
    if (options.whileHover) {
      const enter = () => runTarget(options.whileHover);
      const leave = () => runTarget(options.animate ?? { opacity: 1, x: 0, y: 0, scale: 1 });
      element.addEventListener('mouseenter', enter);
      element.addEventListener('mouseleave', leave);
      cleanups.push(() => {
        element.removeEventListener('mouseenter', enter);
        element.removeEventListener('mouseleave', leave);
      });
    }

    if (options.whileTap) {
      const press = () => runTarget(options.whileTap);
      const release = () => runTarget(options.animate ?? { opacity: 1, x: 0, y: 0, scale: 1 });
      element.addEventListener('pointerdown', press);
      window.addEventListener('pointerup', release);
      window.addEventListener('pointercancel', release);
      cleanups.push(() => {
        element.removeEventListener('pointerdown', press);
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      });
    }
    return () => {
      observer?.disconnect();
      for (const off of cleanups) off();
    };
  };
}
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'lib', 'motion', 'motionAttachment.ts'), motionAttachmentTs, 'utf8');

// Canonical src/hooks.server.ts (API Fixtures + HLS .m3u8/.ts + HTTP 206 Byte-Range Streaming + Decoded Static Paths)
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'lib', 'data', 'document-shells.json'), '{}');
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'lib', 'data', 'resource-index.json'), '{}');
const hooksServer = `import resources from '#lib/data/resource-index.json';
import shells from '#lib/data/document-shells.json';
import type { Handle } from '@sveltejs/kit/hooks';
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME_MAP: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl; charset=utf-8',
  '.ts': 'video/mp2t',
  '.m4s': 'video/iso.segment',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm'
};

const STREAMABLE_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.ts', '.m4s', '.mp3', '.wav', '.ogg', '.wasm', '.glb']);

export const handle: Handle = async ({ event, resolve }) => {
  const pathname = decodeURIComponent(event.url.pathname);
  if (pathname.split('/').some(segment => segment === '..') || pathname.includes('\\\\')) return new Response(null, { status: 400 });
  const requestUrl = new URL(event.request.url);
  const isRsc = requestUrl.searchParams.has('_rsc') || event.request.headers.get('rsc') === '1';
  const key = (isRsc ? 'rsc:' : '') + requestUrl.pathname + requestUrl.search;
  const representation = ['GET', 'HEAD'].includes(event.request.method)
    ? (resources as Record<string, {file: string; contentType: string}>)[key] : undefined;
  const cleanPath = representation?.file ?? pathname.replace(/^\\/+/, '');

  // 2. Serve extensionless CSS endpoints (e.g. /wss/fonts -> static/wss/fonts/index.css)
  const indexCssCandidate = join(process.cwd(), 'static', cleanPath, 'index.css');
  if (cleanPath && existsSync(indexCssCandidate) && statSync(indexCssCandidate).isFile()) {
    return new Response(readFileSync(indexCssCandidate), {
      status: 200,
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 3. HTTP 206 Partial Content Range Streaming & Decoded Special-Character Static Delivery
  const staticFile = join(process.cwd(), 'static', cleanPath);
  if (cleanPath && existsSync(staticFile) && statSync(staticFile).isFile() && !cleanPath.endsWith('.html')) {
    const ext = extname(staticFile).toLowerCase();
    const range = event.request.headers.get('range');

    if (range && STREAMABLE_EXTS.has(ext)) {
      const stat = statSync(staticFile);
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (Number.isNaN(start) || start >= stat.size || end >= stat.size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': \`bytes */\${stat.size}\` }
        });
      }

      const chunkSize = end - start + 1;
      const buffer = new Uint8Array(chunkSize);
      const fd = openSync(staticFile, 'r');
      try {
        readSync(fd, buffer, 0, chunkSize, start);
      } finally {
        closeSync(fd);
      }
      return new Response(buffer, {
        status: 206,
        headers: {
          'Content-Range': \`bytes \${start}-\${end}/\${stat.size}\`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': representation?.contentType || MIME_MAP[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    if (representation || event.url.pathname !== pathname || ext === '.m3u8' || ext === '.ts') {
      const body = event.request.method === 'HEAD' ? null : readFileSync(staticFile);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': representation?.contentType || MIME_MAP[ext] || 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }

  const shell = (shells as Record<string, { html: string; body: string }>)[event.url.pathname.replace(/\\/$/, '') || '/'];
  const response = await resolve(event, { transformPageChunk: ({ html }) =>
    html.replace('<html data-site-document>', () => '<html' + (shell?.html ?? ' lang="en"') + '>')
        .replace('<body data-site-body data-sveltekit-reload>', () => '<body data-sveltekit-reload' + (shell?.body ?? '') + '>') });
  response.headers.set('Permissions-Policy', 'unload=*');
  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set('Cache-Control', 'no-store');
  }
  return response;
};
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'hooks.server.ts'), hooksServer, 'utf8');

const layoutServerTs = `export const prerender = false;
export const ssr = true;
export const csr = true;
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'routes', '+layout.server.ts'), layoutServerTs, 'utf8');

const errorSvelte = `<script lang="ts">
  import { page } from '$app/state';
</script>

<main class="page-error">
  <h1>{page.status}</h1>
  <p>{page.error?.message ?? 'Page Not Found'}</p>
</main>

<style>
  .page-error {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
  }
</style>
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'routes', '+error.svelte'), errorSvelte, 'utf8');

const layoutSvelte = `<script lang="ts">
  import type { Snippet } from 'svelte';
  import '../styles/tokens.css';

  interface Props {
    children?: Snippet;
  }

  let { children }: Props = $props();
</script>

{@render children?.()}
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'routes', '+layout.svelte'), layoutSvelte, 'utf8');

const pageSvelte = `<script lang="ts">
  // Populate route via Svelte 5 micro-batch conversion
</script>

<main class="page-root">
  <div class="scaffold-placeholder">SvelteKit 3.2 + Svelte 5 Initialized</div>
</main>
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'routes', '+page.svelte'), pageSvelte, 'utf8');

const libIndexTs = `export * from './types/index.js';
export * from './motion/motionAttachment.js';
`;
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'lib', 'index.ts'), libIndexTs, 'utf8');
fs.writeFileSync(path.join(TARGET_DIR, 'src', 'lib', 'types', 'index.ts'), 'export {};\n', 'utf8');

const BANNED_STATIC_BUNDLE = /(?:^|\/)(?:_next\/static\/.*\.m?js|_astro\/.*\.m?js|_nuxt\/.*\.m?js|(?:webpack|turbopack|chunk-)[^/]*\.m?js|.*\.(?:min|built)\.m?js)$/i;

function copyVerifiedStaticAssets(src, dest, relFromRoot = '') {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (['node_modules', '.git', 'forensics', 'src', 'recovered-source', '.native-tools', '.native-build', '__sourcemaps__'].includes(path.basename(src))) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      const nextRel = relFromRoot ? `${relFromRoot}/${file}` : file;
      copyVerifiedStaticAssets(path.join(src, file), path.join(dest, file), nextRel);
    }
  } else {
    const ext = path.extname(src).toLowerCase();
    const normRel = relFromRoot.replace(/\\/g, '/');
    if (ext === '.html' || ext === '.svelte' || ext === '.rsc' || normRel === 'package.json') return;
    if (BANNED_STATIC_BUNDLE.test(normRel) || ext === '.js' || ext === '.mjs') return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(SOURCE_DIR)) {
  console.log(`📦 Copying verified media, fonts & API fixtures into static/ (excluding 100% of HTML & JS chunks)...`);
  copyVerifiedStaticAssets(SOURCE_DIR, path.join(TARGET_DIR, 'static'));

  // Forward forensics suite from 01-native or 00-mirror into 02-svelte5/forensics/
  const targetForensics = path.join(TARGET_DIR, 'forensics');
  fs.mkdirSync(targetForensics, { recursive: true });
  const candidateForensicsDirs = [
    path.join(path.dirname(SOURCE_DIR), '00-mirror', 'forensics'),
    path.join(SOURCE_DIR, 'forensics')
  ];
  for (const fDir of candidateForensicsDirs) {
    if (!fs.existsSync(fDir)) continue;
    for (const fName of fs.readdirSync(fDir)) {
      if (fName.endsWith('.json') && !/^stage\d+-cert\.json$/.test(fName)) {
        fs.copyFileSync(path.join(fDir, fName), path.join(targetForensics, fName));
      }
    }
  }

  // Auto-scaffold +page.svelte skeletons for all captured sub-routes in routes-manifest.json
  const routesManifest = path.join(targetForensics, 'routes-manifest.json');
  if (fs.existsSync(routesManifest)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(routesManifest, 'utf8'));
      for (const rEntry of parsed.routes || []) {
        const routePath = typeof rEntry === 'string' ? rEntry : rEntry.route;
        if (!routePath || routePath === '/') continue;
        const relDir = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
        if (!relDir) continue;
        const routeDir = path.join(TARGET_DIR, 'src', 'routes', relDir);
        fs.mkdirSync(routeDir, { recursive: true });
        const routePageFile = path.join(routeDir, '+page.svelte');
        if (!fs.existsSync(routePageFile)) {
          fs.writeFileSync(routePageFile, pageSvelte, 'utf8');
        }
      }
    } catch { }
  }

  // Forward decoded RSC route JSON data & GLSL shaders from 01-native/src/
  const srcDataDir = path.join(SOURCE_DIR, 'src', 'data');
  if (fs.existsSync(srcDataDir)) {
    fs.cpSync(srcDataDir, path.join(TARGET_DIR, 'src', 'lib', 'data'), { recursive: true });
  }
  const srcShadersDir = path.join(SOURCE_DIR, 'src', 'shaders');
  if (fs.existsSync(srcShadersDir)) {
    fs.cpSync(srcShadersDir, path.join(TARGET_DIR, 'src', 'lib', 'shaders'), { recursive: true });
  }

  // Copy & sanitize CSS into src/styles
  for (const cc of [path.join(SOURCE_DIR, 'css'), path.join(SOURCE_DIR, 'src', 'styles')]) {
    if (fs.existsSync(cc)) {
      fs.cpSync(cc, path.join(TARGET_DIR, 'src', 'styles'), { recursive: true });
    }
  }

  function sanitizeCssTree(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) sanitizeCssTree(full);
      else if (f.isFile() && f.name.endsWith('.css')) {
        fs.writeFileSync(full, sanitizeAndFormatCss(fs.readFileSync(full, 'utf8')), 'utf8');
      }
    }
  }
  sanitizeCssTree(path.join(TARGET_DIR, 'src', 'styles'));

  const tokensFile = path.join(TARGET_DIR, 'src', 'styles', 'tokens.css');
  if (!fs.existsSync(tokensFile)) {
    fs.writeFileSync(tokensFile, ':root {}\n', 'utf8');
  }

  const targetFavicon = path.join(TARGET_DIR, 'static', 'favicon.ico');
  if (!fs.existsSync(targetFavicon)) {
    const emptyIco = Buffer.from([
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x44, 0x00,
      0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x20, 0x00,
      0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]);
    fs.writeFileSync(targetFavicon, emptyIco);
  }
}

console.log(`✅ SvelteKit 3.2 + Svelte 5 Scaffold generated at: ${TARGET_DIR}`);
