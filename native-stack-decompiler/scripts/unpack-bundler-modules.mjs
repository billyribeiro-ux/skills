#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';
import { humanizeJavaScript } from './ast-humanizer.mjs';

const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

/**
 * Fingerprints third-party framework/vendor runtime modules so they are NEVER dumped into src/,
 * mapping them cleanly to npm packages in package.json instead.
 */
const VENDOR_FINGERPRINTS = [
  {
    pkg: 'react/compiler-runtime',
    test: (code) => code.includes('react.memo_cache_sentinel') && code.length < 4000
  },
  {
    pkg: 'react',
    test: (code) =>
      code.includes('SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED') ||
      code.includes('__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE') ||
      code.includes('react.element') ||
      code.includes('react.transitional.element')
  },
  {
    pkg: 'react-dom',
    test: (code) =>
      code.includes('__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE') ||
      (code.includes('hydrateRoot') && code.includes('createPortal'))
  },
  {
    pkg: 'next-internal',
    test: (code) =>
      code.includes('NEXT_ROUTER_PREFETCH') ||
      code.includes('AppRouterContext') ||
      code.includes('LayoutRouterContext') ||
      code.includes('__NEXT_DATA__') ||
      code.includes('bailoutToClientRendering') ||
      code.includes('createFromFetch')
  },
  {
    pkg: 'scheduler',
    test: (code) => code.includes('unstable_ImmediatePriority') && code.includes('unstable_scheduleCallback')
  },
  {
    pkg: 'three',
    test: (code) => code.includes('THREE.WebGLRenderer') || (code.includes('PerspectiveCamera') && code.includes('BufferGeometry'))
  },
  {
    pkg: 'gsap',
    test: (code) => code.includes('GreenSock') || (code.includes('gsap.registerPlugin') && code.length > 25000)
  },
  {
    pkg: 'hls.js',
    test: (code) => code.includes('Hls.Events') && code.includes('MANIFEST_PARSED') && code.length > 25000
  },
  {
    pkg: 'lenis',
    test: (code) => code.includes('lenis-smooth') && code.includes('virtualScroll')
  },
  {
    pkg: 'framer-motion',
    test: (code) => code.includes('MotionConfigContext') && code.includes('LayoutGroupContext') && code.length > 15000
  }
];

export function classifyVendorModule(code) {
  for (const fp of VENDOR_FINGERPRINTS) {
    if (fp.test(code)) return fp.pkg;
  }
  return null;
}

/**
 * Extracts RSC Flight Stream client component symbol mappings (`I[moduleId, [...], "ExportName"]`)
 * AND serialized route data payloads from HTML `self.__next_f.push(...)` and `.rsc` fixtures.
 */
export function decodeRscFlightStreams(mirrorDir) {
  const rscSymbols = new Map(); // moduleId -> { id, exportName, componentName, chunks }
  const routePayloads = {}; // routeName -> extracted structured text/props/elements

  function parseFlightText(rawFlight, sourceLabel) {
    // 1. Module import records: hex:I[moduleId, [chunks], "ExportName"]
    const importRegex = /([0-9a-fA-F]+):I\[("?[0-9a-zA-Z_./-]+"?),\s*\[([^\]]*)\],\s*"([^"]*)"\]/g;
    for (const m of rawFlight.matchAll(importRegex)) {
      const modId = m[2].replace(/^"|"$/g, '');
      const exportName = m[4] || 'default';
      const rawName = exportName === 'default' || exportName === '' ? '' : exportName;
      const cleanName = rawName.replace(/[^a-zA-Z0-9_]/g, '');
      rscSymbols.set(String(modId), {
        id: String(modId),
        exportName,
        componentName: cleanName ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1) : null
      });
    }

    // 2. Collect JSON records per line (`hex:{"..."}` or `hex:["$", ...]`)
    const extractedObjects = [];
    for (const line of rawFlight.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1 || colonIdx > 12) continue;
      const jsonPart = line.slice(colonIdx + 1).trim();
      if (jsonPart.startsWith('{') || jsonPart.startsWith('[')) {
        try {
          const parsed = JSON.parse(jsonPart);
          extractedObjects.push(parsed);
        } catch {}
      }
    }
    if (extractedObjects.length > 0) {
      routePayloads[sourceLabel] = extractedObjects;
    }
  }

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__sourcemaps__', 'forensics'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
      } else if (entry.name.endsWith('.rsc')) {
        parseFlightText(fs.readFileSync(full, 'utf8'), path.basename(full, '.rsc'));
      } else if (entry.name.endsWith('.html')) {
        const html = fs.readFileSync(full, 'utf8');
        const chunks = [];
        for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:\\.|[^"\\])*")\]\)/g)) {
          try {
            chunks.push(JSON.parse(m[1]));
          } catch {}
        }
        if (chunks.length > 0) {
          const relRoute =
            '/' +
            path
              .relative(mirrorDir, path.dirname(full))
              .replace(/\\/g, '/')
              .replace(/^\.$/, '');
          parseFlightText(chunks.join(''), relRoute === '/' ? 'home' : relRoute.slice(1).replace(/\//g, '__'));
        }
      }
    }
  }

  scanDir(mirrorDir);
  return { rscSymbols, routePayloads };
}

