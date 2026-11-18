#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';
import { parse } from '@babel/parser';
import { extractCdpForensics } from './extract-cdp-forensics.mjs';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};
const hasFlag = (flag) => args.includes(flag);

const targetUrlStr = getArg('--url', process.env.TARGET_URL);
if (!targetUrlStr) {
  console.error(
    'Usage: node capture-mirror.mjs --url <URL> [--routes /route1,/route2] [--out-dir ./00-mirror] [--max-routes N] [--single-route] [--skip-cdp-forensics]'
  );
  process.exit(1);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const targetBaseUrl = new URL(targetUrlStr);
const targetHost = targetBaseUrl.hostname.replace(/^www\./, '');
const targetOrigin = targetBaseUrl.origin;

const OUT_DIR = path.resolve(getArg('--out-dir', './00-mirror'));
const SOURCEMAPS_DIR = path.join(OUT_DIR, '__sourcemaps__');
const routesArg = getArg('--routes', '');
const routesFile = getArg('--routes-file', '');
let specifiedRoutes = [];
if (routesFile && fs.existsSync(routesFile)) {
  const content = fs.readFileSync(routesFile, 'utf8').trim();
  specifiedRoutes = content.startsWith('[')
    ? JSON.parse(content)
    : content.split('\n').map((r) => r.trim()).filter(Boolean);
} else if (routesArg) {
  specifiedRoutes = routesArg.split(',').map((r) => r.trim()).filter(Boolean);
} else {
  specifiedRoutes = [targetBaseUrl.pathname + targetBaseUrl.search];
}

// Auto-discover internal routes by default unless explicitly restricted
const discoverRoutes =
  !hasFlag('--single-route') && !hasFlag('--no-discover-routes') && !routesArg && !routesFile
    ? true
    : hasFlag('--discover-routes');
const maxRoutes = Number(getArg('--max-routes', 'Infinity'));
if (maxRoutes !== Infinity && (!Number.isInteger(maxRoutes) || maxRoutes < 1)) throw new Error('Invalid --max-routes');
const skipCdpForensics = hasFlag('--skip-cdp-forensics');

console.log(`🌐 Target: ${targetBaseUrl.href}`);
console.log(`📁 Output Directory: ${OUT_DIR}`);
console.log(`🗺️ Initial Routes:`, specifiedRoutes, `(Auto-Discover: ${discoverRoutes}, Max: ${maxRoutes})`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, '__api_fixtures__'), { recursive: true });
fs.mkdirSync(SOURCEMAPS_DIR, { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'forensics'), { recursive: true });

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Third-party telemetry blacklist
const TELEMETRY_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'clarity.ms',
  'hotjar.com',
  'umami.is',
  'segment.io',
  'cookiebot.com',
  'consentcdn.cookiebot.com',
  'analytics.',
  'telemetry.',
  'metrics.',
  'hm.baidu.com',
  'hmcdn.baidu.com',
  'baidu.com',
  'wcs.naver.com',
  'wcs.pstatic.net',
  'nam.veta.naver.com',
  'sogou.com',
  'sogou_site_verification'
];

function isTracker(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.pathname.includes('/b/ss/')) return true;
    return TELEMETRY_HOSTS.some((t) => u.hostname.includes(t));
  } catch {
    return false;
  }
}

// Strict Binary Magic-Byte Validator
export function validateMagicBytes(buf, expectedExt) {
  if (!buf || buf.length < 4) return false;
  const headAscii = buf.toString('ascii', 0, Math.min(buf.length, 96)).toLowerCase();
  if (
    expectedExt !== '.html' &&
    (headAscii.startsWith('<!doctype') || headAscii.startsWith('<html') || headAscii.startsWith('{"error"'))
  ) {
    return false;
  }

  const ext = expectedExt.toLowerCase();
  if (ext === '.woff2') return buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x32;
  if (ext === '.woff') return buf[0] === 0x77 && buf[1] === 0x4f && buf[2] === 0x46 && buf[3] === 0x46;
  if (ext === '.wasm') return buf[0] === 0x00 && buf[1] === 0x61 && buf[2] === 0x73 && buf[3] === 0x6d;

  const isImageExt = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(ext);
  if (isImageExt) {
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isGif = buf.toString('ascii', 0, 3) === 'GIF';
    const isWebp = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
    const isAvif =
      buf.length >= 12 &&
      buf.toString('ascii', 4, 8) === 'ftyp' &&
      ['avif', 'avis', 'mif1'].includes(buf.toString('ascii', 8, 12));
    const isSvg = headAscii.includes('<svg') || headAscii.includes('<?xml');
    const isIco = buf[0] === 0x00 && buf[1] === 0x00 && (buf[2] === 0x01 || buf[2] === 0x02) && buf[3] === 0x00;
    return isJpeg || isPng || isGif || isWebp || isAvif || isSvg || isIco;
  }

  if (ext === '.webm') return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  if (ext === '.drc') return buf.toString('ascii', 0, 5) === 'DRACO';
  if (ext === '.ogg' || ext === '.ogv') return buf.toString('ascii', 0, 4) === 'OggS';
  if (ext === '.ktx2') return buf[0] === 0xab && buf[1] === 0x4b && buf[2] === 0x54 && buf[3] === 0x58;
  if (ext === '.glb') return buf.toString('ascii', 0, 4) === 'glTF';
  if (ext === '.mp4' || ext === '.mov' || ext === '.m4v' || ext === '.m4s') {
    if (buf.length < 12) return false;
    const box = buf.toString('ascii', 4, 8);
    return ['ftyp', 'styp', 'moof', 'moov', 'mdat', 'wide', 'free'].includes(box);
  }
  if (ext === '.ts') {
    return buf[0] === 0x47 || (buf.length >= 8 && ['ftyp', 'styp', 'moof'].includes(buf.toString('ascii', 4, 8)));
  }
  if (ext === '.m3u8') {
    return buf.toString('utf8', 0, 16).trimStart().startsWith('#EXTM3U');
  }
  if (ext === '.ttf' || ext === '.otf') {
    const sig = buf.toString('ascii', 0, 4);
    return (
      (buf[0] === 0x00 && buf[1] === 0x01 && buf[2] === 0x00 && buf[3] === 0x00) ||
      sig === 'true' ||
      sig === 'OTTO'
    );
  }
  return true;
}

