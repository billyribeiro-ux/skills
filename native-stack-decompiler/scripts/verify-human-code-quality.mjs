#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import postcss from 'postcss';

const traverse = traverseModule.default || traverseModule;

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const TARGET_DIR = path.resolve(getArg('--src-dir', './01-native/src'));

if (!fs.existsSync(TARGET_DIR)) {
  console.error(`❌ [NUCLEAR GATE FAIL] Source directory does not exist: ${TARGET_DIR}`);
  process.exit(1);
}

const rootDir = path.dirname(TARGET_DIR);
console.log(`🧐 Scanning Author-Grade Code Quality & Chunk-Bypass Integrity in: ${TARGET_DIR} (Root: ${rootDir})`);

const infractions = [];

function walkFiles(dir, skipDirs = new Set(['node_modules', '.svelte-kit', '.git', 'forensics', '__sourcemaps__'])) {
  const list = [];
  if (!fs.existsSync(dir)) return list;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (!skipDirs.has(f.name)) list.push(...walkFiles(full, skipDirs));
    } else if (f.isFile()) {
      list.push(full);
    }
  }
  return list;
}

// -------------------------------------------------------------------------
// RULE 0: Nuclear Root-Wide Chunk-Bypass Detection (01-native & 02-svelte5)
// -------------------------------------------------------------------------
const allRootFiles = walkFiles(rootDir);
for (const rf of allRootFiles) {
  const relRoot = path.relative(rootDir, rf).replace(/\\/g, '/');
  if (
    /(?:^|\/)(?:_next\/static\/.*\.m?js|_astro\/.*\.m?js|_nuxt\/.*\.m?js|(?:webpack|turbopack|chunk-)[^/]*\.m?js|.*\.(?:min|built)\.m?js)$/i.test(
      relRoot
    )
  ) {
    infractions.push({
      file: relRoot,
      rule: 'CHUNK_BYPASS_DETECTED (Forbidden Mirrored Bundle)',
      details: `Mirrored JS bundle "${relRoot}" exists inside decoded app root. All runtime JS must be human-readable source inside src/.`
    });
  }
  if (rf.endsWith('.html')) {
    const htmlText = fs.readFileSync(rf, 'utf8');
    if (/(?:\/_next\/static\/|self\.__next_f|\.(?:min|built)\.js|turbopack-|webpackChunk)/i.test(htmlText)) {
      infractions.push({
        file: relRoot,
        rule: 'CHUNK_BYPASS_DETECTED (HTML Bundle Reference)',
        details: `HTML file "${relRoot}" still references mirrored bundler chunks or RSC Flight streams (self.__next_f).`
      });
    }
  }
}

const files = walkFiles(TARGET_DIR);
const codeExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.svelte']);
const executableFiles = files.filter((f) => codeExts.has(path.extname(f).toLowerCase()));

if (executableFiles.length === 0) {
  console.error(`❌ [NUCLEAR GATE FAIL] Zero executable source files (.js/.jsx/.ts/.tsx/.svelte) found in ${TARGET_DIR}!`);
  process.exit(1);
}

console.log(`  Evaluating ${files.length} source files (${executableFiles.length} code modules)...`);