/**
 * Unpacks individual module factories from Webpack 4/5, Next.js Turbopack, Vite/Rollup,
 * and UMD chunks using Babel AST traversal — NEVER dumping raw multi-module chunks!
 */
export function extractModuleFactoriesFromBundle(bundleCode, sourceChunkName) {
  const modules = [];
  let ast;
  try {
    ast = parser.parse(bundleCode, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'] });
  } catch {
    return modules;
  }

  traverse(ast, {
    CallExpression(astPath) {
      const callee = astPath.node.callee;
      if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property, { name: 'push' })) return;
      if (astPath.node.arguments.length !== 1 || !t.isArrayExpression(astPath.node.arguments[0])) return;

      const pushArr = astPath.node.arguments[0].elements;
      if (pushArr.length < 2) return;

      // Pattern 1: Webpack 4/5 -> webpackChunk.push([[chunkIds], { [modId]: (m, e, r) => { ... } }])
      if (t.isObjectExpression(pushArr[1])) {
        for (const prop of pushArr[1].properties) {
          if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) continue;
          const modId = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key) || t.isNumericLiteral(prop.key)
              ? String(prop.key.value)
              : null;
          if (!modId) continue;

          const fnNode = t.isObjectMethod(prop) ? prop : prop.value;
          if (t.isFunction(fnNode)) {
            modules.push({
              moduleId: modId,
              bundler: 'webpack',
              sourceChunk: sourceChunkName,
              factoryNode: fnNode
            });
          }
        }
        return;
      }

      // Pattern 2: Next.js Turbopack -> TURBOPACK.push([chunkPath, modId1, factoryFn1, modId2, factoryFn2, ...])
      if (t.isStringLiteral(pushArr[0]) || Array.isArray(pushArr)) {
        for (let i = 1; i < pushArr.length - 1; i++) {
          const idEl = pushArr[i];
          const nextEl = pushArr[i + 1];
          if (
            (t.isNumericLiteral(idEl) || t.isStringLiteral(idEl)) &&
            nextEl &&
            t.isFunction(nextEl)
          ) {
            modules.push({
              moduleId: String(idEl.value),
              bundler: 'turbopack',
              sourceChunk: sourceChunkName,
              factoryNode: nextEl
            });
            i++;
          } else if (idEl && t.isObjectExpression(idEl)) {
            for (const prop of idEl.properties) {
              if (!t.isObjectProperty(prop) && !t.isObjectMethod(prop)) continue;
              const modId = t.isIdentifier(prop.key)
                ? prop.key.name
                : t.isStringLiteral(prop.key) || t.isNumericLiteral(prop.key)
                  ? String(prop.key.value)
                  : null;
              const fnNode = t.isObjectMethod(prop) ? prop : prop.value;
              if (modId && t.isFunction(fnNode)) {
                modules.push({
                  moduleId: modId,
                  bundler: 'turbopack',
                  sourceChunk: sourceChunkName,
                  factoryNode: fnNode
                });
              }
            }
          }
        }
      }
    }
  });

  return modules;
}

