#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import postcss from 'postcss';

const __filename = fileURLToPath(import.meta.url);

const VIEWPORTS = [
  { width: 1440, height: 900, name: 'desktop', isMobile: false, hasTouch: false },
  { width: 768, height: 1024, name: 'tablet', isMobile: false, hasTouch: true },
  { width: 390, height: 844, name: 'mobile', isMobile: true, hasTouch: true }
];

/**
 * Parses all captured CSS files in mirrorDir to extract @keyframes, transitions,
 * animations, and custom property definitions with zero loss.
 */
function extractStaticCssAnimations(mirrorDir) {
  const keyframes = {};
  const transitionRules = [];
  const animationRules = [];

  function walkCss(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__sourcemaps__', 'forensics'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkCss(full);
      else if (entry.isFile() && entry.name.endsWith('.css')) {
        const relFile = '/' + path.relative(mirrorDir, full).replace(/\\/g, '/');
        const raw = fs.readFileSync(full, 'utf8');
        try {
          const root = postcss.parse(raw);
          root.walkAtRules(/keyframes$/i, (atRule) => {
            const name = atRule.params.trim();
            const stops = [];
            atRule.walkRules((stopRule) => {
              const props = {};
              stopRule.walkDecls((decl) => {
                props[decl.prop] = decl.value;
              });
              stops.push({ offset: stopRule.selector, properties: props });
            });
            keyframes[name] = { sourceFile: relFile, stops };
          });

          root.walkRules((rule) => {
            const trans = {};
            const anim = {};
            rule.walkDecls((decl) => {
              if (decl.prop.startsWith('transition')) trans[decl.prop] = decl.value;
              if (decl.prop.startsWith('animation')) anim[decl.prop] = decl.value;
            });
            if (Object.keys(trans).length > 0 && transitionRules.length < 500) {
              transitionRules.push({ selector: rule.selector, sourceFile: relFile, declarations: trans });
            }
            if (Object.keys(anim).length > 0 && animationRules.length < 500) {
              animationRules.push({ selector: rule.selector, sourceFile: relFile, declarations: anim });
            }
          });
        } catch {
          // Ignore malformed vendor CSS edge cases
        }
      }
    }
  }

  walkCss(mirrorDir);
  return { keyframes, transitionRules, animationRules };
}

/**
 * Runs deep Chrome DevTools Protocol (CDP) forensics across routes to extract:
 * 1. animations-blueprint.json (CDP Animation domain + WAAPI keyframes/easings + CSS @keyframes + GSAP/ScrollTrigger/Motion)
 * 2. kinetic-scroll-matrix.json (21-step scroll trajectory of transforms, opacities, sticky offsets, canvas & video state)
 * 3. interaction-contracts.json (CDP DOMDebugger.getEventListeners with exact script URL/line/col + hover/toggle state diffs)
 * 4. dom-component-blueprint.json (Multi-viewport semantic landmark & section tree with computed layout/typography & SVGs)
 * 5. webgl-shaders.json (Runtime-intercepted WebGL/WebGL2 GLSL vertex & fragment shaders + Canvas2D inventory)
 */
