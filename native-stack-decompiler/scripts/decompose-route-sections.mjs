#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VOID_TAGS = new Set([
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

function toPascalCase(raw, fallback = 'PageSection') {
  const words = String(raw || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return fallback;
  const joined = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  return /^[A-Za-z]/.test(joined) ? joined : `${fallback}${joined}`;
}

/**
 * Extracts balanced top-level semantic blocks (<header>, <nav>, <main> children, <dialog>, <footer>)
 * from cleaned HTML so Server Component markup is deterministically decomposed into bite-sized
 * components (<350 lines) that even fast Flash models can convert with 0 dropped classes or SVGs.
 */
function extractBalancedTagBlocks(htmlBody) {
  const blocks = [];
  // Prefer decomposing inside <main> plus outer <header> / <footer> / <dialog>
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*?)?(\/?)>/g;
  const stack = [];
  let currentBlockStart = -1;
  let currentBlockTag = '';
  let currentOpenAttrs = '';

  let match;
  while ((match = tagRegex.exec(htmlBody)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || '';
    const selfClose = match[3] === '/' || VOID_TAGS.has(tagName);
    const isClosing = fullTag.startsWith('</');

    if (tagName === 'script' || tagName === 'style') continue;

    if (!isClosing) {
      if (selfClose) continue;
      // Track top-level landmarks or direct children of <main> / body wrapper
      const inMain = stack.length === 1 && stack[0] === 'main';
      const atTop = stack.length === 0 && ['header', 'nav', 'section', 'article', 'footer', 'dialog'].includes(tagName);

      if ((atTop || inMain) && currentBlockStart === -1) {
        currentBlockStart = match.index;
        currentBlockTag = tagName;
        currentOpenAttrs = attrs;
      }
      stack.push(tagName);
    } else {
      const lastIdx = stack.lastIndexOf(tagName);
      if (lastIdx !== -1) {
        stack.splice(lastIdx, 1);
      }
      const targetDepth = currentBlockStart !== -1 && stack[0] === 'main' && currentBlockTag !== 'main' ? 1 : 0;
      if (currentBlockStart !== -1 && stack.length === targetDepth && tagName === currentBlockTag) {
        const blockHtml = htmlBody.slice(currentBlockStart, match.index + fullTag.length);
        blocks.push({ tag: currentBlockTag, attrs: currentOpenAttrs, html: blockHtml });
        currentBlockStart = -1;
        currentBlockTag = '';
        currentOpenAttrs = '';
      }
    }
  }

  return blocks;
}

/**
 * Converts clean HTML snippet into valid JSX component source for Stage 1 / Stage 2 AST pre-conversion.
 */
function htmlBlockToJsxComponent(componentName, rawHtml) {
  let jsx = rawHtml
    // Normalize multi-line closing tags emitted by strict HTML formatters (</section\n  > -> </section>)
    .replace(/<\/([a-zA-Z][a-zA-Z0-9-]*)\s+>/g, '</$1>')
    // Strip HTML comments -> JSX comments
    .replace(/<!--([\s\S]*?)-->/g, '')
    // Close void HTML tags for strict JSX validity
    .replace(/<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)(?<!\/)>/gi, '<$1$2 />')
    // Escape bare { and } inside text/JSON attributes so JSX parser never trips
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    // Standard HTML -> JSX attribute mappings
    .replace(/\bclass=/g, 'className=')
    .replace(/\bfor=/g, 'htmlFor=')
    .replace(/\btabindex=/gi, 'tabIndex=')
    .replace(/\bsrcset=/gi, 'srcSet=')
    .replace(/\bcrossorigin=/gi, 'crossOrigin=')
    .replace(/\bautoplay(?=\s|=|\/|>)/gi, 'autoPlay')
    .replace(/\bplaysinline(?=\s|=|\/|>)/gi, 'playsInline')
    .replace(/\bstroke-width=/g, 'strokeWidth=')
    .replace(/\bstroke-linecap=/g, 'strokeLinecap=')
    .replace(/\bstroke-linejoin=/g, 'strokeLinejoin=')
    .replace(/\bstroke-dasharray=/g, 'strokeDasharray=')
    .replace(/\bstroke-dashoffset=/g, 'strokeDashoffset=')
    .replace(/\bfill-rule=/g, 'fillRule=')
    .replace(/\bclip-rule=/g, 'clipRule=')
    .replace(/\bclip-path=/g, 'clipPath=');

  // Strip inline style="..." strings (rarely valid in raw JSX without object conversion) -> keep via data-inline-style or convert simple declarations
  jsx = jsx.replace(/\bstyle="([^"]*)"/g, (_, styleText) => {
    const objEntries = [];
    for (const part of styleText.split(';')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const rawProp = part.slice(0, colon).trim();
      const rawVal = part.slice(colon + 1).trim();
      if (!rawProp || !rawVal) continue;
      const key = rawProp.startsWith('--')
        ? JSON.stringify(rawProp)
        : rawProp.replace(/-([a-z])/g, (__, ch) => ch.toUpperCase());
      objEntries.push(`${key}: ${JSON.stringify(rawVal)}`);
    }
    return objEntries.length > 0 ? `style={{ ${objEntries.join(', ')} }}` : '';
  });

  return `export function ${componentName}() {\n  return (\n    ${jsx.trim()}\n  );\n}\n`;
}