/**
 * Unwraps a Webpack or Turbopack module factory `(ctx, mod, exports) => { ... }`
 * into standalone ES module source code with clean `import` and `export` statements!
 */
export function convertFactoryToEsModule(factoryEntry, moduleNameMap) {
  const { factoryNode } = factoryEntry;
  if (!factoryNode.body || !t.isBlockStatement(factoryNode.body)) {
    return generate(factoryNode).code;
  }

  const params = factoryNode.params.map((p) => (t.isIdentifier(p) ? p.name : null));
  // Webpack: (module, exports, require) -> require is params[2]
  // Turbopack: (turbopackCtx, module, exports) -> turbopackCtx is params[0] (has .i(id) & .s([...]))
  const wpRequireParam = params[2];
  const tbCtxParam = params[0];

  const bodyStmts = [...factoryNode.body.body];
  const importDecls = [];
  const exportMap = new Map(); // exportedName -> localIdentifierName
  const seenImports = new Set();

  const programAst = t.file(t.program(bodyStmts, [], 'module'));

  traverse(programAst, {
    // Unwrap Turbopack exports: tbCtx.s(["ComponentName", () => LocalFn, ...])
    CallExpression(astPath) {
      const callee = astPath.node.callee;

      // Turbopack ctx.s(["ExportName", () => ident, ...])
      if (
        tbCtxParam &&
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: tbCtxParam }) &&
        t.isIdentifier(callee.property, { name: 's' }) &&
        t.isArrayExpression(astPath.node.arguments[0])
      ) {
        const elems = astPath.node.arguments[0].elements;
        for (let i = 0; i < elems.length - 1; i += 2) {
          const nameNode = elems[i];
          const getterNode = elems[i + 1];
          if (t.isStringLiteral(nameNode) && t.isFunction(getterNode)) {
            const retExpr = t.isBlockStatement(getterNode.body)
              ? getterNode.body.body.find((s) => t.isReturnStatement(s))?.argument
              : getterNode.body;
            if (retExpr && t.isIdentifier(retExpr)) {
              exportMap.set(nameNode.value, retExpr.name);
            }
          }
        }
        if (astPath.parentPath.isExpressionStatement()) {
          astPath.parentPath.remove();
        }
        return;
      }

      // Webpack __webpack_require__.d(exports, { ExportName: () => ident })
      if (
        wpRequireParam &&
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: wpRequireParam }) &&
        t.isIdentifier(callee.property, { name: 'd' }) &&
        t.isObjectExpression(astPath.node.arguments[1])
      ) {
        for (const prop of astPath.node.arguments[1].properties) {
          if (!t.isObjectProperty(prop)) continue;
          const expName = t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
              ? prop.key.value
              : null;
          if (expName && t.isFunction(prop.value)) {
            const retExpr = t.isBlockStatement(prop.value.body)
              ? prop.value.body.body.find((s) => t.isReturnStatement(s))?.argument
              : prop.value.body;
            if (retExpr && t.isIdentifier(retExpr)) {
              exportMap.set(expName, retExpr.name);
            }
          }
        }
        if (astPath.parentPath.isExpressionStatement()) {
          astPath.parentPath.remove();
        }
        return;
      }

      // Strip __webpack_require__.r(exports)
      if (
        wpRequireParam &&
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: wpRequireParam }) &&
        t.isIdentifier(callee.property, { name: 'r' })
      ) {
        if (astPath.parentPath.isExpressionStatement()) {
          astPath.parentPath.remove();
        }
        return;
      }

      // Convert Turbopack `const dep = tbCtx.i(modId)` or Webpack `const dep = require(modId)` into ES import!
      const isTbImport =
        tbCtxParam &&
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: tbCtxParam }) &&
        t.isIdentifier(callee.property, { name: 'i' }) &&
        astPath.node.arguments.length === 1;
      const isWpImport =
        wpRequireParam && t.isIdentifier(callee, { name: wpRequireParam }) && astPath.node.arguments.length === 1;

      if ((isTbImport || isWpImport) && astPath.parentPath.isVariableDeclarator()) {
        const arg0 = astPath.node.arguments[0];
        const depId = t.isNumericLiteral(arg0) || t.isStringLiteral(arg0) ? String(arg0.value) : null;
        const varId = astPath.parentPath.node.id;
        if (depId && t.isIdentifier(varId)) {
          const targetMeta = moduleNameMap.get(depId);
          // Omit react/jsx-runtime imports because compiled jsx() calls are converted to native <JSX>!
          if (targetMeta?.vendorPkg === 'react-jsx-runtime' || targetMeta?.vendorPkg === 'react/jsx-runtime') {
            const declParent = astPath.parentPath.parentPath;
            if (declParent?.isVariableDeclaration() && declParent.node.declarations.length === 1) {
              declParent.remove();
            } else {
              astPath.parentPath.remove();
            }
            return;
          }
          const importSource = targetMeta?.importPath || (targetMeta?.vendorPkg && targetMeta.vendorPkg !== 'next-internal' ? targetMeta.vendorPkg : null);
          if (importSource && !seenImports.has(`${varId.name}:${importSource}`)) {
            seenImports.add(`${varId.name}:${importSource}`);
            importDecls.push(
              t.importDeclaration([t.importNamespaceSpecifier(t.identifier(varId.name))], t.stringLiteral(importSource))
            );
            const declParent = astPath.parentPath.parentPath;
            if (declParent?.isVariableDeclaration() && declParent.node.declarations.length === 1) {
              declParent.remove();
            } else {
              astPath.parentPath.remove();
            }
          } else if (!importSource) {
            astPath.replaceWith(t.objectExpression([]));
          }
        }
      }
    }
  });

  // Prepend clean ES imports
  programAst.program.body.unshift(...importDecls);

  // Append clean ES exports
  const exportSpecs = [];
  let defaultLocal = null;
  for (const [expName, localName] of exportMap.entries()) {
    if (expName === 'default') {
      defaultLocal = localName;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(expName)) {
      exportSpecs.push(t.exportSpecifier(t.identifier(localName), t.identifier(expName)));
    }
  }
  if (exportSpecs.length > 0) {
    programAst.program.body.push(t.exportNamedDeclaration(null, exportSpecs));
  }
  if (defaultLocal) {
    programAst.program.body.push(t.exportDefaultDeclaration(t.identifier(defaultLocal)));
  }

  return generate(programAst).code;
}