export async function extractCdpForensics({ targetOrigin, routes, outDir }) {
  const forensicsDir = path.join(outDir, 'forensics');
  fs.mkdirSync(forensicsDir, { recursive: true });

  console.log(`\n🔬 Launching Chrome CDP Runtime, Animation & Behavioral Forensics across ${routes.length} route(s)...`);

  const staticCssForensics = extractStaticCssAnimations(outDir);
  const browser = await chromium.launch({ headless: true });

  const animationsBlueprint = {
    capturedAt: new Date().toISOString(),
    staticCss: staticCssForensics,
    routes: {}
  };
  const kineticScrollMatrix = {
    capturedAt: new Date().toISOString(),
    checkpoints: Array.from({ length: 21 }, (_, idx) => Number((idx * 0.05).toFixed(2))),
    routes: {}
  };
  const interactionContracts = {
    capturedAt: new Date().toISOString(),
    routes: {}
  };
  const domComponentBlueprint = {
    capturedAt: new Date().toISOString(),
    routes: {}
  };
  const webglShaders = {
    capturedAt: new Date().toISOString(),
    shaders: [],
    canvasContexts: [],
    uniformProfiles: {}
  };
  const canvas2dBlueprint = {
    capturedAt: new Date().toISOString(),
    routes: {}
  };

  const seenShaderHashes = new Set();

  try {
    for (const route of routes) {
      const routeUrl = new URL(route, targetOrigin).href;
      console.log(`  🧠 CDP Forensics -> Route: ${route}`);

      animationsBlueprint.routes[route] = { cdpAnimations: [], waapiAnimations: [], runtimeEngines: {} };
      kineticScrollMatrix.routes[route] = { desktop: [] };
      interactionContracts.routes[route] = { listeners: [], mountReveals: [], interactiveStates: [] };
      domComponentBlueprint.routes[route] = { viewports: {}, inlineSvgs: [] };
      canvas2dBlueprint.routes[route] = [];

      // 1. Deep Desktop CDP Pass (Animations, Shaders, Uniforms, Canvas2D Ops, Event Listeners, Scroll Matrix)
      const desktopCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      });
      const page = await desktopCtx.newPage();

      // Pre-boot X-Ray Telemetry Hooks: GLSL shaders + Uniforms + Textures, Canvas2D ops, initial hidden states, rAF
      await page.addInitScript(() => {
        window.__AGY_SHADERS__ = [];
        window.__AGY_CANVASES__ = [];
        window.__AGY_UNIFORM_TRACE__ = {};
        window.__AGY_WEBGL_TEXTURES__ = [];
        window.__AGY_CANVAS2D_OPS__ = {};
        window.__AGY_RAF_COUNT__ = 0;
        window.__AGY_INITIAL_HIDDEN__ = [];

        const origRaf = window.requestAnimationFrame;
        window.requestAnimationFrame = function (cb) {
          window.__AGY_RAF_COUNT__++;
          return origRaf.call(this, cb);
        };

        const selectorForEl = (el) => {
          if (!el || el.nodeType !== 1) return null;
          if (el.id) return '#' + el.id;
          const tag = el.tagName.toLowerCase();
          const cls = typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
            : '';
          return cls ? `${tag}.${cls}` : tag;
        };

        const canvasKeyFor = (canvasEl) => {
          if (!canvasEl) return 'canvas-unknown';
          if (canvasEl.__agyKey) return canvasEl.__agyKey;
          const idx = window.__AGY_CANVASES__.length;
          canvasEl.__agyKey = selectorForEl(canvasEl) + '#' + idx;
          return canvasEl.__agyKey;
        };

        // Snapshot initial hidden/transparent nodes at DOMContentLoaded before hydration reveals run
        document.addEventListener(
          'DOMContentLoaded',
          () => {
            try {
              const hiddenNodes = [];
              const candidates = document.querySelectorAll('[style*="opacity"], [data-projection-id], main section, header, nav, h1, a, button');
              for (const el of candidates) {
                if (hiddenNodes.length >= 80) break;
                const cs = window.getComputedStyle(el);
                const inlineOp = el.style?.opacity;
                const op = parseFloat(cs.opacity);
                if (inlineOp === '0' || op < 0.2) {
                  el.dataset.agyInitialHidden = String(hiddenNodes.length);
                  hiddenNodes.push({
                    probeIdx: hiddenNodes.length,
                    selector: selectorForEl(el),
                    tag: el.tagName.toLowerCase(),
                    textSnippet: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50),
                    initialOpacity: Number(op.toFixed(2)),
                    initialTransform: cs.transform
                  });
                }
              }
              window.__AGY_INITIAL_HIDDEN__ = hiddenNodes;
            } catch {}
          },
          { once: true }
        );

        const locToMeta = new WeakMap();
        const hookWebGL = (Proto) => {
          if (!Proto || !Proto.shaderSource) return;

          const origShaderSource = Proto.shaderSource;
          Proto.shaderSource = function (shader, source) {
            try {
              const typeCode = this.getShaderParameter(shader, this.SHADER_TYPE);
              const type =
                typeCode === this.VERTEX_SHADER
                  ? 'vertex'
                  : typeCode === this.FRAGMENT_SHADER
                    ? 'fragment'
                    : 'unknown';
              window.__AGY_SHADERS__.push({
                type,
                source: String(source),
                canvasId: this.canvas?.id || null,
                canvasClass: this.canvas?.className || null
              });
            } catch {}
            return origShaderSource.call(this, shader, source);
          };

          const origGetUniformLocation = Proto.getUniformLocation;
          Proto.getUniformLocation = function (program, name) {
            const loc = origGetUniformLocation.call(this, program, name);
            if (loc) {
              locToMeta.set(loc, { name: String(name), canvasKey: canvasKeyFor(this.canvas) });
            }
            return loc;
          };

          const recordUniform = (loc, val) => {
            const meta = loc ? locToMeta.get(loc) : null;
            if (!meta) return;
            const bucket = (window.__AGY_UNIFORM_TRACE__[meta.canvasKey] ||= {});
            if (Array.isArray(val) || ArrayBuffer.isView(val)) {
              bucket[meta.name] = Array.from(val).slice(0, 16).map((n) => Number(Number(n).toFixed(5)));
            } else if (typeof val === 'number') {
              bucket[meta.name] = Number(val.toFixed(5));
            }
          };

          for (const method of ['uniform1f', 'uniform1i']) {
            if (Proto[method]) {
              const orig = Proto[method];
              Proto[method] = function (loc, x) {
                recordUniform(loc, x);
                return orig.call(this, loc, x);
              };
            }
          }
          if (Proto.uniform2f) {
            const orig = Proto.uniform2f;
            Proto.uniform2f = function (loc, x, y) {
              recordUniform(loc, [x, y]);
              return orig.call(this, loc, x, y);
            };
          }
          if (Proto.uniform3f) {
            const orig = Proto.uniform3f;
            Proto.uniform3f = function (loc, x, y, z) {
              recordUniform(loc, [x, y, z]);
              return orig.call(this, loc, x, y, z);
            };
          }
          if (Proto.uniform4f) {
            const orig = Proto.uniform4f;
            Proto.uniform4f = function (loc, x, y, z, w) {
              recordUniform(loc, [x, y, z, w]);
              return orig.call(this, loc, x, y, z, w);
            };
          }
          for (const vecMethod of ['uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1iv', 'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv']) {
            if (Proto[vecMethod]) {
              const orig = Proto[vecMethod];
              Proto[vecMethod] = function (loc, ...rest) {
                const arr = vecMethod.includes('Matrix') ? rest[1] : rest[0];
                recordUniform(loc, arr);
                return orig.call(this, loc, ...rest);
              };
            }
          }
          if (Proto.texImage2D) {
            const origTex = Proto.texImage2D;
            Proto.texImage2D = function (...texArgs) {
              try {
                if (window.__AGY_WEBGL_TEXTURES__.length < 40) {
                  const sourceObj = texArgs[texArgs.length - 1];
                  window.__AGY_WEBGL_TEXTURES__.push({
                    canvasKey: canvasKeyFor(this.canvas),
                    argCount: texArgs.length,
                    width: texArgs.length >= 9 ? texArgs[3] : sourceObj?.width || null,
                    height: texArgs.length >= 9 ? texArgs[4] : sourceObj?.height || null
                  });
                }
              } catch {}
              return origTex.apply(this, texArgs);
            };
          }
        };

        hookWebGL(window.WebGLRenderingContext?.prototype);
        hookWebGL(window.WebGL2RenderingContext?.prototype);

        // Hook Canvas 2D draw operations (first 120 ops per canvas) for Canvas2D blueprint extraction
        const ctx2d = window.CanvasRenderingContext2D?.prototype;
        if (ctx2d) {
          const push2dOp = (ctx, op, detail) => {
            try {
              const key = canvasKeyFor(ctx.canvas);
              const entry = (window.__AGY_CANVAS2D_OPS__[key] ||= {
                selector: selectorForEl(ctx.canvas),
                width: ctx.canvas?.width || 0,
                height: ctx.canvas?.height || 0,
                fonts: [],
                fillStyles: [],
                ops: []
              });
              if (ctx.font && !entry.fonts.includes(ctx.font) && entry.fonts.length < 16) entry.fonts.push(ctx.font);
              if (typeof ctx.fillStyle === 'string' && !entry.fillStyles.includes(ctx.fillStyle) && entry.fillStyles.length < 24) {
                entry.fillStyles.push(ctx.fillStyle);
              }
              if (entry.ops.length < 120) {
                entry.ops.push({ op, ...detail });
              }
            } catch {}
          };

          for (const method of ['scale', 'clearRect', 'fillRect', 'strokeRect']) {
            if (ctx2d[method]) {
              const orig = ctx2d[method];
              ctx2d[method] = function (...a) {
                push2dOp(this, method, { args: a.map((v) => Number(Number(v).toFixed(2))) });
                return orig.apply(this, a);
              };
            }
          }
          for (const txtMethod of ['fillText', 'strokeText']) {
            if (ctx2d[txtMethod]) {
              const orig = ctx2d[txtMethod];
              ctx2d[txtMethod] = function (text, x, y) {
                push2dOp(this, txtMethod, {
                  text: String(text).slice(0, 24),
                  x: Number(Number(x).toFixed(2)),
                  y: Number(Number(y).toFixed(2)),
                  font: this.font,
                  fillStyle: typeof this.fillStyle === 'string' ? this.fillStyle : 'gradient'
                });
                return orig.apply(this, arguments);
              };
            }
          }
        }

        const origGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (contextType, attrs) {
          const ctx = origGetContext.call(this, contextType, attrs);
          try {
            canvasKeyFor(this);
            window.__AGY_CANVASES__.push({
              contextType,
              id: this.id || null,
              className: typeof this.className === 'string' ? this.className : null,
              width: this.width,
              height: this.height
            });
          } catch {}
          return ctx;
        };
      });

      const cdp = await desktopCtx.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      await cdp.send('Animation.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Debugger.enable');

      const scriptUrlById = new Map();
      cdp.on('Debugger.scriptParsed', (evt) => {
        if (evt.scriptId && evt.url) {
          scriptUrlById.set(evt.scriptId, evt.url);
        }
      });

      const cdpRecordedAnimations = [];
      cdp.on('Animation.animationStarted', ({ animation }) => {
        if (!animation) return;
        cdpRecordedAnimations.push({
          id: animation.id,
          name: animation.name,
          type: animation.type,
          playState: animation.playState,
          startTime: animation.startTime,
          source: animation.source
            ? {
                delay: animation.source.delay,
                endDelay: animation.source.endDelay,
                iterationStart: animation.source.iterationStart,
                iterations: animation.source.iterations,
                duration: animation.source.duration,
                direction: animation.source.direction,
                fill: animation.source.fill,
                easing: animation.source.easing,
                keyframesRule: animation.source.keyframesRule || null
              }
            : null
        });
      });

      await page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(1800);

      // Capture WAAPI animations & runtime engines
      const runtimeAnimData = await page.evaluate(() => {
        const selectorFor = (el) => {
          if (!el || el.nodeType !== 1) return null;
          if (el.id) return `#${el.id}`;
          const classes = typeof el.className === 'string'
            ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
            : [];
          const tag = el.tagName.toLowerCase();
          return classes.length ? `${tag}.${classes.join('.')}` : tag;
        };

        const waapi = document.getAnimations({ subtree: true }).map((anim) => {
          const effect = anim.effect;
          const timing = effect?.getTiming ? effect.getTiming() : {};
          const keyframes = effect?.getKeyframes ? effect.getKeyframes() : [];
          const target = effect?.target || null;
          return {
            animationName: anim.animationName || anim.id || null,
            constructorName: anim.constructor?.name || 'Animation',
            playState: anim.playState,
            targetSelector: selectorFor(target),
            timing: {
              delay: timing.delay,
              endDelay: timing.endDelay,
              duration: timing.duration,
              iterations: timing.iterations,
              direction: timing.direction,
              easing: timing.easing,
              fill: timing.fill
            },
            keyframes
          };
        });

        const scrollTriggers = window.ScrollTrigger?.getAll
          ? window.ScrollTrigger.getAll().map((st) => ({
              trigger: selectorFor(st.trigger),
              start: st.vars?.start ?? st.start,
              end: st.vars?.end ?? st.end,
              scrub: st.vars?.scrub ?? false,
              pin: Boolean(st.vars?.pin),
              toggleActions: st.vars?.toggleActions || null
            }))
          : [];

        const engines = {
          hasGsap: Boolean(window.gsap),
          hasScrollTrigger: Boolean(window.ScrollTrigger),
          scrollTriggerCount: scrollTriggers.length,
          scrollTriggers,
          hasLenis: Boolean(
            window.__lenis ||
            window.lenis ||
            document.documentElement.classList.contains('lenis') ||
            document.documentElement.classList.contains('lenis-smooth')
          ),
          hasThreeJs: Boolean(window.THREE),
          hasFramerMotion: Boolean(document.querySelector('[data-projection-id]')),
          hasHlsVideo: Boolean(window.Hls || document.querySelector('video[src*=".m3u8"], [data-hls-src]')),
          hasWebflowIx2: Boolean(window.Webflow?.require),
          rafFrameCountDuringBoot: window.__AGY_RAF_COUNT__ || 0
        };

        const mountReveals = [];
        for (const item of window.__AGY_INITIAL_HIDDEN__ || []) {
          const el = document.querySelector(`[data-agy-initial-hidden="${item.probeIdx}"]`);
          if (!el) continue;
          const cs = window.getComputedStyle(el);
          const finalOpacity = Number(parseFloat(cs.opacity).toFixed(2));
          mountReveals.push({
            selector: item.selector,
            tag: item.tag,
            textSnippet: item.textSnippet,
            initialOpacity: item.initialOpacity,
            finalOpacity,
            revealedOnMount: finalOpacity - item.initialOpacity >= 0.4,
            initialTransform: item.initialTransform,
            finalTransform: cs.transform
          });
        }

        return {
          waapi,
          engines,
          mountReveals,
          shaders: window.__AGY_SHADERS__ || [],
          canvases: window.__AGY_CANVASES__ || [],
          bootUniforms: JSON.parse(JSON.stringify(window.__AGY_UNIFORM_TRACE__ || {})),
          webglTextures: window.__AGY_WEBGL_TEXTURES__ || [],
          canvas2dOps: Object.values(window.__AGY_CANVAS2D_OPS__ || {})
        };
      });

      animationsBlueprint.routes[route].cdpAnimations = cdpRecordedAnimations;
      animationsBlueprint.routes[route].waapiAnimations = runtimeAnimData.waapi;
      animationsBlueprint.routes[route].runtimeEngines = runtimeAnimData.engines;
      interactionContracts.routes[route].mountReveals = runtimeAnimData.mountReveals || [];
      canvas2dBlueprint.routes[route] = runtimeAnimData.canvas2dOps || [];
      webglShaders.uniformProfiles[route] = {
        boot: runtimeAnimData.bootUniforms || {},
        textures: runtimeAnimData.webglTextures || [],
        afterHover: null,
        afterHold: null,
        afterScrollMid: null
      };

      for (const sh of runtimeAnimData.shaders) {
        const hash = `${sh.type}:${sh.source.length}:${sh.source.slice(0, 120)}`;
        if (!seenShaderHashes.has(hash)) {
          seenShaderHashes.add(hash);
          webglShaders.shaders.push({ route, ...sh });
        }
      }
      for (const cv of runtimeAnimData.canvases) {
        webglShaders.canvasContexts.push({ route, ...cv });
      }

      // 2. CDP DOMDebugger.getEventListeners Inspection across Interactive Elements
      const listenerEntries = [];
      try {
        const evalRes = await cdp.send('Runtime.evaluate', {
          expression: `Array.from(document.querySelectorAll('a, button, summary, input, select, textarea, form, dialog, video, [role="button"], [role="tab"], [aria-expanded], [data-flyout], [data-state]')).slice(0, 120)`,
          returnByValue: false
        });

        if (evalRes?.result?.objectId) {
          const props = await cdp.send('Runtime.getProperties', {
            objectId: evalRes.result.objectId,
            ownProperties: true
          });

          for (const prop of props.result || []) {
            if (!/^\d+$/.test(prop.name) || !prop.value?.objectId) continue;
            const objId = prop.value.objectId;
            try {
              const [{ listeners }, metaRes] = await Promise.all([
                cdp.send('DOMDebugger.getEventListeners', { objectId: objId, depth: 1 }),
                cdp.send('Runtime.callFunctionOn', {
                  objectId: objId,
                  returnByValue: true,
                  functionDeclaration: `function() {
                    const r = this.getBoundingClientRect();
                    const cls = typeof this.className === 'string' ? this.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : '';
                    return {
                      tag: this.tagName.toLowerCase(),
                      id: this.id || null,
                      selector: this.id ? '#' + this.id : (cls ? this.tagName.toLowerCase() + '.' + cls : this.tagName.toLowerCase()),
                      text: (this.innerText || this.getAttribute('aria-label') || '').trim().slice(0, 60),
                      href: this.getAttribute('href') || null,
                      ariaExpanded: this.getAttribute('aria-expanded'),
                      ariaControls: this.getAttribute('aria-controls'),
                      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
                    };
                  }`
                })
              ]);

              if (listeners && listeners.length > 0 && metaRes?.result?.value) {
                listenerEntries.push({
                  element: metaRes.result.value,
                  events: listeners.map((l) => ({
                    type: l.type,
                    useCapture: l.useCapture,
                    passive: l.passive,
                    once: l.once,
                    scriptId: l.scriptId,
                    scriptUrl: scriptUrlById.get(l.scriptId) || null,
                    lineNumber: l.lineNumber,
                    columnNumber: l.columnNumber
                  }))
                });
              }
            } catch {}
          }
        }
      } catch {}

      interactionContracts.routes[route].listeners = listenerEntries;

      // 3. 21-Step Kinetic Scroll-Scrub Matrix (0% -> 100% in 5% increments)
      const docScrollInfo = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight
      }));
      const maxScrollY = Math.max(0, docScrollInfo.scrollHeight - docScrollInfo.innerHeight);

      const scrollSamples = [];
      for (let step = 0; step <= 20; step++) {
        const progress = Number((step * 0.05).toFixed(2));
        const targetY = Math.round(maxScrollY * progress);
        await page.evaluate((y) => window.scrollTo(0, y), targetY);
        await page.waitForTimeout(70);

        const sample = await page.evaluate((prog) => {
          const tracked = [];
          const candidates = document.querySelectorAll(
            'header, nav, main > *, section, [style*="transform"], [style*="opacity"], [data-projection-id], canvas, video'
          );
          let idx = 0;
          for (const el of candidates) {
            if (idx >= 60) break;
            const cs = window.getComputedStyle(el);
            const isAnimatedOrPinned =
              cs.transform !== 'none' ||
              parseFloat(cs.opacity) < 0.999 ||
              cs.position === 'sticky' ||
              cs.position === 'fixed' ||
              cs.clipPath !== 'none' ||
              el.tagName === 'CANVAS' ||
              el.tagName === 'VIDEO';
            if (!isAnimatedOrPinned && el.tagName !== 'HEADER' && el.tagName !== 'SECTION') continue;

            const r = el.getBoundingClientRect();
            const cls =
              typeof el.className === 'string'
                ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
                : '';
            const selector = el.id
              ? `#${el.id}`
              : cls
                ? `${el.tagName.toLowerCase()}.${cls}`
                : `${el.tagName.toLowerCase()}:nth-of-type(${idx + 1})`;

            tracked.push({
              selector,
              tag: el.tagName.toLowerCase(),
              position: cs.position,
              top: Math.round(r.top),
              height: Math.round(r.height),
              transform: cs.transform,
              opacity: Number(parseFloat(cs.opacity).toFixed(4)),
              clipPath: cs.clipPath !== 'none' ? cs.clipPath : undefined,
              videoTime: el.tagName === 'VIDEO' ? Number((el.currentTime || 0).toFixed(3)) : undefined
            });
            idx++;
          }
          return {
            progress: prog,
            scrollY: Math.round(window.scrollY),
            elements: tracked
          };
        }, progress);

        scrollSamples.push(sample);
        if (Math.abs(progress - 0.5) < 0.01 && webglShaders.uniformProfiles[route]) {
          webglShaders.uniformProfiles[route].afterScrollMid = await page.evaluate(() =>
            JSON.parse(JSON.stringify(window.__AGY_UNIFORM_TRACE__ || {}))
          );
        }
      }
      kineticScrollMatrix.routes[route].desktop = scrollSamples;

      // Reset scroll to top & probe hover / pointerdown uniforms + interactive controls
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);

      // Refresh Canvas2D blueprint & extract inline SVGs BEFORE running pointer/click probes
      canvas2dBlueprint.routes[route] = await page.evaluate(() =>
        Object.values(window.__AGY_CANVAS2D_OPS__ || {})
      );

      domComponentBlueprint.routes[route].inlineSvgs = await page.evaluate(() => {
        const seen = new Set();
        const svgs = [];
        document.querySelectorAll('svg').forEach((svg, idx) => {
          const html = svg.outerHTML;
          if (html.length > 25000 || seen.has(html)) return;
          seen.add(html);
          svgs.push({
            index: idx,
            viewBox: svg.getAttribute('viewBox') || null,
            width: svg.getAttribute('width') || null,
            height: svg.getAttribute('height') || null,
            ariaLabel: svg.getAttribute('aria-label') || null,
            outerHTML: html
          });
        });
        return svgs.slice(0, 80);
      });

      // 3b. Interactive WebGL Canvas Hover & Hold Uniform Capture (non-link canvases only)
      try {
        const heroCanvasBox = await page.evaluate(() => {
          const c = Array.from(document.querySelectorAll('canvas')).find((el) => {
            if (el.closest('a[href], button[type="submit"]')) return false;
            const r = el.getBoundingClientRect();
            return r.width >= 100 && r.height >= 100 && r.top >= 0 && r.top < window.innerHeight;
          });
          if (!c) return null;
          const r = c.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (heroCanvasBox && webglShaders.uniformProfiles[route]) {
          await page.mouse.move(heroCanvasBox.x, heroCanvasBox.y);
          await page.waitForTimeout(220);
          webglShaders.uniformProfiles[route].afterHover = await page.evaluate(() =>
            JSON.parse(JSON.stringify(window.__AGY_UNIFORM_TRACE__ || {}))
          );
          await page.mouse.down();
          await page.waitForTimeout(650);
          webglShaders.uniformProfiles[route].afterHold = await page.evaluate(() =>
            JSON.parse(JSON.stringify(window.__AGY_UNIFORM_TRACE__ || {}))
          );
          await page.mouse.up();
          await page.mouse.move(0, 0);
          await page.waitForTimeout(150);
        }
      } catch {}

      // 3c. Automated Interactive State Diff Probe (disclosures & tabs outside navigation links/forms)
      try {
        interactionContracts.routes[route].interactiveStates = await page.evaluate(async () => {
          const states = [];
          const selectorFor = (el) => {
            if (el.id) return '#' + el.id;
            const tag = el.tagName.toLowerCase();
            const cls = typeof el.className === 'string'
              ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
              : '';
            return cls ? `${tag}.${cls}` : tag;
          };

          for (const btn of Array.from(document.querySelectorAll('button[aria-expanded], [role="tab"]')).slice(0, 8)) {
            if (btn.closest('a[href], form') || btn.getAttribute('type') === 'submit') continue;
            const beforeExpanded = btn.getAttribute('aria-expanded');
            const beforeSelected = btn.getAttribute('aria-selected');
            const beforeState = btn.getAttribute('data-state');
            const beforeClass = btn.className;
            btn.click();
            await new Promise((r) => setTimeout(r, 90));
            const afterExpanded = btn.getAttribute('aria-expanded');
            const afterSelected = btn.getAttribute('aria-selected');
            const afterState = btn.getAttribute('data-state');
            const changedAttr =
              afterExpanded !== beforeExpanded
                ? 'aria-expanded'
                : afterSelected !== beforeSelected
                  ? 'aria-selected'
                  : afterState !== beforeState
                    ? 'data-state'
                    : btn.className !== beforeClass
                      ? 'class'
                      : null;
            if (changedAttr) {
              states.push({
                selector: selectorFor(btn),
                label: (btn.textContent || btn.getAttribute('aria-label') || '').trim().slice(0, 50),
                action: 'click',
                changedAttr,
                beforeValue: beforeExpanded ?? beforeSelected ?? beforeState ?? beforeClass,
                afterValue: afterExpanded ?? afterSelected ?? afterState ?? btn.className
              });
            }
            if (changedAttr === 'aria-expanded') {
              btn.click();
              await new Promise((r) => setTimeout(r, 60));
            }
          }
          return states;
        });
      } catch {}

      await desktopCtx.close();

      // 4. Multi-Viewport Computed Layout & Typography Tree (Desktop, Tablet, Mobile)
      for (const vp of VIEWPORTS) {
        const vpCtx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.hasTouch
        });
        const vpPage = await vpCtx.newPage();
        await vpPage.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await vpPage.evaluate(() => document.fonts?.ready).catch(() => {});
        await vpPage.waitForTimeout(900);

        const layoutSnapshot = await vpPage.evaluate(() => {
          const extractNode = (el) => {
            const r = el.getBoundingClientRect();
            const cs = window.getComputedStyle(el);
            const cls =
              typeof el.className === 'string'
                ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 4).join('.')
                : '';
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              selector: el.id ? `#${el.id}` : cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase(),
              headingText: el.querySelector('h1, h2, h3')?.textContent?.trim()?.slice(0, 80) || null,
              rect: {
                x: Math.round(r.x),
                y: Math.round(r.y),
                width: Math.round(r.width),
                height: Math.round(r.height)
              },
              styles: {
                display: cs.display,
                position: cs.position,
                gridTemplateColumns: cs.display.includes('grid') ? cs.gridTemplateColumns : undefined,
                flexDirection: cs.display.includes('flex') ? cs.flexDirection : undefined,
                justifyContent: cs.justifyContent !== 'normal' ? cs.justifyContent : undefined,
                alignItems: cs.alignItems !== 'normal' ? cs.alignItems : undefined,
                gap: cs.gap !== 'normal' ? cs.gap : undefined,
                padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
                backgroundColor: cs.backgroundColor,
                color: cs.color,
                fontFamily: cs.fontFamily,
                fontSize: cs.fontSize,
                fontWeight: cs.fontWeight,
                lineHeight: cs.lineHeight,
                letterSpacing: cs.letterSpacing,
                borderRadius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
                backdropFilter: cs.backdropFilter !== 'none' ? cs.backdropFilter : undefined,
                zIndex: cs.zIndex !== 'auto' ? cs.zIndex : undefined
              }
            };
          };

          const landmarks = Array.from(
            document.querySelectorAll('header, nav, main, main > section, main > div, article, footer, h1, h2')
          )
            .slice(0, 80)
            .map(extractNode);

          return {
            scrollHeight: document.documentElement.scrollHeight,
            scrollWidth: document.documentElement.scrollWidth,
            bodyBackground: window.getComputedStyle(document.body).backgroundColor,
            bodyFontFamily: window.getComputedStyle(document.body).fontFamily,
            landmarks
          };
        });

        domComponentBlueprint.routes[route].viewports[vp.name] = layoutSnapshot;
        await vpCtx.close();
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(
    path.join(forensicsDir, 'animations-blueprint.json'),
    JSON.stringify(animationsBlueprint, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(forensicsDir, 'kinetic-scroll-matrix.json'),
    JSON.stringify(kineticScrollMatrix, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(forensicsDir, 'interaction-contracts.json'),
    JSON.stringify(interactionContracts, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(forensicsDir, 'dom-component-blueprint.json'),
    JSON.stringify(domComponentBlueprint, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(forensicsDir, 'webgl-shaders.json'),
    JSON.stringify(webglShaders, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(forensicsDir, 'canvas2d-blueprint.json'),
    JSON.stringify(canvas2dBlueprint, null, 2),
    'utf8'
  );

  console.log(`  ✅ Emitted CDP Forensics Suite into ${forensicsDir}:`);
  console.log(`     - animations-blueprint.json (${Object.keys(staticCssForensics.keyframes).length} @keyframes)`);
  console.log(`     - kinetic-scroll-matrix.json (21-point scroll curves)`);
  console.log(`     - interaction-contracts.json (CDP DOMDebugger listeners, mountReveals & state diffs)`);
  console.log(`     - dom-component-blueprint.json (3-viewport computed layout & SVGs)`);
  console.log(`     - webgl-shaders.json (${webglShaders.shaders.length} GLSL shaders, uniforms & ${webglShaders.canvasContexts.length} canvases)`);
  console.log(`     - canvas2d-blueprint.json (Canvas 2D draw-op blueprints across ${Object.keys(canvas2dBlueprint.routes).length} routes)`);
}

// Standalone CLI execution
if (process.argv[1] && (path.resolve(process.argv[1]) === __filename || (fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)))) {
  const args = process.argv.slice(2);
  const getArg = (flag, fallback) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };
  const targetUrl = getArg('--url', 'http://localhost:3010');
  const outDir = path.resolve(getArg('--out-dir', './00-mirror'));
  const routesManifest = path.join(outDir, 'forensics', 'routes-manifest.json');
  const routesArg = getArg('--routes', '');
  let routes = ['/'];
  if (routesArg) {
    routes = routesArg.split(',').map((r) => r.trim()).filter(Boolean);
  } else if (fs.existsSync(routesManifest)) {
    const parsed = JSON.parse(fs.readFileSync(routesManifest, 'utf8'));
    if (Array.isArray(parsed.routes) && parsed.routes.length > 0) {
      routes = parsed.routes.map((r) => (typeof r === 'string' ? r : r.route));
    }
  }
  extractCdpForensics({ targetOrigin: new URL(targetUrl).origin, routes, outDir }).catch((err) => {
    console.error('CDP forensics failed:', err);
    process.exit(1);
  });
}