// Intrinsic Image Dimension Extractor (PNG, JPEG, WEBP, AVIF, SVG)
export function getImageDimensions(buf) {
  if (!buf || buf.length < 8) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset < buf.length - 8) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      const len = buf.readUInt16BE(offset + 2);
      if (len < 2) break;
      offset += 2 + len;
    }
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b1 = buf[21], b2 = buf[22], b3 = buf[23], b4 = buf[24];
      return {
        width: 1 + (((b2 & 0x3f) << 8) | b1),
        height: 1 + (((b4 & 0xf) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6))
      };
    }
  }
  if (buf.length >= 32 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const ispeIdx = buf.indexOf(Buffer.from('ispe', 'ascii'));
    if (ispeIdx !== -1 && ispeIdx + 16 <= buf.length) {
      const width = buf.readUInt32BE(ispeIdx + 8);
      const height = buf.readUInt32BE(ispeIdx + 12);
      if (width > 0 && width < 32768 && height > 0 && height < 32768) {
        return { width, height };
      }
    }
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 2048));
  if (head.includes('<svg')) {
    const vb = head.match(/viewBox=["']\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
    if (vb) return { width: Math.round(parseFloat(vb[3])), height: Math.round(parseFloat(vb[4])) };
    const w = head.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i);
    const h = head.match(/\bheight=["']([0-9.]+)(?:px)?["']/i);
    if (w && h) return { width: Math.round(parseFloat(w[1])), height: Math.round(parseFloat(h[1])) };
  }
  return null;
}

function getLocalPathForUrl(urlStr, contentType = '') {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '');
    let cleanPath = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    if (!cleanPath) cleanPath = 'index.html';
    if (contentType.includes('text/css') && !path.extname(cleanPath)) {
      cleanPath = path.join(cleanPath, 'index.css');
    }
    if (cleanPath.split(/[\\/]/).some((part) => part === '..') || cleanPath.includes('\0')) return null;
    if (u.search) {
      const ext = path.extname(cleanPath);
      cleanPath = cleanPath.slice(0, cleanPath.length - ext.length) + '~' + sha256(u.search) + ext;
    }
    if (host === targetHost && u.port === targetBaseUrl.port) {
      return cleanPath;
    }
    return path.join('__external', u.host, cleanPath);
  } catch {
    return null;
  }
}

function writeAssetSafely(outPath, buf) {
  const relToOut = path.relative(OUT_DIR, outPath);
  const parts = relToOut.split(path.sep);
  let current = OUT_DIR;
  for (let i = 0; i < parts.length - 1; i++) {
    current = path.join(current, parts[i]);
    if (fs.existsSync(current) && fs.statSync(current).isFile()) {
      const tmpBuf = fs.readFileSync(current);
      fs.unlinkSync(current);
      fs.mkdirSync(current, { recursive: true });
      fs.writeFileSync(path.join(current, 'index.css'), tmpBuf);
    }
  }
  if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
    outPath = path.join(outPath, 'index.css');
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return outPath;
}