export function decomposeRouteSections(nativeDir) {
  const routeSectionMap = {};
  const sectionsRoot = path.join(nativeDir, 'src', 'sections');

  function walkRouteHtml(dir) {
    const found = [];
    if (!fs.existsSync(dir)) return found;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'src', 'forensics', '__api_fixtures__', '__external'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...walkRouteHtml(full));
      else if (entry.isFile() && entry.name === 'index.html') found.push(full);
    }
    return found;
  }

  const htmlFiles = walkRouteHtml(nativeDir);
  let totalGeneratedSections = 0;

  for (const htmlFile of htmlFiles) {
    const relDir = path.relative(nativeDir, path.dirname(htmlFile)).replace(/\\/g, '/');
    const route = relDir === '' || relDir === '.' ? '/' : `/${relDir}`;
    const routeSlug = route === '/' ? 'home' : route.slice(1).replace(/[^a-zA-Z0-9]+/g, '-');

    const fullHtml = fs.readFileSync(htmlFile, 'utf8');
    const bodyMatch = fullHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i);
    if (!bodyMatch) continue;

    const blocks = extractBalancedTagBlocks(bodyMatch[1]);
    if (blocks.length === 0) continue;

    const outRouteDir = path.join(sectionsRoot, routeSlug);
    fs.mkdirSync(outRouteDir, { recursive: true });

    const usedNames = new Set();
    const sectionEntries = [];

    blocks.forEach((blk, idx) => {
      const idMatch = blk.attrs.match(/\bid=["']([^"']+)["']/i);
      const ariaMatch = blk.attrs.match(/\baria-label=["']([^"']+)["']/i);
      const headingMatch = blk.html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
      const headingText = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : '';

      const rawLabel = idMatch?.[1] || ariaMatch?.[1] || headingText || `${blk.tag}Block${idx + 1}`;
      let compName = toPascalCase(rawLabel, `Section${idx + 1}`);
      if (!compName.endsWith('Section') && !compName.endsWith('Header') && !compName.endsWith('Footer') && !compName.endsWith('Nav')) {
        compName += blk.tag === 'header' ? 'Header' : blk.tag === 'footer' ? 'Footer' : 'Section';
      }
      if (usedNames.has(compName)) compName = `${compName}${idx + 1}`;
      usedNames.add(compName);

      // Respect 1,400-line file cap
      const jsxSource = htmlBlockToJsxComponent(compName, blk.html);
      if (jsxSource.split('\n').length <= 1400) {
        const relFile = `src/sections/${routeSlug}/${compName}.jsx`;
        fs.writeFileSync(path.join(nativeDir, relFile), jsxSource, 'utf8');
        sectionEntries.push({
          order: idx + 1,
          tag: blk.tag,
          componentName: compName,
          sourcePath: relFile
        });
        totalGeneratedSections++;
      }
    });

    routeSectionMap[route] = {
      route,
      routeSlug,
      sections: sectionEntries
    };
  }

  const mapOutPath = path.join(nativeDir, 'forensics', 'route-section-map.json');
  fs.mkdirSync(path.dirname(mapOutPath), { recursive: true });
  fs.writeFileSync(mapOutPath, JSON.stringify(routeSectionMap, null, 2), 'utf8');

  return { routeCount: Object.keys(routeSectionMap).length, totalGeneratedSections };
}
