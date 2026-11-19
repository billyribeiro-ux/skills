import fs from 'node:fs';
import path from 'node:path';

/**
 * Installs read-only browser observers in Playwright contexts to track
 * canvas context creation and requestAnimationFrame liveness without mutating app timing.
 */
export async function installKineticObserver(page) {
  await page.addInitScript(() => {
    const tracker = {
      rafTicks: 0,
      contexts: new WeakMap(),
      drawCalls: new WeakMap(),
      canvasLog: []
    };
    window.__AGY_KINETIC__ = tracker;

    const origRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = function (cb) {
      tracker.rafTicks++;
      return origRaf.call(this, cb);
    };

    const hookGlDraws = (gl, canvasEl) => {
      if (!gl || gl.__agyDrawHooked) return;
      gl.__agyDrawHooked = true;
      for (const fnName of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        if (typeof gl[fnName] === 'function') {
          const origFn = gl[fnName];
          gl[fnName] = function (...fnArgs) {
            tracker.drawCalls.set(canvasEl, (tracker.drawCalls.get(canvasEl) || 0) + 1);
            return origFn.apply(this, fnArgs);
          };
        }
      }
    };

    const hook2dDraws = (ctx, canvasEl) => {
      if (!ctx || ctx.__agyDrawHooked) return;
      ctx.__agyDrawHooked = true;
      for (const fnName of ['fillRect', 'strokeRect', 'fillText', 'strokeText', 'fill', 'stroke', 'drawImage', 'putImageData']) {
        if (typeof ctx[fnName] === 'function') {
          const origFn = ctx[fnName];
          ctx[fnName] = function (...fnArgs) {
            tracker.drawCalls.set(canvasEl, (tracker.drawCalls.get(canvasEl) || 0) + 1);
            return origFn.apply(this, fnArgs);
          };
        }
      }
    };

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      const ctx = origGetContext.call(this, type, attrs);
      if (ctx) {
        tracker.contexts.set(this, type);
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          hookGlDraws(ctx, this);
        } else if (type === '2d') {
          hook2dDraws(ctx, this);
        }
        tracker.canvasLog.push({
          type,
          id: this.id || null,
          className: typeof this.className === 'string' ? this.className.slice(0, 80) : null
        });
      }
      return ctx;
    };
  });
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Generic, site-agnostic Gate 5 Kinetic & Living Interaction Parity audit.
 * Reads Stage 0 telemetry from forensics/ rather than hardcoding site selectors.
 */