function inspectJsTsAst(jsCode, relFile, baseLineOffset = 0) {
  const lines = jsCode.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.length > 180 &&
      !line.includes('d="') &&
      !line.includes("d='") &&
      !line.includes('data:') &&
      !line.includes('http://') &&
      !line.includes('https://') &&
      !line.includes('className=') &&
      !line.includes('class=') &&
      !relFile.includes('Manifest')
    ) {
      infractions.push({
        file: relFile,
        line: baseLineOffset + i + 1,
        rule: 'Minified Line Exceeding 180 Chars',
        details: `Line ${baseLineOffset + i + 1} is ${line.length} chars long, indicating unformatted minified code.`
      });
      break;
    }
  }

  let ast;
  try {
    ast = parser.parse(jsCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    });
  } catch (parseErr) {
    infractions.push({
      file: relFile,
      rule: 'JavaScript/TypeScript Parse Error',
      details: `Babel failed to parse module: ${parseErr.message.split('\n')[0]}`
    });
    return;
  }

  let flaggedSequence = false;
  let flaggedWrapper = false;
  let flaggedCompiledJsx = false;
  const flaggedPlaceholders = new Set();

  traverse(ast, {
    UnaryExpression(p) {
      if (p.node.operator === '!' && t.isNumericLiteral(p.node.argument)) {
        infractions.push({
          file: relFile,
          line: baseLineOffset + (p.node.loc?.start.line || 1),
          rule: 'Minified Boolean Idiom (!0 / !1)',
          details: `Use true or false instead of !${p.node.argument.value}.`
        });
      } else if (p.node.operator === 'void') {
        infractions.push({
          file: relFile,
          line: baseLineOffset + (p.node.loc?.start.line || 1),
          rule: 'Minified Undefined/Void Idiom (void)',
          details: t.isNumericLiteral(p.node.argument, { value: 0 })
            ? 'Use undefined instead of void 0.'
            : 'Unwrap void (...) wrappers into normal statements.'
        });
      }
    },

    SequenceExpression(p) {
      if (flaggedSequence) return;
      const parent = p.parentPath;
      const inForHeader =
        parent &&
        parent.isForStatement() &&
        (p.node === parent.node.init || p.node === parent.node.update);
      if (!inForHeader) {
        flaggedSequence = true;
        infractions.push({
          file: relFile,
          line: baseLineOffset + (p.node.loc?.start.line || 1),
          rule: 'Minified Comma Sequence Expression',
          details: 'Unroll (a, b, c) comma sequence expressions into separate statements.'
        });
      }
    },

    CallExpression(p) {
      // Detect un-decompiled jsx() / jsxs() bundler calls
      if (!flaggedCompiledJsx) {
        const callee = p.node.callee;
        const isRawJsxCall =
          (t.isIdentifier(callee) && ['_jsx', '_jsxs', 'jsxDEV'].includes(callee.name)) ||
          (t.isMemberExpression(callee) &&
            t.isIdentifier(callee.property) &&
            ['jsx', 'jsxs', 'jsxDEV'].includes(callee.property.name));
        if (isRawJsxCall) {
          flaggedCompiledJsx = true;
          infractions.push({
            file: relFile,
            line: baseLineOffset + (p.node.loc?.start.line || 1),
            rule: 'Un-Decompiled Bundler JSX Call',
            details: 'Found compiled .jsx() / .jsxs() call instead of genuine <Tag> JSX syntax.'
          });
        }
      }

      if (!flaggedWrapper) {
        if (
          t.isMemberExpression(p.node.callee) &&
          t.isIdentifier(p.node.callee.object, { name: 'Object' }) &&
          t.isIdentifier(p.node.callee.property, { name: 'defineProperty' }) &&
          p.node.arguments.length >= 2 &&
          t.isMemberExpression(p.node.arguments[1]) &&
          t.isIdentifier(p.node.arguments[1].object, { name: 'Symbol' }) &&
          t.isIdentifier(p.node.arguments[1].property, { name: 'toStringTag' })
        ) {
          flaggedWrapper = true;
          infractions.push({
            file: relFile,
            line: baseLineOffset + (p.node.loc?.start.line || 1),
            rule: 'Rollup Module Wrapper Artifact',
            details: 'Unwrap Symbol.toStringTag / Object.defineProperty Module boilerplate into clean ES exports.'
          });
        }
      }
    },

    Function(p) {
      const singleLetterParams = p.node.params.filter((param) => t.isIdentifier(param) && param.name.length === 1);
      if (singleLetterParams.length >= 3) {
        infractions.push({
          file: relFile,
          line: baseLineOffset + (p.node.loc?.start.line || 1),
          rule: 'Minified Function Signature',
          details: `Function has ${singleLetterParams.length} single-letter parameters (${singleLetterParams
            .map((sp) => sp.name)
            .join(', ')}). Must be semantically renamed.`
        });
      }

      for (const bindingName of Object.keys(p.scope.bindings)) {
        const binding = p.scope.bindings[bindingName];
        const inForInit = Boolean(binding.path.findParent((par) => par.isForStatement()));
        const isSingleLetterOpaque =
          ['e', 't', 'n', 'r', 'o', 's', 'c', 'l'].includes(bindingName) && !inForInit;
        const isDummyPlaceholder =
          isSingleLetterOpaque ||
          /^(?:var|param)_[a-zA-Z0-9]+$/.test(bindingName) ||
          (/^(?:target|elem|entry|item|nextVal|prevVal|factor|ratio|bound|localValue|moduleLocal)\d*$/.test(
            bindingName
          ) &&
            (/\d$/.test(bindingName) ||
              ['elem', 'nextVal', 'prevVal', 'localValue', 'moduleLocal'].includes(bindingName)));
        if (isDummyPlaceholder && !flaggedPlaceholders.has(bindingName)) {
          flaggedPlaceholders.add(bindingName);
          infractions.push({
            file: relFile,
            line: baseLineOffset + (binding.identifier?.loc?.start.line || 1),
            rule: 'Generic AST Placeholder / Minified Local Identifier',
            details: `Rename "${bindingName}" to a meaningful domain-specific identifier.`
          });
        }
      }
    }
  });
}