async function probeAndHarvestSourceMap(urlStr, headers, bodyBuf) {
  const pathname = new URL(urlStr).pathname;
  let ref = headers['sourcemap'] || headers['x-sourcemap'];
  if (!ref && /\.(?:[cm]?js|css)$/i.test(pathname)) {
    const refs = Array.from(bodyBuf.toString('utf8').matchAll(/(?:\/\/[#@]\s*sourceMappingURL=([^\s'"]+)|\/\*#\s*sourceMappingURL=([^\s*]+)\s*\*\/)/g));
    const last = refs.at(-1);
    ref = last?.[1] || last?.[2];
  }
  if (!ref) return;
  const inline = /^data:/i.test(ref);
  const mapUrl = inline ? urlStr : new URL(ref, urlStr).href;
  try {
    let bytes;
    if (inline) {
      const comma = ref.indexOf(',');
      if (comma < 0) throw new Error('Malformed inline source map');
      const data = decodeURIComponent(ref.slice(comma + 1));
      bytes = Buffer.from(data, /;base64(?:;|$)/i.test(ref.slice(0, comma)) ? 'base64' : 'utf8');
    } else {
      if (!/^https?:/.test(mapUrl)) throw new Error('Unsupported map URL scheme');
      const response = await fetch(mapUrl, {headers: {'User-Agent': USER_AGENT}});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (parsed.version !== 3 || !(Array.isArray(parsed.sources) || Array.isArray(parsed.sections))) throw new Error('Invalid v3 source map');
    const digest = sha256(bytes);
    const file = '__sourcemaps__/' + digest + '.map';
    fs.writeFileSync(path.join(OUT_DIR, file), bytes);
    sourceMaps.set(urlStr, {scriptUrl: urlStr, mapUrl, inline, file, sha256: digest, firstParty: new URL(urlStr).hostname.replace(/^www\./, '') === targetHost});
  } catch (error) {
    mapFailures.set(urlStr, {scriptUrl: urlStr, mapUrl, reason: error.message});
  }

}

const sourceMaps = new Map();
const mapFailures = new Map();
const savedAssets = new Map();
const capturedCssFiles = new Map();
const capturedJsFiles = new Map();
const pendingFullMediaUrls = new Set();
const discoveredM3u8Urls = new Set();
const apiFixtures = [];
const discoveredRoutes = new Set(specifiedRoutes);
const stackClassification = {};
const routeMetadata = [];

function recordAsset(url, replayFile, raw, contentType, replayBytes = raw) {
  const relPath = path.relative(OUT_DIR, replayFile);
  const digest = sha256(raw);
  // CSS may be localized after download. Keep that evidence before any pass mutates it.
  const keepOriginal = contentType.includes('text/css') || relPath.endsWith('.css') || !replayBytes.equals(raw);
  let rawFile = relPath;
  if (keepOriginal) {
    rawFile = 'forensics/raw-assets/' + digest;
    const absolute = path.join(OUT_DIR, rawFile);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, raw);
  }
  savedAssets.set(url, {relPath, size: replayBytes.length, rawFile, sha256: digest, contentType});
}

async function downloadFullAsset(urlStr) {
  urlStr = urlStr.split('#', 1)[0];
  if (savedAssets.has(urlStr)) return true;
  if (isTracker(urlStr)) return false;
  try {
    const res = await fetch(urlStr, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || res.status !== 200) return false;
    const contentType = res.headers.get('content-type') || '';
    const relPath = getLocalPathForUrl(urlStr, contentType);
    if (!relPath) return false;
    const ext = path.extname(relPath).toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf || buf.length === 0) return false;
    if (!validateMagicBytes(buf, ext)) return false;

    const finalPath = writeAssetSafely(path.join(OUT_DIR, relPath), buf);
    const parsedU = new URL(urlStr);
    if (!parsedU.search && parsedU.pathname !== decodeURIComponent(parsedU.pathname)) {
      const rawClean = parsedU.pathname.replace(/^\/+/, '');
      const rawRel =
        parsedU.hostname.replace(/^www\./, '') === targetHost
          ? rawClean
          : path.join('__external', parsedU.hostname, rawClean);
      if (rawRel !== relPath) {
        writeAssetSafely(path.join(OUT_DIR, rawRel), buf);
      }
    }

    recordAsset(urlStr, finalPath, buf, contentType);
    if (ext === '.css' || contentType.includes('text/css')) {
      capturedCssFiles.set(finalPath, urlStr);
    }
    if (ext === '.js' || ext === '.mjs') capturedJsFiles.set(finalPath, urlStr);
    if (/\.(?:[cm]?js|css)$/.test(ext)) {
      await probeAndHarvestSourceMap(urlStr, Object.fromEntries(res.headers.entries()), buf);
    }
    return true;
  } catch {
    return false;
  }
}

// Use the deployed module URL as the base for literal ESM imports and import.meta.url assets.
function moduleReferences(code, moduleUrl) {
  const refs = new Set();
  if (!/\b(?:import|export)\b/.test(code)) return refs;
  let ast;
  try {
    ast = parse(code, {sourceType: 'unambiguous', createImportExpressions: true});
  } catch {
    return refs;
  }
  const queue = [ast.program];
  while (queue.length) {
    const node = queue.pop();
    let source;
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(node.type)) {
      source = node.source;
    } else if (node.type === 'NewExpression' && node.callee?.name === 'URL') {
      const base = node.arguments[1];
      if (base?.type === 'MemberExpression' && base.property?.name === 'url' &&
          base.object?.type === 'MetaProperty' && base.object.meta?.name === 'import') {
        source = node.arguments[0];
      }
    }
    if (source?.type === 'StringLiteral' && (node.type === 'NewExpression' || /^(?:\.{1,2}\/|\/|https?:\/\/)/.test(source.value))) {
      const resolved = new URL(source.value, moduleUrl);
      resolved.hash = '';
      if (/^https?:$/.test(resolved.protocol)) refs.add(resolved.href);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        for (const member of child) if (member?.type) queue.push(member);
      } else if (child?.type) {
        queue.push(child);
      }
    }
  }
  return refs;
}

async function harvestDynamicBundlerChunks() {
  const visitedJs = new Set();
  let pass = 0;

  while (true) {
    pass++;
    let newlyDownloaded = 0;
    const entries = Array.from(capturedJsFiles.entries());

    for (const [jsPath, originalUrl] of entries) {
      if (visitedJs.has(jsPath) || !fs.existsSync(jsPath)) continue;
      visitedJs.add(jsPath);

      const code = fs.readFileSync(jsPath, 'utf8');
      const chunkCandidates = moduleReferences(code, originalUrl);

      const explicitRegex =
        /["'`](\/(?:_next\/static\/(?:immutable\/)?chunks|_next\/static\/css|_astro|_nuxt|assets)\/[a-zA-Z0-9._/-]+\.(?:js|mjs|css|wasm))["'`]/g;
      for (const m of code.matchAll(explicitRegex)) {
        chunkCandidates.add(new URL(m[1], originalUrl).href);
      }

      const relNextRegex = /["'`](static\/(?:immutable\/)?chunks\/[a-zA-Z0-9._/-]+\.(?:js|css))["'`]/g;
      for (const m of code.matchAll(relNextRegex)) {
        chunkCandidates.add(new URL(`/_next/${m[1]}`, targetOrigin).href);
      }

      const dynImportRegex = /import\(\s*["'](\.\/[a-zA-Z0-9._/-]+\.(?:js|mjs))["']\s*\)/g;
      for (const m of code.matchAll(dynImportRegex)) {
        chunkCandidates.add(new URL(m[1], originalUrl).href);
      }

      for (const m of code.matchAll(/https?:\/\/[^\s"'`<>\\]+\.m3u8(?:\?[^\s"'`<>\\]*)?/gi)) {
        discoveredM3u8Urls.add(m[0]);
      }
      for (const m of code.matchAll(/playbackId\s*:\s*["']([a-zA-Z0-9]{15,64})["']/g)) {
        discoveredM3u8Urls.add(`https://stream.mux.com/${m[1]}.m3u8`);
        await downloadFullAsset(`https://image.mux.com/${m[1]}/thumbnail.webp`);
      }

      for (const chunkUrl of chunkCandidates) {
        if (!savedAssets.has(chunkUrl)) {
          const ok = await downloadFullAsset(chunkUrl);
          if (ok) newlyDownloaded++;
        }
      }
    }

    if (newlyDownloaded === 0) break;
    console.log(`  🧩 Bundler Chunk Crawl Pass #${pass}: Downloaded ${newlyDownloaded} dynamic chunk(s).`);
  }
}

async function mirrorHlsPlaylistTree(playlistUrl, visitedPlaylists = new Set()) {
  if (visitedPlaylists.has(playlistUrl) || isTracker(playlistUrl)) return;
  visitedPlaylists.add(playlistUrl);

  try {
    const res = await fetch(playlistUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || res.status !== 200) return;
    const rawText = await res.text();
    if (!rawText.trimStart().startsWith('#EXTM3U')) return;

    const lines = rawText.split(/\r?\n/);
    const rewrittenLines = [];
    const childPlaylists = [];
    const segmentUrls = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        rewrittenLines.push(line);
        continue;
      }

      if (trimmed.startsWith('#')) {
        const rewrittenTag = line.replace(/URI="([^"]+)"/g, (full, uriVal) => {
          try {
            const resolved = new URL(uriVal, playlistUrl);
            const localRel = getLocalPathForUrl(resolved.href);
            if (!localRel) return full;
            if (resolved.pathname.endsWith('.m3u8')) {
              childPlaylists.push(resolved.href);
            } else {
              segmentUrls.push(resolved.href);
            }
            return `URI="/${localRel.replace(/\\/g, '/')}"`;
          } catch {
            return full;
          }
        });
        rewrittenLines.push(rewrittenTag);
        continue;
      }

      try {
        const resolved = new URL(trimmed, playlistUrl);
        const localRel = getLocalPathForUrl(resolved.href);
        if (localRel) {
          if (resolved.pathname.endsWith('.m3u8')) {
            childPlaylists.push(resolved.href);
          } else {
            segmentUrls.push(resolved.href);
          }
          rewrittenLines.push(`/${localRel.replace(/\\/g, '/')}`);
        } else {
          rewrittenLines.push(line);
        }
      } catch {
        rewrittenLines.push(line);
      }
    }

    const localPlaylistRel = getLocalPathForUrl(playlistUrl);
    if (localPlaylistRel) {
      const outPath = writeAssetSafely(
        path.join(OUT_DIR, localPlaylistRel),
        Buffer.from(rewrittenLines.join('\n'), 'utf8')
      );
      recordAsset(playlistUrl, outPath, Buffer.from(rawText), 'application/vnd.apple.mpegurl', Buffer.from(rewrittenLines.join('\n')));

    }

    const CONCURRENCY = 8;
    for (let i = 0; i < segmentUrls.length; i += CONCURRENCY) {
      const slice = segmentUrls.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map((segUrl) => downloadFullAsset(segUrl)));
    }

    for (const childUrl of childPlaylists) {
      await mirrorHlsPlaylistTree(childUrl, visitedPlaylists);
    }

    console.log(
      `  🎞️ Mirrored HLS Playlist: ${new URL(playlistUrl).pathname} (${childPlaylists.length} variants, ${segmentUrls.length} segments)`
    );
  } catch { }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: USER_AGENT,
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();

  const pendingResponses = new Set();
  const captureResponse = async (response) => {
    try {
      const urlStr = response.url();
      if (!urlStr.startsWith('http') || isTracker(urlStr)) return;

      const status = response.status();
      if (status !== 200 && status !== 206) return;

      const u = new URL(urlStr);
      const isRSC = u.searchParams.has('_rsc') || response.headers()['content-type']?.includes('text/x-component');
      const contentType = response.headers()['content-type'] || '';

      if (u.pathname.endsWith('.m3u8') || contentType.includes('mpegurl')) {
        discoveredM3u8Urls.add(urlStr);
        return;
      }

      if (response.request().method() !== 'GET' || response.request().resourceType() === 'document') return;

      if (isRSC || contentType.includes('application/json')) {
        const bodyBuf = await response.body().catch(() => null);
        if (bodyBuf && bodyBuf.length > 0) {
          const fixtureKey = `${u.pathname}${u.search}`;
          const safeFileName = sha256(urlStr) + (isRSC ? '.rsc' : '.json');
          const fixturePath = path.join(OUT_DIR, '__api_fixtures__', safeFileName);
          fs.writeFileSync(fixturePath, bodyBuf);
          apiFixtures.push({
            url: urlStr,
            fixtureKey,
            isRSC,
            file: path.relative(OUT_DIR, fixturePath),
            size: bodyBuf.length
          });

          const textPayload = bodyBuf.toString('utf8');
          for (const m of textPayload.matchAll(/https?:\/\/[^\s"'`<>\\]+\.m3u8(?:\?[^\s"'`<>\\]*)?/gi)) {
            discoveredM3u8Urls.add(m[0]);
          }
          for (const m of textPayload.matchAll(/"playbackId"\s*:\s*"([a-zA-Z0-9]{15,64})"/g)) {
            discoveredM3u8Urls.add(`https://stream.mux.com/${m[1]}.m3u8`);
          }
          return;
        }
      }

      const relPath = getLocalPathForUrl(urlStr, contentType);
      if (!relPath) return;

      const ext = path.extname(relPath).toLowerCase();

      if (status === 206 || ['.mp4', '.webm', '.mov', '.m4v', '.mp3', '.wav'].includes(ext)) {
        pendingFullMediaUrls.add(urlStr);
        return;
      }

      const bodyBuf = await response.body().catch(() => null);
      if (!bodyBuf || bodyBuf.length === 0) return;

      if (!validateMagicBytes(bodyBuf, ext)) {
        console.warn(`⚠️ Magic-byte validation failed for ${urlStr} (expected ${ext}). Skipping.`);
        return;
      }

      let finalBuf = bodyBuf;
      if (u.pathname.startsWith('/metrics/') && u.pathname.endsWith('/auto-init.js')) {
        finalBuf = Buffer.from('/* metrics auto-init disabled for air-gapped parity */\n', 'utf8');
      }

      const outPath = writeAssetSafely(path.join(OUT_DIR, relPath), finalBuf);
      recordAsset(urlStr, outPath, bodyBuf, contentType, finalBuf);

      if (ext === '.css' || contentType.includes('text/css')) {
        capturedCssFiles.set(outPath, urlStr);
      }
      if (ext === '.js' || ext === '.mjs') {
        capturedJsFiles.set(outPath, urlStr);
      }
      if (/\.(?:[cm]?js|css)$/.test(ext)) {
        await probeAndHarvestSourceMap(urlStr, response.headers(), finalBuf);
      }
    } catch (error) {
      console.warn('Could not capture response:', response.url(), error.message);
    }
  };
  context.on('response', (response) => {
    const work = captureResponse(response).finally(() => pendingResponses.delete(work));
    pendingResponses.add(work);
  });

  const viewports = [
    { width: 1440, height: 900, name: 'desktop' },
    { width: 768, height: 1024, name: 'tablet' },
    { width: 390, height: 844, name: 'mobile', isMobile: true, hasTouch: true }
  ];

  const processedRoutes = new Set();
  while (processedRoutes.size < discoveredRoutes.size && processedRoutes.size < maxRoutes) {
    const route = Array.from(discoveredRoutes).find((r) => !processedRoutes.has(r));
    if (!route) break;
    processedRoutes.add(route);

    const fullUrl = new URL(route, targetOrigin).href;
    console.log(
      `\n🔍 Capturing Route [${processedRoutes.size}/${Math.min(discoveredRoutes.size, maxRoutes)}]: ${route} (${fullUrl})`
    );

    const ssrRes = await fetch(fullUrl, { headers: { 'User-Agent': USER_AGENT } }).catch(() => null);
    if (!ssrRes || ssrRes.status >= 400) {
      console.warn(`  ⚠️ Skipping route ${route}: HTTP ${ssrRes?.status ?? 'ERR'}`);
      continue;
    }
    const rawBytes = Buffer.from(await ssrRes.arrayBuffer());
    const rawSha256 = sha256(rawBytes);
    const rawDocument = 'forensics/raw-documents/' + rawSha256 + '.html';
    fs.mkdirSync(path.dirname(path.join(OUT_DIR, rawDocument)), {recursive:true});
    fs.writeFileSync(path.join(OUT_DIR, rawDocument), rawBytes);
    let ssrHtml = rawBytes.toString('utf8');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1800);

    const fingerprint = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const hasNext =
        !!window.__NEXT_DATA__ || !!document.querySelector('script[src*="/_next/"]') || html.includes('self.__next_f');
      const hasReact =
        !!window.React ||
        !!document.querySelector('[data-reactroot]') ||
        !!Object.keys(window).find((k) => k.startsWith('__react'));
      const hasVue = !!window.Vue || !!document.querySelector('[data-v-]');
      const hasAstro = !!document.querySelector('astro-island');
      const hasAppleRuntime =
        !!document.querySelector('[data-component-list]') ||
        !!document.querySelector('[data-anim-scroll-group]') ||
        html.includes('BubbleGum');
      const hasCustomEngine =
        hasAppleRuntime ||
        !!window.THREE ||
        !!window.gsap ||
        !!window.ScrollTrigger ||
        !!document.querySelector('[data-video-basepath]');

      let mode = 'B';
      let reason = 'Static HTML / Brochure';

      if (hasNext || hasReact || hasVue || hasAstro) {
        mode = 'A';
        reason = hasNext
          ? 'Next.js Turbopack/Webpack VDOM'
          : hasReact
            ? 'React VDOM'
            : hasVue
              ? 'Vue/Nuxt'
              : 'Astro Island';
      } else if (hasCustomEngine) {
        mode = 'C';
        reason = hasAppleRuntime
          ? 'Apple BubbleGum / Scrollytelling Custom Runtime'
          : 'Custom WebGL / Canvas / Scrollytelling Engine';
      }

      const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) =>
        l.getAttribute('href')
      );

      return {
        mode,
        reason,
        title: document.title || '',
        stylesheets: stylesheets.filter(Boolean),
        hasNext,
        hasReact,
        hasVue,
        hasAstro,
        hasAppleRuntime,
        hasCustomEngine
      };
    });

    stackClassification[route] = fingerprint;
    routeMetadata.push({
      route,
      rawDocument, rawSha256,
      title: fingerprint.title,
      mode: fingerprint.mode,
      stylesheets: fingerprint.stylesheets
    });
    console.log(`  🧬 Stack Fingerprint for ${route}: Mode ${fingerprint.mode} (${fingerprint.reason})`);

    const domCandidates = await page.evaluate(() => {
      const urls = new Set();
      const basepaths = new Set();
      const hlsUrls = new Set();

      for (const el of document.querySelectorAll('*')) {
        for (const attr of el.attributes) {
          const val = attr.value.trim();
          if (!val) continue;

          if (val.includes('.m3u8')) hlsUrls.add(val);
          if (attr.name === 'data-mux-playback-id') {
            hlsUrls.add(`https://stream.mux.com/${val}.m3u8`);
          }

          if (
            (attr.name.includes('basepath') || attr.name.includes('media-base') || attr.name.endsWith('-vat')) &&
            (val.startsWith('/') || val.startsWith('http'))
          ) {
            basepaths.add(val.endsWith('/') ? val : val + '/');
          }

          if (
            attr.name.includes('src') ||
            attr.name.includes('url') ||
            attr.name.includes('poster') ||
            attr.name.includes('lottie') ||
            attr.name.includes('image') ||
            attr.name.includes('startframe')
          ) {
            if (val.startsWith('http') || val.startsWith('/')) {
              urls.add(val);
            }
          }

          if (attr.name.toLowerCase() === 'srcset') {
            const parts = val.split(',').map((p) => p.trim().split(/\s+/)[0]);
            parts.forEach((p) => {
              if (p) urls.add(p);
            });
          }
        }
      }
      return { urls: Array.from(urls), basepaths: Array.from(basepaths), hlsUrls: Array.from(hlsUrls) };
    });

    const allUrls = new Set(domCandidates.urls);
    const allBasepaths = new Set(domCandidates.basepaths);
    for (const h of domCandidates.hlsUrls) {
      discoveredM3u8Urls.add(new URL(h, targetOrigin).href);
    }

    for (const m of ssrHtml.matchAll(/https?:\/\/[^\s"'`<>\\]+\.m3u8(?:\?[^\s"'`<>\\]*)?/gi)) {
      discoveredM3u8Urls.add(m[0]);
    }
    for (const m of ssrHtml.matchAll(/\\?"playbackId\\?"\s*:\s*\\?"([a-zA-Z0-9]{15,64})\\?"/g)) {
      discoveredM3u8Urls.add(`https://stream.mux.com/${m[1]}.m3u8`);
      allUrls.add(`https://image.mux.com/${m[1]}/thumbnail.webp`);
    }

    for (const m of ssrHtml.matchAll(/(?:data-[a-z0-9-]+|src|poster)=["']([^"']+)["']/gi)) {
      const fullAttr = m[0];
      const val = m[1].trim();
      if (!val) continue;
      if (
        (fullAttr.includes('basepath') || fullAttr.includes('media-base') || fullAttr.includes('holiday-vat')) &&
        (val.startsWith('/') || val.startsWith('http'))
      ) {
        allBasepaths.add(val.endsWith('/') ? val : val + '/');
      } else if (
        (val.startsWith('/') || val.startsWith('http')) &&
        /\.(jpg|jpeg|png|webp|avif|svg|gif|mp4|webm|mov|woff2?|ttf|otf|css|js|glb|riv|wasm)(\?|$)/i.test(val)
      ) {
        allUrls.add(val);
      }
    }
    for (const m of ssrHtml.matchAll(/srcset=["']([^"']+)["']/gi)) {
      const parts = m[1].split(',').map((p) => p.trim().split(/\s+/)[0]);
      for (const p of parts) {
        if (p && (p.startsWith('/') || p.startsWith('http'))) allUrls.add(p);
      }
    }

    const externalHostsToRewrite = new Set();
    for (const u of allUrls) {
      if (u.startsWith('http://') || u.startsWith('https://')) {
        try {
          const parsed = new URL(u);
          if (
            parsed.hostname.replace(/^www\./, '') !== targetHost &&
            /\.(jpg|jpeg|png|webp|avif|svg|gif|mp4|webm|mov|m3u8)$/i.test(parsed.pathname)
          ) {
            externalHostsToRewrite.add(parsed.origin);
          }
        } catch { }
      }
    }
    const flightMarker = ssrHtml.indexOf('<script>(self.__next_f');
    if (flightMarker !== -1) {
      let pre = ssrHtml.slice(0, flightMarker);
      const post = ssrHtml.slice(flightMarker);
      for (const origin of externalHostsToRewrite) {
        const host = new URL(origin).host;
        pre = pre.split(origin + '/').join(`/__external/${host}/`);
      }
      ssrHtml = pre + post;
    } else {
      for (const origin of externalHostsToRewrite) {
        const host = new URL(origin).host;
        ssrHtml = ssrHtml.split(origin + '/').join(`/__external/${host}/`);
      }
    }

    ssrHtml = ssrHtml.replace(/<!--\s*<link[^>]*rel=["']stylesheet["'][^>]*>\s*-->/gi, '');
    ssrHtml = ssrHtml.replace(
      /<script[^>]*src="https:\/\/consent\.cookiebot\.com\/[^"]*"[^>]*><\/script>/gi,
      '<script>window.Cookiebot={consent:{necessary:true,preferences:true,statistics:true,marketing:true},hasResponse:true,declined:false,runScripts:()=>{}};</script>'
    );
    ssrHtml = ssrHtml.replace(/<link[^>]*href="https:\/\/[^"]*cookiebot\.com[^"]*"[^>]*>/gi, '');
    ssrHtml = ssrHtml.replace(
      /<script[^>]*src="https?:\/\/[^"]*(?:hm\.baidu\.com|hmcdn\.baidu\.com|wcs\.pstatic\.net|wcs\.naver\.com|nam\.veta\.naver\.com)[^"]*"[^>]*><\/script>/gi,
      ''
    );

    const routeRelDir = getLocalPathForUrl(fullUrl) === 'index.html' ? '' : getLocalPathForUrl(fullUrl);
    if (routeRelDir === null) throw new Error('Invalid captured route ' + route);
    const htmlFilePath = routeRelDir ? path.join(OUT_DIR, routeRelDir, 'index.html') : path.join(OUT_DIR, 'index.html');
    fs.mkdirSync(path.dirname(htmlFilePath), { recursive: true });
    fs.writeFileSync(htmlFilePath, ssrHtml, 'utf8');
    routeMetadata.at(-1).documentFile = path.relative(OUT_DIR, htmlFilePath);
    console.log(`  💾 Saved replay HTML -> ${path.relative(OUT_DIR, htmlFilePath)} (${ssrHtml.length} bytes)`);

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(350);

      const maxScrollY = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
      if (maxScrollY > 0) {
        for (let y = 250; y < maxScrollY + 250; y += 250) {
          await page.evaluate((top) => window.scrollTo(0, top), Math.min(y, maxScrollY));
          await page.waitForTimeout(60);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
      }

      await page.evaluate(() => {
        const interactives = document.querySelectorAll(
          'header a, nav a, [role="button"], button, summary, [data-video-lazy-hover], [data-hls-src]'
        );
        for (const el of Array.from(interactives).slice(0, 40)) {
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        }
      });
      await page.waitForTimeout(300);
    }

    for (const rawUrl of allUrls) {
      try {
        const fullMediaUrl = new URL(rawUrl, targetOrigin).href;
        await downloadFullAsset(fullMediaUrl);
      } catch { }
    }
    for (const mediaUrl of pendingFullMediaUrls) {
      await downloadFullAsset(mediaUrl);
    }

    const variants = [
      'largetall_2x',
      'largetall',
      'large_2x',
      'large',
      'mediumtall_2x',
      'mediumtall',
      'medium_2x',
      'medium',
      'small_2x',
      'small'
    ];
    for (const bp of allBasepaths) {
      for (const v of variants) {
        for (const ext of ['mp4', 'webm']) {
          const testUrl = new URL(`${bp}${v}.${ext}`, targetOrigin).href;
          if (!savedAssets.has(testUrl)) {
            await downloadFullAsset(testUrl);
          }
        }
      }
    }

    if (discoverRoutes) {
      const foundLinks = await page.evaluate((tgtHost) => {
        const links = [];
        for (const a of document.querySelectorAll('a[href]')) {
          try {
            const u = new URL(a.href, window.location.href);
            const normHost = u.hostname.replace(/^www\./, '');
            if (
              normHost === tgtHost &&
              !u.pathname.match(/\.(pdf|zip|png|jpg|jpeg|svg|webp|mp4|xml|txt|json)$/i) &&
              (u.pathname !== '/' || u.search)
            ) {
              const cleanRoute = u.pathname.replace(/\/+$/, '') || '/';
              links.push(cleanRoute + u.search);
            }
          } catch { }
        }
        return Array.from(new Set(links));
      }, targetHost);

      for (const link of foundLinks) {
        discoveredRoutes.add(link);
      }
    }
  }

  while (pendingResponses.size) await Promise.all([...pendingResponses]);
  await browser.close();

  await harvestDynamicBundlerChunks();

  if (discoveredM3u8Urls.size > 0) {
    console.log(`\n🎞️ Recursively mirroring ${discoveredM3u8Urls.size} HLS (.m3u8) stream(s)...`);
    const visitedPlaylists = new Set();
    for (const m3u8Url of discoveredM3u8Urls) {
      await mirrorHlsPlaylistTree(m3u8Url, visitedPlaylists);
    }
  }

  for (const [cssFilePath, cssOriginalUrl] of capturedCssFiles.entries()) {
    if (!fs.existsSync(cssFilePath)) continue;
    let cssContent = fs.readFileSync(cssFilePath, 'utf8');
    const urlMatches = [...cssContent.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)];
    let modified = false;

    for (const m of urlMatches) {
      const fullMatch = m[0];
      const quote = m[1] || '';
      const rawRef = m[2].trim();
      if (!rawRef || rawRef.startsWith('data:') || rawRef.startsWith('#')) continue;

      try {
        const resolvedUrl = new URL(rawRef, cssOriginalUrl);
        if (!resolvedUrl.pathname.endsWith('.eot')) {
          await downloadFullAsset(resolvedUrl.href);
        }
        if (rawRef.startsWith('.') || resolvedUrl.hostname.replace(/^www\./, '') !== targetHost) {
          const fragment = resolvedUrl.hash;
          resolvedUrl.hash = '';
          const localRel = savedAssets.get(resolvedUrl.href)?.relPath ?? getLocalPathForUrl(resolvedUrl.href);
          if (localRel) {
            cssContent = cssContent.replace(fullMatch, `url(${quote}/${localRel.replace(/\\/g, '/')}${fragment}${quote})`);
            modified = true;
          }
        }
      } catch { }
    }

    if (modified) {
      fs.writeFileSync(cssFilePath, cssContent, 'utf8');
    }
  }

  const finalRoutesList = routeMetadata.map((r) => r.route);

  const fingerprintPath = path.join(OUT_DIR, 'forensics', 'stack-fingerprint.json');
  fs.writeFileSync(fingerprintPath, JSON.stringify(stackClassification, null, 2), 'utf8');

  const routesManifestPath = path.join(OUT_DIR, 'forensics', 'routes-manifest.json');
  fs.writeFileSync(
    routesManifestPath,
    JSON.stringify(
      {
        captureVersion: 2,
        targetOrigin,
        capturedAt: new Date().toISOString(),
        totalRoutes: routeMetadata.length,
        excludedOrFailed: [...discoveredRoutes].filter(route => !finalRoutesList.includes(route)),
        routes: routeMetadata
      },
      null,
      2
    ),
    'utf8'
  );

  const forensicOutput = (file, data) => fs.writeFileSync(path.join(OUT_DIR, 'forensics', file), JSON.stringify(data, null, 2));
  forensicOutput('source-maps.json', {version: 1, maps: [...sourceMaps.values()], failures: [...mapFailures.values()].filter(item => !sourceMaps.has(item.scriptUrl))});
  forensicOutput('assets.json', {version: 1, targetOrigin, assets: [...savedAssets].map(([url, data]) => ({url, ...data}))});
  const fixtureIndexPath = path.join(OUT_DIR, '__api_fixtures__', 'manifest.json');
  fs.writeFileSync(fixtureIndexPath, JSON.stringify(apiFixtures, null, 2), 'utf8');

  const imageDimensions = {};
  function scanImages(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '__sourcemaps__', 'forensics'].includes(entry.name)) scanImages(full);
      } else if (/\.(png|jpg|jpeg|webp|avif|svg)$/i.test(entry.name)) {
        try {
          const buf = fs.readFileSync(full);
          const dim = getImageDimensions(buf);
          if (dim) {
            const rel = '/' + path.relative(OUT_DIR, full).replace(/\\/g, '/');
            imageDimensions[rel] = [dim.width, dim.height];
            imageDimensions[entry.name] = [dim.width, dim.height];
          }
        } catch { }
      }
    }
  }
  scanImages(OUT_DIR);
  const dimPath = path.join(OUT_DIR, 'forensics', 'image-dimensions.json');
  fs.writeFileSync(dimPath, JSON.stringify(imageDimensions, null, 2), 'utf8');
  console.log(
    `  🖼️ Extracted intrinsic dimensions for ${Math.floor(Object.keys(imageDimensions).length / 2)} image assets -> forensics/image-dimensions.json`
  );

  const faviconPath = path.join(OUT_DIR, 'favicon.ico');
  if (!fs.existsSync(faviconPath)) {
    const emptyIco = Buffer.from([
      0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x44, 0x00,
      0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x20, 0x00,
      0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]);
    fs.writeFileSync(faviconPath, emptyIco);
  }

  if (!skipCdpForensics && finalRoutesList.length > 0) {
    await extractCdpForensics({
      targetOrigin,
      routes: finalRoutesList,
      outDir: OUT_DIR
    });
  }

  if (!finalRoutesList.length || finalRoutesList.length !== discoveredRoutes.size) {
    throw new Error('Capture incomplete. See forensics/routes-manifest.json for excluded or failed routes.');
  }
  console.log(`\n🎉 Stage 0 Mirror + Deep Chrome CDP Forensics complete!`);
  console.log(`  Captured Routes:    ${finalRoutesList.join(', ')}`);
  console.log(`  Total Assets Saved: ${savedAssets.size}`);
  console.log(`  Total API Fixtures: ${apiFixtures.length}`);
  console.log(`  Routes Manifest:    ${routesManifestPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('capture-mirror.mjs')) {
  run().catch((err) => {
    console.error('Fatal capture error:', err);
    process.exit(1);
  });
}