/**
 * Derives a semantic PascalCase or camelCase module filename (NEVER hashed chunk names like 04ai5m7_557lv!).
 */
export function deriveSemanticModuleName(rawCode, modId, rscSymbols, usedNames) {
  let baseName = null;

  // 1. RSC Flight Stream explicit ExportName
  const rscHit = rscSymbols.get(String(modId));
  if (rscHit?.componentName && !/^(?:default|Component|Module)$/i.test(rscHit.componentName)) {
    baseName = rscHit.componentName;
  }

  // 2. displayName or named PascalCase function/class declaration
  if (!baseName) {
    const dispMatch = rawCode.match(/\.displayName\s*=\s*["']([A-Z][a-zA-Z0-9_]+)["']/);
    if (dispMatch) baseName = dispMatch[1];
  }
  if (!baseName) {
    const fnMatch = rawCode.match(/(?:export\s+)?(?:function|class)\s+([A-Z][a-zA-Z0-9_]{2,})/);
    if (fnMatch) baseName = fnMatch[1];
  }

  // 2b. Explicit Turbopack / Webpack export name clue: ctx.s(["ExportName", ...])
  if (!baseName) {
    const expMatch = rawCode.match(/\.s\(\[\s*["']([A-Z][a-zA-Z0-9_]{2,})["']/);
    if (expMatch) baseName = expMatch[1];
  }

  // 3. Semantic landmark / ARIA / heading / CSS class / data-matrix clue inside module
  if (!baseName) {
    const idMatch = rawCode.match(/\bid\s*[:=]\s*["']([a-zA-Z][a-zA-Z0-9_-]{2,24})["']/);
    const ariaMatch = rawCode.match(/aria-label\s*[:=]\s*["']([a-zA-Z][a-zA-Z0-9 _-]{2,28})["']/i);
    const shaderClue = rawCode.includes('gl_FragColor') || rawCode.includes('gl_Position');
    const canvasClue = rawCode.includes('getContext("2d")') || rawCode.includes("getContext('2d')");
    const hlsClue = rawCode.includes('.m3u8') || rawCode.includes('Hls');
    const matrixClue = rawCode.includes('cellBrightness') || rawCode.includes('modelCols') || rawCode.includes('modelRows');

    if (shaderClue) baseName = 'ShaderRenderer';
    else if (canvasClue) baseName = 'CanvasSceneController';
    else if (hlsClue) baseName = 'MediaStreamPlayer';
    else if (matrixClue) baseName = 'AsciiModelData';
    else if (idMatch) {
      baseName = idMatch[1]
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
    } else if (ariaMatch) {
      baseName = ariaMatch[1]
        .replace(/[^a-zA-Z0-9 ]+/g, '')
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
    }
  }

  if (!baseName || baseName.length < 3 || /^\d/.test(baseName)) {
    const isJsx = rawCode.includes('.jsx(') || rawCode.includes('.jsxs(') || rawCode.includes('<div') || rawCode.includes('<section');
    baseName = isJsx ? 'UiSectionBlock' : 'DomainHelper';
  }

  let candidate = baseName;
  const variants = ['', 'Primary', 'Secondary', 'Detail', 'Panel', 'Item', 'Card', 'Group', 'View'];
  let idx = 0;
  while (usedNames.has(candidate)) {
    idx++;
    candidate = idx < variants.length ? `${baseName}${variants[idx]}` : `${baseName}Part${idx}`;
  }
  usedNames.add(candidate);
  return candidate;
}

/**
 * Extracts embedded GLSL vertex/fragment shaders from both runtime CDP forensics (`webgl-shaders.json`)
 * and static JS source strings into clean `.glsl` files in `outShadersDir`.
 */
export function extractAllGlslShaders(mirrorDir, rawJsContents, outShadersDir) {
  const savedShaders = [];
  const seenSources = new Set();

  const cdpShaderFile = path.join(mirrorDir, 'forensics', 'webgl-shaders.json');
  if (fs.existsSync(cdpShaderFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cdpShaderFile, 'utf8'));
      for (const sh of parsed.shaders || []) {
        if (!sh.source || seenSources.has(sh.source)) continue;
        seenSources.add(sh.source);
        savedShaders.push({ type: sh.type || 'shader', source: sh.source });
      }
    } catch {}
  }

  const glslRegex = /(["'`])((?:[\s\S]*?(?:gl_Position|gl_FragColor|uniform\s+(?:float|vec[234]|mat[234]|sampler2D))[\s\S]*?))\1/g;
  for (const jsText of rawJsContents) {
    for (const m of jsText.matchAll(glslRegex)) {
      const candidate = m[2].replace(/\\n/g, '\n').replace(/\\t/g, '  ');
      if (candidate.length > 60 && candidate.length < 30000 && !seenSources.has(candidate)) {
        seenSources.add(candidate);
        const type = candidate.includes('gl_Position') ? 'vertex' : 'fragment';
        savedShaders.push({ type, source: candidate });
      }
    }
  }

  if (savedShaders.length > 0) {
    fs.mkdirSync(outShadersDir, { recursive: true });
    savedShaders.forEach((sh, i) => {
      const fileName = `${sh.type}-${i + 1}.glsl`;
      fs.writeFileSync(path.join(outShadersDir, fileName), sh.source.trim() + '\n', 'utf8');
    });
  }

  return savedShaders.length;
}

/**
 * High-level orchestrator: unpacks all bundler chunks in `mirrorDir` into clean, vendor-free,
 * AST-humanized first-party author modules in `outNativeDir/src/`.
 */
export async function unpackAllMirrorBundles(mirrorDir, outNativeDir) {
  const { rscSymbols, routePayloads } = decodeRscFlightStreams(mirrorDir);

  // Save decoded route RSC data payloads as clean JSON in src/data/routes/
  const routesDataDir = path.join(outNativeDir, 'src', 'data', 'routes');
  if (Object.keys(routePayloads).length > 0) {
    fs.mkdirSync(routesDataDir, { recursive: true });
    for (const [routeKey, data] of Object.entries(routePayloads)) {
      fs.writeFileSync(path.join(routesDataDir, `${routeKey}.json`), JSON.stringify(data, null, 2), 'utf8');
    }
  }

  // Collect all JS bundle files from mirrorDir (reading ONLY from 00-mirror!)
  const bundleFiles = [];
  function findJs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__sourcemaps__', 'forensics', '__api_fixtures__'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) findJs(full);
      else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        bundleFiles.push(full);
      }
    }
  }
  findJs(mirrorDir);

  const rawJsTexts = [];
  const allFactories = new Map(); // modId -> factoryEntry
  const detectedVendors = new Set();

  for (const bf of bundleFiles) {
    const code = fs.readFileSync(bf, 'utf8');
    rawJsTexts.push(code);
    const extracted = extractModuleFactoriesFromBundle(code, path.basename(bf));
    for (const item of extracted) {
      if (!allFactories.has(item.moduleId)) {
        allFactories.set(item.moduleId, item);
      }
    }
  }

  // Extract GLSL shaders if any exist
  const shaderCount = extractAllGlslShaders(
    mirrorDir,
    rawJsTexts,
    path.join(outNativeDir, 'src', 'shaders')
  );

  // Resolve transitive re-export stubs: t.exports = e.r(modId)
  function resolveTargetId(modId, visited = new Set()) {
    if (visited.has(modId)) return modId;
    visited.add(modId);
    const ent = allFactories.get(modId);
    if (!ent) return modId;
    const raw = generate(ent.factoryNode).code.trim();
    const m = raw.match(/(?:t\.exports\s*=|return\s*)(?:[a-zA-Z_$][a-zA-Z0-9_$]*\.[ir]\((\d+)\))/);
    if (m && allFactories.has(m[1])) {
      return resolveTargetId(m[1], visited);
    }
    return modId;
  }

  // Classify vendor vs first-party author modules
  const moduleNameMap = new Map();
  const usedNames = new Set();
  const authorModules = [];

  for (const [modId, entry] of allFactories.entries()) {
    const rawFactoryCode = generate(entry.factoryNode).code;

    // Check if this is a re-export stub to a vendor package
    const realTargetId = resolveTargetId(modId);
    if (realTargetId !== modId && allFactories.has(realTargetId)) {
      const realTargetCode = generate(allFactories.get(realTargetId).factoryNode).code;
      const targetVendor = classifyVendorModule(realTargetCode);
      if (targetVendor) {
        moduleNameMap.set(modId, { vendorPkg: targetVendor === 'next-internal' ? 'next' : targetVendor });
        continue;
      }
    }

    // Detect react/jsx-runtime implementation shim (defines .jsx = / .jsxs =, never author components calling .jsx()!)
    const isJsxRuntimeImpl =
      rawFactoryCode.includes('react.transitional.element') ||
      rawFactoryCode.includes('Symbol.for("react.element")') ||
      rawFactoryCode.includes("Symbol.for('react.element')") ||
      (/\.jsx\s*=/.test(rawFactoryCode) && /\.jsxs\s*=/.test(rawFactoryCode) && rawFactoryCode.length < 4000);
    if (isJsxRuntimeImpl) {
      moduleNameMap.set(modId, { vendorPkg: 'react/jsx-runtime' });
      detectedVendors.add('react');
      continue;
    }

    const vendorPkg = classifyVendorModule(rawFactoryCode);
    if (vendorPkg) {
      moduleNameMap.set(modId, { vendorPkg: vendorPkg === 'next-internal' ? 'next' : vendorPkg });
      if (vendorPkg !== 'next-internal' && vendorPkg !== 'scheduler') {
        detectedVendors.add(vendorPkg);
      }
      continue;
    }

    const isStaticDataMatrix =
      rawFactoryCode.includes('cellBrightness') ||
      rawFactoryCode.includes('modelCols') ||
      rawFactoryCode.includes('modelRows');

    // Skip giant (>60KB) unindentified vendor libraries (but NEVER drop data matrices or RSC modules)
    if (rawFactoryCode.length > 60000 && !rscSymbols.has(modId) && !isStaticDataMatrix) {
      continue;
    }

    // Skip trivial 1-line barrel/constant shims (< 45 chars)
    if (rawFactoryCode.length < 45) continue;

    const semanticName = deriveSemanticModuleName(rawFactoryCode, modId, rscSymbols, usedNames);
    // BANNED: Synthetic chunk names or anonymous fallback shards (DomainHelper*, UiSectionBlock*)
    if (semanticName.startsWith('DomainHelper') || semanticName.startsWith('UiSectionBlock')) {
      continue;
    }

    const hasJsx =
      rscSymbols.has(modId) ||
      /\.jsxs?\b|_jsxs?\(|jsxDEV\(|createElement\(/.test(rawFactoryCode);
    const category = hasJsx
      ? 'components'
      : rawFactoryCode.includes('requestAnimationFrame') ||
          rawFactoryCode.includes('ScrollTrigger') ||
          rawFactoryCode.includes('IntersectionObserver') ||
          rawFactoryCode.includes('getContext')
        ? 'controllers'
        : 'utils';
    const ext = hasJsx ? '.jsx' : '.js';

    moduleNameMap.set(modId, {
      semanticName,
      category,
      ext,
      importPath: `../${category}/${semanticName}${ext}`
    });
    authorModules.push({ modId, entry, semanticName, category, ext, isStaticDataMatrix, rawFactoryCode });
  }

  let writtenAuthorCount = 0;
  let extractedDataCount = 0;
  const extractedDataDir = path.join(outNativeDir, 'src', 'data', 'extracted');
  const moduleIndex = [];

  for (const mod of authorModules) {
    // Extract large static lookup/JSON arrays (e.g., ASCII brightness grids) into clean JSON data files
    if (mod.isStaticDataMatrix || mod.rawFactoryCode.length > 15000) {
      try {
        const jsonLiterals = [];
        for (const jm of mod.rawFactoryCode.matchAll(/JSON\.parse\(\s*(['"])([\s\S]*?)\1\s*\)/g)) {
          try {
            const parsedJson = JSON.parse(jm[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
            jsonLiterals.push(parsedJson);
          } catch {}
        }
        if (jsonLiterals.length > 0 || mod.isStaticDataMatrix) {
          fs.mkdirSync(extractedDataDir, { recursive: true });
          const dataPayload =
            jsonLiterals.length > 0
              ? { moduleId: mod.modId, moduleName: mod.semanticName, jsonTables: jsonLiterals }
              : {
                  moduleId: mod.modId,
                  moduleName: mod.semanticName,
                  sourceSnippetLength: mod.rawFactoryCode.length,
                  note: 'Static numeric/lookup matrix preserved verbatim in data table extraction.'
                };
          fs.writeFileSync(
            path.join(extractedDataDir, `${mod.semanticName}.json`),
            JSON.stringify(dataPayload, null, 2),
            'utf8'
          );
          extractedDataCount++;
        }
      } catch {}
    }

    try {
      const esCode = convertFactoryToEsModule(mod.entry, moduleNameMap);
      const humanized = await humanizeJavaScript(esCode, { jsx: mod.ext === '.jsx' });
      const lines = humanized.split('\n');
      if (lines.length > 1400) continue; // Respect strict 1,500-line modular cap

      const outFile = path.join(outNativeDir, 'src', mod.category, `${mod.semanticName}${mod.ext}`);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, humanized, 'utf8');
      writtenAuthorCount++;
      moduleIndex.push({
        moduleId: mod.modId,
        semanticName: mod.semanticName,
        rscExport: rscSymbols.get(mod.modId)?.exportName || null,
        sourcePath: `src/${mod.category}/${mod.semanticName}${mod.ext}`
      });
    } catch {}
  }

  if (moduleIndex.length > 0) {
    fs.mkdirSync(path.join(outNativeDir, 'src', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(outNativeDir, 'src', 'data', 'rsc-module-index.json'),
      JSON.stringify(moduleIndex, null, 2),
      'utf8'
    );
  }

  return {
    rscSymbolCount: rscSymbols.size,
    routePayloadCount: Object.keys(routePayloads).length,
    totalUnpackedFactories: allFactories.size,
    writtenAuthorCount,
    extractedDataCount,
    shaderCount,
    detectedVendors: Array.from(detectedVendors)
  };
}