for (const file of files) {
  const rel = path.relative(TARGET_DIR, file);
  const base = path.basename(file);
  const stem = path.basename(file, path.extname(file));
  const ext = path.extname(file).toLowerCase();
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // Rule 1: Opaque OR Hashed Chunk Filenames (e.g. 04ai5m7_557lv.jsx, turbopack-3h_ctk.jsx, chunk-xyz.js)
  const isHashedChunkStem =
    codeExts.has(ext) &&
    !base.startsWith('+') &&
    (/(?:module-\d+|chunk-|^bundle|turbopack|webpack|\.min\.|\.built\.)/i.test(base) ||
      (/^[0-9a-z_-]{8,}$/.test(stem) && /\d/.test(stem) && /[a-z]/.test(stem) && !/[A-Z]/.test(stem)));

  if (isHashedChunkStem) {
    infractions.push({
      file: rel,
      rule: 'Opaque / Hashed Chunk Filename',
      details: `Filename "${base}" is an un-decoded bundler hash or opaque chunk name. Rename to semantic domain component/module.`
    });
  }

  // Rule 2: Bundler / Hydration Pollution
  const pollutionMatches = content.match(
    /(?:__webpack_require__|TURBOPACK|webpackChunk|self\.__next_f|\$RB|\$RC|_cjsDefaultExport|_inline_|_submod_|Comp_[a-zA-Z0-9]|definePublicField|defineNormalField)/g
  );
  if (pollutionMatches) {
    infractions.push({
      file: rel,
      rule: 'Bundler/Hydration Pollution',
      details: `Found bundler tokens: ${Array.from(new Set(pollutionMatches)).join(', ')}`
    });
  }

  // Rule 5: Monolithic / Leaked Vendor JS/Component Files (>1,500 lines)
  if (ext !== '.json' && ext !== '.css' && lines.length > 1500) {
    infractions.push({
      file: rel,
      rule: 'Leaked Vendor Bundle / Monolithic File',
      details: `File contains ${lines.length} lines (max allowed 1,500). Split into modular components or npm vendor imports.`
    });
  }

  // Rule 6 & 7: CSS Spec & Editor Compliance
  if (ext === '.css') {
    const charsetMatches = [...content.matchAll(/@charset/gi)];
    if (charsetMatches.length > 1 || (charsetMatches.length === 1 && content.indexOf('@charset') > 10)) {
      infractions.push({
        file: rel,
        rule: 'Unformatted CSS (Mid-file @charset)',
        details: 'Mid-file @charset statements violate CSS specs.'
      });
    }
    if (lines.length > 12000) {
      infractions.push({
        file: rel,
        rule: 'Unsplit CSS Monolith',
        details: `CSS file exceeds 12,000 lines (${lines.length} lines).`
      });
    }

    try {
      const root = postcss.parse(content);
      root.walkRules((rule) => {
        let hasDisplayBlock = false;
        let hasAppearance = false;
        let hasUserSelect = false;
        let hasTransform = false;

        rule.walkDecls((decl) => {
          const val = decl.value.trim();
          if (decl.prop === 'display' && val === 'block') hasDisplayBlock = true;
          if (decl.prop === 'appearance') hasAppearance = true;
          if (decl.prop === 'user-select') hasUserSelect = true;
          if (decl.prop === 'transform') hasTransform = true;

          if (/url\(\s*data:[^)]*[\r\n]/.test(decl.value) || /url\(\s*data:/.test(decl.value)) {
            infractions.push({
              file: rel,
              line: decl.source?.start?.line,
              rule: 'Unquoted or Multiline Data URI',
              details: 'Data URI in url() must be quoted as url("data:...") on a single line.'
            });
          }
          if (decl.prop === 'speak') {
            infractions.push({
              file: rel,
              line: decl.source?.start?.line,
              rule: 'Obsolete CSS Property (speak)',
              details: 'speak property is obsolete.'
            });
          }
          if (decl.prop === 'tap-highlight-color') {
            infractions.push({
              file: rel,
              line: decl.source?.start?.line,
              rule: 'Non-Standard CSS Property (tap-highlight-color)',
              details: 'Use -webkit-tap-highlight-color.'
            });
          }
          if (decl.prop === 'vertical-align' && hasDisplayBlock) {
            infractions.push({
              file: rel,
              line: decl.source?.start?.line,
              rule: 'Invalid Property Due To Display (vertical-align on block)',
              details: 'vertical-align has no effect on display: block.'
            });
          }
        });

        if (!rule.selector.includes('::-webkit-') && !rule.selector.includes('::-moz-')) {
          rule.walkDecls((decl) => {
            if (decl.prop === '-webkit-appearance' && !hasAppearance) {
              infractions.push({
                file: rel,
                line: decl.source?.start?.line,
                rule: 'Missing Standard Property Companion (appearance)',
                details: 'Define "appearance" alongside -webkit-appearance.'
              });
            }
            if (decl.prop === '-webkit-user-select' && !hasUserSelect) {
              infractions.push({
                file: rel,
                line: decl.source?.start?.line,
                rule: 'Missing Standard Property Companion (user-select)',
                details: 'Define "user-select" alongside -webkit-user-select.'
              });
            }
            if (decl.prop === '-webkit-transform' && !hasTransform) {
              infractions.push({
                file: rel,
                line: decl.source?.start?.line,
                rule: 'Missing Standard Property Companion (transform)',
                details: 'Define "transform" alongside -webkit-transform.'
              });
            }
          });
        }
      });
    } catch (cssErr) {
      infractions.push({
        file: rel,
        rule: 'CSS Syntax Error',
        details: `PostCSS failed to parse CSS: ${cssErr.message}`
      });
    }
  }

  // Rule 8: Form Accessibility & Autocomplete
  if (ext === '.html' || ext === '.svelte' || ext === '.jsx' || ext === '.tsx') {
    if (content.includes('<form') || content.includes('<input') || content.includes('<textarea')) {
      const inputIdMatches = Array.from(
        content.matchAll(/<(?:input|textarea|select)[^>]*\bid=["']([^"']+)["'][^>]*>/gi)
      );
      const existingIds = new Set(inputIdMatches.map((m) => m[1]));

      const labelMatches = Array.from(content.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["'][^>]*>/gi));
      for (const lm of labelMatches) {
        const forVal = lm[1];
        if (!forVal.includes('{') && !existingIds.has(forVal)) {
          infractions.push({
            file: rel,
            rule: 'Broken Form Label Association',
            details: `<label for="${forVal}"> does not match any element with id="${forVal}".`
          });
        }
      }

      const inputMatches = Array.from(content.matchAll(/<(input|textarea)\b([^>]*?)(\/?)>/gi));
      for (const im of inputMatches) {
        const tag = im[1];
        const attrs = im[2];
        if (attrs.includes('{...') || attrs.includes('spreadAttrs')) continue;
        const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
        const type = typeMatch ? typeMatch[1].toLowerCase() : tag.toLowerCase() === 'textarea' ? 'textarea' : 'text';
        if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(type)) continue;
        if (!/\bautocomplete\s*=/i.test(attrs)) {
          infractions.push({
            file: rel,
            rule: 'Missing Autocomplete Attribute',
            details: `<${tag} ${attrs.trim().slice(0, 40)}...> is missing an autocomplete attribute.`
          });
        }
      }
    }
  }

  // Rule 8b: Anti-Generic DOM-AST Escape Hatch (RichNode / Recursive AST Shells)
  if (ext === '.svelte') {
    const compName = path.basename(file, '.svelte');
    const isSelfRecursiveElement =
      content.includes('<svelte:element') &&
      (content.includes(`<${compName}`) || content.includes('<svelte:self')) &&
      /\.children\b/.test(content);
    const isExplicitAstWrapper = /^(?:RichNode|DomAstNode|RawDomNode|AstRenderer|VerbatimDom)$/i.test(compName);
    if (isSelfRecursiveElement || isExplicitAstWrapper) {
      infractions.push({
        file: rel,
        rule: 'Generic DOM-AST Wrapper Escape Hatch Forbidden',
        details: `Component "${compName}.svelte" recursively renders raw serialized DOM AST nodes instead of decomposed domain components.`
      });
    }
  }

  // Rule 3 & 4: AST-Level JS/TS & Svelte <script> Inspection
  if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx' || ext === '.mjs') {
    inspectJsTsAst(content, rel, 0);
  } else if (ext === '.svelte') {
    for (const sm of content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      const pre = content.slice(0, sm.index || 0);
      const lineOffset = pre.split('\n').length - 1;
      inspectJsTsAst(sm[1], rel, lineOffset);
    }
  }
}

// Rule 9: Multi-Line Formatted Stage 1 Route HTML & Resolved Streaming Boundaries
const isStage1NativeRoot =
  path.basename(TARGET_DIR) === 'src' &&
  !fs.existsSync(path.join(rootDir, 'vite.config.ts')) &&
  !fs.existsSync(path.join(rootDir, 'src', 'routes'));

if (isStage1NativeRoot) {
  for (const rf of allRootFiles) {
    if (!rf.endsWith('.html')) continue;
    const relHtml = path.relative(rootDir, rf);
    if (relHtml.startsWith('__external') || relHtml.startsWith('forensics')) continue;
    const htmlContent = fs.readFileSync(rf, 'utf8');
    const htmlLines = htmlContent.split('\n');
    if (htmlContent.length > 2000 && htmlLines.length < 15) {
      infractions.push({
        file: relHtml,
        rule: 'Unformatted Minified HTML',
        details: `HTML file is ${htmlContent.length} bytes across only ${htmlLines.length} lines. Format with htmlWhitespaceSensitivity: "strict".`
      });
    }
    if (/<template\b[^>]*\bid=["']B:\d+["']/i.test(htmlContent) || /<div\b[^>]*\bid=["']S:\d+["']/i.test(htmlContent)) {
      infractions.push({
        file: relHtml,
        rule: 'Unresolved React Streaming Suspense Slot',
        details: `HTML still contains unresolved <template id="B:x"> / <div hidden id="S:x"> Suspense wrappers.`
      });
    }
  }
}

// Rule 10: Clean tsconfig.json
for (const tc of [path.join(TARGET_DIR, 'tsconfig.json'), path.join(rootDir, 'tsconfig.json')]) {
  if (fs.existsSync(tc)) {
    const tsconfigContent = fs.readFileSync(tc, 'utf8');
    if (tsconfigContent.includes('ignoreDeprecations')) {
      infractions.push({
        file: path.relative(rootDir, tc),
        rule: 'Invalid or Deprecated tsconfig Option',
        details: 'Remove deprecated "ignoreDeprecations" flag from tsconfig.json.'
      });
    }
  }
}

console.log(`\n========================================`);
if (infractions.length > 0) {
  console.error(`💥 HUMAN-WRITTEN CODE QUALITY GATE FAILED: ${infractions.length} infraction(s) detected!\n`);
  for (const inf of infractions.slice(0, 20)) {
    console.error(`  ❌ [${inf.rule}] ${inf.file}${inf.line ? `:${inf.line}` : ''}`);
    console.error(`     ${inf.details}`);
  }
  if (infractions.length > 20) {
    console.error(`     ... and ${infractions.length - 20} more infractions.`);
  }
  process.exit(1);
} else {
  console.log(
    `✅ HUMAN-WRITTEN CODE QUALITY GATE PASSED: 100% chunk-free, author-grade code confirmed across ${files.length} files.`
  );
  process.exit(0);
}
