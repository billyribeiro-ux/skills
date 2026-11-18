#!/usr/bin/env node
import parser from '@babel/parser';
import traversePkg from '@babel/traverse';
import generatorPkg from '@babel/generator';
import fs from 'node:fs';
import path from 'node:path';

const traverse = traversePkg.default || traversePkg;
const generate = generatorPkg.default || generatorPkg;

const SVG_KEBAB_MAP = {
  strokeWidth: 'stroke-width',
  strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset',
  strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin',
  strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity',
  fillRule: 'fill-rule',
  fillOpacity: 'fill-opacity',
  clipRule: 'clip-rule',
  clipPath: 'clip-path',
  stopColor: 'stop-color',
  stopOpacity: 'stop-opacity',
  colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters',
  dominantBaseline: 'dominant-baseline',
  textAnchor: 'text-anchor',
  xlinkHref: 'xlink:href'
};

const MOTION_PROP_NAMES = new Set([
  'initial',
  'animate',
  'whileInView',
  'whileHover',
  'whileTap',
  'transition',
  'viewport'
]);

const VOID_HTML_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

export function jsxNodeToSvelte(node, ctx = { usesMotion: false, imgDims: {} }) {
  if (!node) return '';
  if (node.type === 'JSXText') {
    return node.value;
  }
  if (node.type === 'JSXExpressionContainer') {
    const expr = node.expression;
    if (expr.type === 'JSXEmptyExpression') return '';
    if (expr.type === 'Identifier' && expr.name === 'children') {
      return '{@render children?.()}';
    }
    if (expr.type === 'ConditionalExpression') {
      const cond = generate(expr.test).code;
      const consequent =
        expr.consequent.type === 'JSXElement' || expr.consequent.type === 'JSXFragment'
          ? jsxNodeToSvelte(expr.consequent, ctx)
          : `{${generate(expr.consequent).code}}`;

      if (
        expr.alternate.type === 'NullLiteral' ||
        (expr.alternate.type === 'Identifier' && expr.alternate.name === 'undefined') ||
        (expr.alternate.type === 'BooleanLiteral' && expr.alternate.value === false)
      ) {
        return `\n{#if ${cond}}\n  ${consequent.trim()}\n{/if}\n`;
      }
      const alternate =
        expr.alternate.type === 'JSXElement' || expr.alternate.type === 'JSXFragment'
          ? jsxNodeToSvelte(expr.alternate, ctx)
          : `{${generate(expr.alternate).code}}`;
      return `\n{#if ${cond}}\n  ${consequent.trim()}\n{:else}\n  ${alternate.trim()}\n{/if}\n`;
    }
    if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
      const cond = generate(expr.left).code;
      const right =
        expr.right.type === 'JSXElement' || expr.right.type === 'JSXFragment'
          ? jsxNodeToSvelte(expr.right, ctx)
          : `{${generate(expr.right).code}}`;
      return `\n{#if ${cond}}\n  ${right.trim()}\n{/if}\n`;
    }
    // Map -> Svelte 5 keyed {#each} (NEVER using array index as key per @sveltejs/mcp!)
    if (
      expr.type === 'CallExpression' &&
      expr.callee.type === 'MemberExpression' &&
      expr.callee.property.name === 'map'
    ) {
      const items = generate(expr.callee.object).code;
      const fn = expr.arguments[0];
      if (fn && (fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression')) {
        const paramList = fn.params.map((p) => generate(p).code);
        const itemVar = paramList[0] || 'record';
        const keyExpr = `${itemVar}?.id ?? ${itemVar}?.slug ?? ${itemVar}?.key ?? ${itemVar}?.name ?? ${itemVar}`;
        const bodyNode =
          fn.body.type === 'BlockStatement'
            ? fn.body.body.find((s) => s.type === 'ReturnStatement')?.argument
            : fn.body;
        const body = bodyNode
          ? bodyNode.type === 'JSXElement' || bodyNode.type === 'JSXFragment'
            ? jsxNodeToSvelte(bodyNode, ctx)
            : `{${generate(bodyNode).code}}`
          : '';
        if (body) {
          return `\n{#each ${items} ?? [] as ${paramList.join(', ')} (${keyExpr})}\n  ${body.trim()}\n{/each}\n`;
        }
      }
    }
    return `{${generate(expr).code}}`;
  }
  if (node.type === 'JSXFragment') {
    return (node.children || []).map((c) => jsxNodeToSvelte(c, ctx)).join('');
  }
  if (node.type === 'JSXElement') {
    let tagName = '';
    const openTag = node.openingElement;
    if (openTag.name.type === 'JSXIdentifier') {
      tagName = openTag.name.name;
    } else if (openTag.name.type === 'JSXMemberExpression') {
      tagName = openTag.name.property.name; // motion.div -> div (motion props preserved via @attach animateMotion!)
    }

    const attrs = [];
    const motionOptionPairs = [];
    let staticImgSrc = null;
    let hasWidthAttr = false;
    let hasHeightAttr = false;

    for (const attr of openTag.attributes) {
      if (attr.type === 'JSXSpreadAttribute') {
        attrs.push(`{...${generate(attr.argument).code}}`);
        continue;
      }
      let attrName = attr.name.name;
      if (attrName === 'key' || attrName === 'exit') continue;

      // Preserve Framer Motion animation props via Svelte 5 {@attach animateMotion(...)}!
      if (MOTION_PROP_NAMES.has(attrName) && attr.value) {
        const valCode =
          attr.value.type === 'JSXExpressionContainer'
            ? generate(attr.value.expression).code
            : JSON.stringify(attr.value.value);
        motionOptionPairs.push(`${attrName}: ${valCode}`);
        continue;
      }

      if (attrName === 'aria-hidden' && tagName.toLowerCase() === 'a') {
        continue;
      }

      if (attrName === 'ref') {
        const refVal =
          attr.value && attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value;
        if (refVal) {
          const refCode = generate(refVal).code.replace(/\.current$/, '');
          attrs.push(`bind:this={${refCode}}`);
        }
        continue;
      }

      if (attrName === 'className') attrName = 'class';
      else if (attrName === 'htmlFor') attrName = 'for';
      else if (attrName === 'tabIndex') attrName = 'tabindex';
      else if (attrName === 'srcSet') attrName = 'srcset';
      else if (attrName === 'crossOrigin') attrName = 'crossorigin';
      else if (attrName === 'autoPlay') attrName = 'autoplay';
      else if (attrName === 'playsInline') attrName = 'playsinline';
      else if (SVG_KEBAB_MAP[attrName]) attrName = SVG_KEBAB_MAP[attrName];
      else if (attrName.startsWith('on') && attrName.length > 2 && attrName[2] === attrName[2].toUpperCase()) {
        attrName = attrName.toLowerCase();
      }

      if (attrName === 'width') hasWidthAttr = true;
      if (attrName === 'height') hasHeightAttr = true;

      if (!attr.value) {
        attrs.push(attrName);
        continue;
      }
      if (attr.value.type === 'StringLiteral') {
        if (attrName === 'src') staticImgSrc = attr.value.value;
        attrs.push(`${attrName}="${attr.value.value}"`);
      } else if (attr.value.type === 'JSXExpressionContainer') {
        const valExpr = attr.value.expression;
        if (attrName === 'style' && valExpr.type === 'ObjectExpression') {
          const styleParts = [];
          for (const prop of valExpr.properties) {
            if (prop.type === 'ObjectProperty') {
              const k = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
              const cssKey = String(k).startsWith('--')
                ? String(k)
                : String(k)
                  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
                  .toLowerCase();
              if (prop.value.type === 'StringLiteral') {
                styleParts.push(`${cssKey}: ${prop.value.value}`);
              } else if (prop.value.type === 'NumericLiteral') {
                const unit =
                  cssKey.startsWith('--') || ['z-index', 'opacity', 'flex', 'font-weight', 'line-height'].includes(cssKey)
                    ? ''
                    : 'px';
                styleParts.push(`${cssKey}: ${prop.value.value}${unit}`);
              } else {
                styleParts.push(`${cssKey}: {${generate(prop.value).code}}`);
              }
            }
          }
          attrs.push(`style="${styleParts.join('; ')};"`);
        } else if (valExpr.type === 'StringLiteral') {
          if (attrName === 'src') staticImgSrc = valExpr.value;
          attrs.push(`${attrName}="${valExpr.value}"`);
        } else {
          attrs.push(`${attrName}={${generate(valExpr).code}}`);
        }
      }
    }

    if (motionOptionPairs.length > 0) {
      ctx.usesMotion = true;
      attrs.push(`{@attach animateMotion({ ${motionOptionPairs.join(', ')} })}`);
    }

    if (tagName.toLowerCase() === 'img' && staticImgSrc && (!hasWidthAttr || !hasHeightAttr)) {
      const dim =
        ctx.imgDims?.[staticImgSrc] || ctx.imgDims?.[staticImgSrc.split('/').pop()?.split('?')[0] || ''];
      if (dim) {
        if (!hasWidthAttr) attrs.push(`width="${dim[0]}"`);
        if (!hasHeightAttr) attrs.push(`height="${dim[1]}"`);
      }
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    if (VOID_HTML_ELEMENTS.has(tagName.toLowerCase())) {
      return `<${tagName}${attrStr} />`;
    }
    const childrenStr = (node.children || []).map((c) => jsxNodeToSvelte(c, ctx)).join('');
    return `<${tagName}${attrStr}>${childrenStr}</${tagName}>`;
  }
  return '';
}

function isEarlyReturn(stmt) {
  if (stmt.type === 'ReturnStatement') return true;
  if (stmt.type === 'IfStatement') {
    const c = stmt.consequent;
    if (c.type === 'ReturnStatement') return true;
    if (c.type === 'BlockStatement' && c.body.length === 1 && c.body[0].type === 'ReturnStatement') return true;
  }
  return false;
}

export function convertJsxSourceToSvelte(code, options = {}) {
  let ast;
  try {
    ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch {
    return null;
  }

  const declarations = ast.program.body;
  const exported = declarations.find((entry) => entry.type === 'ExportDefaultDeclaration');
  let component = exported?.declaration;
  const lookup = component?.type === 'Identifier' ? component.name : options.name;
  if (!component || component.type === 'Identifier') {
    for (const entry of declarations) {
      const declaration = entry.declaration ?? entry;
      if (declaration.type === 'FunctionDeclaration' && declaration.id.name === lookup) component = declaration;
      if (declaration.type === 'VariableDeclaration') {
        const variable = declaration.declarations.find((d) => d.id.name === lookup);
        if (variable) component = variable.init;
      }
    }
  }
  if (!component || !['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'].includes(component.type)) return null;
  const propsParam = component.params[0];
  const body = component.body;
  const statements = body.type === 'BlockStatement' ? body.body : [];
  const returnNode = body.type === 'BlockStatement' ? statements.at(-1)?.argument : body;
  if (!returnNode || statements.slice(0, -1).some(isEarlyReturn)) return null;
  const scriptStatements = statements.slice(0, -1);
  const imports = [];
  for (const entry of declarations) {
    if (entry.type !== 'ImportDeclaration') continue;
    if (['react', 'framer-motion', 'motion/react'].includes(entry.source.value)) continue;
    if (options.resolveImport) entry.source.value = options.resolveImport(entry.source.value);
    imports.push(generate(entry).code);
  }
  const localStatements = declarations.flatMap((entry) => {
    const decl = entry.declaration ?? entry;
    if (entry.type === 'ImportDeclaration' || entry === exported || decl === component) return [];
    if (decl.type === 'VariableDeclaration' && decl.declarations.some((item) => item.init === component)) return [];
    if (['VariableDeclaration','FunctionDeclaration','TSTypeAliasDeclaration','TSInterfaceDeclaration'].includes(decl.type)) return [generate(decl).code];
    return [];
  });

  const propsFields = [];
  let propsDestructure = propsParam?.type === 'Identifier' ? propsParam.name : '{ children, class: className = "", ...restProps }';
  if (propsParam && propsParam.type === 'ObjectPattern') {
    const destructureItems = [];
    for (const prop of propsParam.properties) {
      if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') {
        const origKey = prop.key.name;
        if (origKey === 'children' || origKey === 'className') continue;
        const valName = prop.value.type === 'Identifier' ? prop.value.name : origKey;
        const isEvent = origKey.startsWith('on') && origKey.length > 2 && origKey[2] === origKey[2].toUpperCase();
        const isMappedArray = new RegExp(`\\b${valName}\\s*(?:\\?\\.|\\.)map\\(`).test(code);
        const typeStr = isEvent
          ? '((...args: any[]) => void)'
          : isMappedArray
            ? 'Array<Record<string, any>>'
            : 'any';
        propsFields.push(`    ${origKey}?: ${typeStr};`);
        destructureItems.push(origKey === valName ? origKey : `${origKey}: ${valName}`);
      }
    }
    destructureItems.push('children');
    destructureItems.push('class: className = ""');
    destructureItems.push('...restProps');
    propsDestructure = `{ ${destructureItems.join(', ')} }`;
  }

  const statementsCode = scriptStatements
    .map((stmt) => {
      let raw = generate(stmt).code;
      raw = raw.replace(
        /(?:const|let)\s+\[([a-zA-Z0-9_]+),\s*([a-zA-Z0-9_]+)\]\s*=\s*(?:[a-zA-Z0-9_]+\.)?useState\(([^)]*)\);?/g,
        (_, name, setter, initial) => `let ${name} = $state(${initial});\n  function ${setter}(${name}Update: typeof ${name} | ((${name}Before: typeof ${name}) => typeof ${name})) { ${name} = typeof ${name}Update === "function" ? ${name}Update(${name}) : ${name}Update; }`
      );
      raw = raw.replace(
        /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*(?:[a-zA-Z0-9_]+\.)?useRef\(([^)]*)\);?/g,
        'let $1 = $state<HTMLElement | null>($2);'
      );
      raw = raw.replace(
        /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*(?:[a-zA-Z0-9_]+\.)?useMemo\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[[^\]]*\]\);?/g,
        'const $1 = $derived.by(() => {$2});'
      );
      raw = raw.replace(
        /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*(?:[a-zA-Z0-9_]+\.)?useMemo\(\(\)\s*=>\s*([^,]+),\s*\[[^\]]*\]\);?/g,
        'const $1 = $derived($2);'
      );
      raw = raw.replace(
        /(?:[a-zA-Z0-9_]+\.)?useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\}(?:,\s*\[[^\]]*\])?\);?/g,
        '$effect(() => {$1});'
      );
      raw = raw.replace(
        /(?:const|let)\s+([a-zA-Z0-9_]+)\s*=\s*(?:[a-zA-Z0-9_]+\.)?useCallback\(([\s\S]*?),\s*\[[^\]]*\]\);?/g,
        'const $1 = $2;'
      );
      raw = raw.replace(/([a-zA-Z0-9_]+)\.current\b/g, '$1');
      return raw;
    })
    .join('\n  ');

  const ctx = { usesMotion: false, imgDims: options.imgDims || {} };
  const svelteMarkup = jsxNodeToSvelte(returnNode, ctx);
  const usesChildren = svelteMarkup.includes('{@render children?.()}');

  const scriptBlock = [
    '<script lang="ts">',
    ...imports,
    ...localStatements,
    usesChildren ? "  import type { Snippet } from 'svelte';" : null,
    ctx.usesMotion ? "  import { animateMotion } from '#lib/motion/motionAttachment.js';" : null,
    '',
    '  interface Props {',
    usesChildren ? '    children?: Snippet;' : null,
    ...propsFields,
    '    class?: string;',
    '    [key: string]: unknown;',
    '  }',
    '',
    `  let ${propsDestructure}: Props = $props();`,
    statementsCode ? `\n  ${statementsCode}\n` : null,
    '</script>',
    ''
  ]
    .filter((line) => line !== null)
    .join('\n');

  return `${scriptBlock}\n${svelteMarkup.trim()}\n`;
}

export function convertJsxFileToSvelte(srcPath, options = {}) {
  const code = fs.readFileSync(srcPath, 'utf8');
  return convertJsxSourceToSvelte(code, options);
}