export async function auditKineticAndLivingSurface({
  page,
  route = '/',
  forensicsDir,
  mirrorPage = null
}) {
  const failures = [];
  const warnings = [];
  const summary = {
    route,
    canvasCount: 0,
    activeCanvases: 0,
    rafDelta: 0,
    hasLenisExpected: false,
    hasLenisActual: false,
    testedControls: 0,
    mountRevealsChecked: 0
  };

  const animBlueprint = readJsonSafe(path.join(forensicsDir, 'animations-blueprint.json'));
  const interactionContracts = readJsonSafe(path.join(forensicsDir, 'interaction-contracts.json'));
  const webglShaders = readJsonSafe(path.join(forensicsDir, 'webgl-shaders.json'));

  const routeAnim = animBlueprint?.routes?.[route] || {};
  const routeContracts = interactionContracts?.routes?.[route] || {};
  const expectedCanvasCountOnRoute = mirrorPage
    ? await mirrorPage.evaluate(() =>
        Array.from(document.querySelectorAll('canvas')).filter((c) => {
          const r = c.getBoundingClientRect();
          return r.width >= 2 && r.height >= 2;
        }).length
      )
    : (webglShaders?.canvasContexts || []).filter((c) => c.route === route).length;

  // 1. Zero Dead Canvases Check + RAF Liveness
  const counters = () => {
    const t = window.__AGY_KINETIC__;
    if (!t) return null;
    return { raf: t.rafTicks, draws: Array.from(document.querySelectorAll('canvas'), c => t.drawCalls.get(c) || 0) };
  };
  const [rafBefore, baseBefore] = await Promise.all([page.evaluate(counters), mirrorPage?.evaluate(counters)]);
  if (!rafBefore) throw Error('Kinetic observer was not installed before navigation');
  await page.waitForTimeout(250);
  const baseAfter = await mirrorPage?.evaluate(counters);
  const canvasReport = await page.evaluate((rafStart) => {
    const tracker = window.__AGY_KINETIC__;
    const rafAfter = tracker?.rafTicks ?? 0;
    const canvases = Array.from(document.querySelectorAll('canvas'));
    const visibleCanvases = [];

    for (let i = 0; i < canvases.length; i++) {
      const c = canvases[i];
      const r = c.getBoundingClientRect();
      const cs = window.getComputedStyle(c);
      if (r.width < 2 || r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden') continue;

      const ctxType = tracker?.contexts?.get(c) || null;
      const drawCalls = tracker?.drawCalls?.get(c) || 0;
      const inViewport = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
      let has2dPixels = null;
      if (ctxType === '2d') {
        try {
          const ctx = c.getContext('2d');
          const stepX = Math.max(1, Math.floor(c.width / 16));
          const stepY = Math.max(1, Math.floor(c.height / 16));
          const data = ctx.getImageData(0, 0, Math.max(1, c.width), Math.max(1, c.height)).data;
          let nonZero = false;
          for (let y = 0; y < c.height && !nonZero; y += stepY) {
            for (let x = 0; x < c.width; x += stepX) {
              const idx = (y * c.width + x) * 4;
              if (data[idx + 3] > 0) {
                nonZero = true;
                break;
              }
            }
          }
          has2dPixels = nonZero;
        } catch {
          has2dPixels = null;
        }
      }

      visibleCanvases.push({
        index: i,
        id: c.id || null,
        className: typeof c.className === 'string' ? c.className.slice(0, 80) : null,
        width: c.width,
        height: c.height,
        rectWidth: Math.round(r.width),
        rectHeight: Math.round(r.height),
        inViewport,
        ctxType,
        drawCalls,
        drawsDuringSample: drawCalls - (rafStart.draws[i] ?? 0),
        has2dPixels
      });
    }

    return {
      totalDomCanvases: canvases.length,
      visibleCanvases,
      rafDelta: rafAfter - rafStart.raf
    };
  }, rafBefore);

  summary.canvasCount = canvasReport.visibleCanvases.length;
  summary.rafDelta = canvasReport.rafDelta;

  if (expectedCanvasCountOnRoute > 0 && canvasReport.visibleCanvases.length < expectedCanvasCountOnRoute) {
    failures.push(
      `Canvas count mismatch on "${route}": baseline has ${expectedCanvasCountOnRoute} visible <canvas>, candidate rendered ${canvasReport.visibleCanvases.length}.`
    );
  }

  for (const cv of canvasReport.visibleCanvases) {
    if (!cv.ctxType) {
      failures.push(
        `Dead <canvas> #${cv.index} (${cv.id || cv.className || 'anonymous'}, ${cv.rectWidth}x${cv.rectHeight}): getContext() was never initialized.`
      );
      continue;
    }
    if (cv.inViewport && cv.drawCalls === 0) {
      failures.push(
        `Dead in-viewport <canvas> #${cv.index} (${cv.id || cv.className || 'anonymous'}, ctx=${cv.ctxType}): 0 draw calls executed.`
      );
      continue;
    }
    if (cv.inViewport && cv.ctxType === '2d' && cv.has2dPixels === false) {
      failures.push(
        `Canvas2D #${cv.index} (${cv.id || cv.className || 'anonymous'}) initialized "2d" context but had zero non-transparent pixels at y=0 (may be scrolled off-screen).`
      );
    }
    if (cv.inViewport && baseAfter && baseBefore &&
        baseAfter.draws[cv.index] > baseBefore.draws[cv.index] && cv.drawsDuringSample === 0) {
      failures.push(`Canvas #${cv.index} stopped drawing while the corresponding mirror canvas advanced.`);
      continue;
    }
    summary.activeCanvases++;
  }

  const stage0HadRaf = (routeAnim?.runtimeEngines?.rafFrameCountDuringBoot ?? 0) > 2;
  if (stage0HadRaf && canvasReport.rafDelta === 0 && canvasReport.visibleCanvases.length > 0) {
    failures.push(
      `Animation loop stalled on "${route}": Stage 0 ran active requestAnimationFrame loops, candidate had 0 RAF ticks in 180ms.`
    );
  }

  // 2. Smooth Scroll Coordinator Audit (when Stage 0 detected Lenis)
  const expectedLenis = Boolean(routeAnim?.runtimeEngines?.hasLenis);
  summary.hasLenisExpected = expectedLenis;
  if (expectedLenis) {
    const hasLenis = await page.evaluate(() =>
      Boolean(
        window.__lenis ||
        window.lenis ||
        document.documentElement.classList.contains('lenis') ||
        document.documentElement.classList.contains('lenis-smooth')
      )
    );
    summary.hasLenisActual = hasLenis;
    if (!hasLenis) {
      failures.push(
        `Smooth scroll coordinator missing on "${route}": Stage 0 uses Lenis, candidate did not mount Lenis / .lenis-smooth.`
      );
    }
  }

  // 3. Mount Reveal Contract Verification (catches stuck opacity:0 hero/CTA elements!)
  const mountReveals = Array.isArray(routeContracts.mountReveals) ? routeContracts.mountReveals : [];
  if (mountReveals.length > 0) {
    const revealAudit = await page.evaluate((targets) => {
      const stuck = [];
      let checked = 0;
      const querySafe = (sel) => {
        try {
          return Array.from(document.querySelectorAll(sel));
        } catch {
          try {
            const escaped = sel
              .split(' ')
              .map((part) => {
                const segs = part.split('.');
                if (segs.length <= 1) return part;
                return segs[0] + '.' + segs.slice(1).map((c) => CSS.escape(c)).join('.');
              })
              .join(' ');
            return Array.from(document.querySelectorAll(escaped));
          } catch {
            return [];
          }
        }
      };
      for (const item of targets) {
        if (!item.selector && !item.textSnippet) continue;
        let el = null;
        if (item.selector) {
          const candidates = querySafe(item.selector);
          el = item.textSnippet
            ? candidates.find((c) => (c.textContent || '').trim().includes(item.textSnippet.slice(0, 24))) ||
              candidates[0]
            : candidates[0];
        }
        if (!el && item.textSnippet) {
          const needle = item.textSnippet.trim().slice(0, 24);
          if (needle.length >= 4) {
            el = Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,span,div')).find(
              (c) => (c.textContent || '').trim().includes(needle)
            ) || null;
          }
        }
        if (!el) {
          if (item.finalOpacity >= 0.8) {
            stuck.push({ selector: item.selector, text: item.textSnippet, expectedOpacity: item.finalOpacity, actualOpacity: 'missing' });
          }
          continue;
        }
        checked++;
        const cs = window.getComputedStyle(el);
        const op = parseFloat(cs.opacity);
        if (item.finalOpacity >= 0.8 && op < 0.5) {
          stuck.push({
            selector: item.selector,
            text: (item.textSnippet || '').slice(0, 40),
            expectedOpacity: item.finalOpacity,
            actualOpacity: Number(op.toFixed(2))
          });
        }
      }
      return { checked, stuck };
    }, mountReveals);

    summary.mountRevealsChecked = revealAudit.checked;
    for (const s of revealAudit.stuck) {
      failures.push(
        `Stuck mount reveal on "${route}" (${s.selector} "${s.text}"): expected opacity ~${s.expectedOpacity}, actual ${s.actualOpacity}.`
      );
    }
  }

  // 4. Interactive Controls Verification (tabs, accordions, disclosures, captured states)
  const interactiveResult = await page.evaluate(async (recordedStates) => {
    const controlErrors = [];
    let tested = 0;

    // 4a. Disclosures ([aria-expanded])
    const firstDisclosure = document.querySelector('button[aria-expanded]');
    if (firstDisclosure) {
      tested++;
      const before = firstDisclosure.getAttribute('aria-expanded');
      firstDisclosure.click();
      await new Promise((r) => setTimeout(r, 80));
      const after = firstDisclosure.getAttribute('aria-expanded');
      if (after === before) {
        controlErrors.push(
          `Disclosure button "${(firstDisclosure.textContent || '').trim().slice(0, 40)}" did not toggle aria-expanded.`
        );
      } else {
        firstDisclosure.click();
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    // 4b. Tabs ([role="tablist"] [role="tab"])
    const tabLists = document.querySelectorAll('[role="tablist"]');
    for (const list of Array.from(tabLists).slice(0, 2)) {
      const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
      const inactiveTab = tabs.find((t) => t.getAttribute('aria-selected') !== 'true');
      const activeTab = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      if (inactiveTab) {
        tested++;
        inactiveTab.click();
        await new Promise((r) => setTimeout(r, 80));
        if (inactiveTab.getAttribute('aria-selected') !== 'true') {
          controlErrors.push(
            `Tab "${(inactiveTab.textContent || '').trim().slice(0, 30)}" did not set aria-selected="true" on click.`
          );
        }
        if (activeTab) {
          activeTab.click();
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    }

    // 4c. Stage 0 Captured State Transitions
    for (const st of (recordedStates || [])) {
      if (!st.selector || st.action !== 'click') continue;
      try {
        const target = document.querySelector(st.selector);
        if (!target) { controlErrors.push('Missing recorded control ' + st.selector); continue; }
        tested++;
        const beforeText = (document.body.innerText || '').length;
        const beforeAttr = st.changedAttr ? target.getAttribute(st.changedAttr) : null;
        target.click();
        await new Promise((r) => setTimeout(r, 100));
        const afterText = (document.body.innerText || '').length;
        const afterAttr = st.changedAttr ? target.getAttribute(st.changedAttr) : null;
        if (st.changedAttr && beforeAttr === afterAttr && beforeText === afterText) {
          controlErrors.push(`Interactive control "${st.selector}" did not produce state transition on click.`);
        }
      } catch {}
    }

    return { tested, controlErrors };
  }, routeContracts.interactiveStates || []);

  summary.testedControls = interactiveResult.tested;
  failures.push(...interactiveResult.controlErrors);

  // 5. Scroll to middle to verify deferred / intersection Canvas2D seams also render non-empty pixels
  const scrollInfo = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight
  }));
  if (scrollInfo.scrollHeight > scrollInfo.innerHeight * 1.5) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollInfo.scrollHeight * 0.45));
    await page.waitForTimeout(200);
    const midCanvasEmpty = await page.evaluate(() => {
      const empties = [];
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0 && r.width >= 20 && r.height >= 20) {
          const tracker = window.__AGY_KINETIC__;
          const ctxType = tracker?.contexts?.get(c);
          if (ctxType === '2d') {
            try {
              const ctx = c.getContext('2d');
              const d = ctx.getImageData(0, 0, Math.min(c.width, 64), Math.min(c.height, 64)).data;
              let nonZero = false;
              for (let k = 3; k < d.length; k += 4) {
                if (d[k] > 0) {
                  nonZero = true;
                  break;
                }
              }
              if (!nonZero) empties.push(c.id || c.className || 'canvas-2d');
            } catch {}
          }
        }
      }
      return empties;
    });
    if (midCanvasEmpty.length > 0) {
      failures.push(`In-viewport Canvas2D rendered completely blank during scroll on "${route}": ${midCanvasEmpty.join(', ')}`);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
  }

  return {
    passed: failures.length === 0,
    failures,
    warnings,
    summary
  };
}
