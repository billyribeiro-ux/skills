#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const localReplayHelper=new URL('./replay-index.mjs',import.meta.url);
const {createReplayLookup}=await import(fs.existsSync(localReplayHelper)?localReplayHelper:new URL('../../shared/replay-index.mjs',import.meta.url));

const require = createRequire(import.meta.url);
let tsCompiler = null;
try {
  tsCompiler = require('typescript');
} catch { }

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const DEFAULT_PORT = parseInt(getArg('--port', process.env.PORT || '3011'), 10);
const ROOT_DIR = path.resolve(getArg('--dir', './01-native'));

const ledgerPath = path.join(ROOT_DIR,'forensics','source-recovery.json');
const readManifest=rel=>fs.existsSync(path.join(ROOT_DIR,rel))?JSON.parse(fs.readFileSync(path.join(ROOT_DIR,rel))):null;
const manifest=readManifest('forensics/assets.json');
const replay=createReplayLookup({assets:manifest,routes:readManifest('forensics/routes-manifest.json'),fixtures:readManifest('__api_fixtures__/manifest.json')||[]});
const sources = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath)).publicScripts : [];
const mappedScripts = new Map(sources.filter(s => s.runtimeSource).map(s => [s.path,s.runtimeSource]));

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
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
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm'
};

const STREAMABLE_EXTS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.ts',
  '.m4s',
  '.mp3',
  '.wav',
  '.ogg',
  '.wasm',
  '.glb'
]);

const FORBIDDEN_CHUNK_URL = /(?:\/_next\/static\/.*\.m?js|\/_astro\/.*\.m?js|\/_nuxt\/.*\.m?js|(?:webpack|turbopack|chunk-)[^/]*\.m?js|\.(?:min|built)\.m?js$)/i;

function findApiFixture(fixtureDir, pathname, search) {
  if (!fs.existsSync(fixtureDir)) return null;
  const safeBase = pathname.replace(/^\/+/, '').replace(/\//g, '__') || 'root';
  const searchHash = search ? Buffer.from(search).toString('hex').slice(0, 16) : '';
  const directCandidates = [
    path.join(fixtureDir, `${safeBase}${searchHash ? '__' + searchHash : ''}.json`),
    path.join(fixtureDir, `${safeBase}.json`)
  ];
  for (const cf of directCandidates) {
    if (fs.existsSync(cf) && fs.statSync(cf).isFile()) return cf;
  }
  const prefix = `${safeBase}__`;
  const files = fs.readdirSync(fixtureDir);
  const match = files.find((f) => f.startsWith(prefix) && f.endsWith('.json'));
  return match ? path.join(fixtureDir, match) : null;
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const rawPathname = parsedUrl.pathname;
    let pathname;
    try { pathname = decodeURIComponent(rawPathname); } catch { res.writeHead(400).end(); return; }
    const parts = pathname.split('/');
    if (parts.some(part => part === '..' || part.includes('\\') || part.includes('\0')) ||
        ['forensics','recovered-source','.native-tools'].includes(parts[1])) {
      res.writeHead(404).end(); return;
    }

    // NUCLEAR GUARD: Stage 1 Server HARD-BLOCKS any request for mirrored bundler JS chunks!
    if (FORBIDDEN_CHUNK_URL.test(pathname)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`403 CHUNK_BYPASS_FORBIDDEN: Stage 1 (:3011) must execute decoded ES source in /src/, never mirrored chunks (${pathname}).`);
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      res.end();
      return;
    }

    // API Fixtures (JSON only — RSC streams belong to Stage 0 mirror, never Stage 1)
    const fixtureDir = path.join(ROOT_DIR, '__api_fixtures__');
    const matchedFixture = !manifest && findApiFixture(fixtureDir, pathname, parsedUrl.search);
    if (matchedFixture) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(matchedFixture).pipe(res);
      return;
    }

    let targetRelPath = pathname.replace(/^\/+/, '');
    const rawRelPath = rawPathname.replace(/^\/+/, '');

    if (pathname === '/_next/image') {
      const imgParam = parsedUrl.searchParams.get('url');
      if (imgParam) {
        const decoded = decodeURIComponent(imgParam);
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          try {
            const u = new URL(decoded);
            targetRelPath = path.join('__external', u.hostname, decodeURIComponent(u.pathname).replace(/^\/+/, ''));
          } catch {
            targetRelPath = decoded.replace(/^\/+/, '');
          }
        } else {
          targetRelPath = decoded.replace(/^\/+/, '');
        }
      }
    }

    const indexed=replay(parsedUrl.pathname+parsedUrl.search,{method:req.method});
    const mapped = mappedScripts.get(indexed?.file || targetRelPath);
    const candidates = [
      ...(mapped ? [path.resolve(ROOT_DIR, mapped)] : []),
      ...(indexed ? [path.resolve(ROOT_DIR,indexed.file)] : []),
      path.join(ROOT_DIR, targetRelPath === '' ? 'index.html' : targetRelPath),
      path.join(ROOT_DIR, rawRelPath === '' ? 'index.html' : rawRelPath),
      path.join(ROOT_DIR, targetRelPath, 'index.css'),
      path.join(ROOT_DIR, targetRelPath, 'index.html'),
      path.join(ROOT_DIR, `${targetRelPath}.html`),
      path.join(ROOT_DIR, '__external', targetRelPath),
      path.join(ROOT_DIR, '__external', rawRelPath)
    ];

    const filePath = candidates.find((f) => f.startsWith(ROOT_DIR + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile());

    if (!filePath) {
      if (pathname === '/favicon.ico') {
        const emptyIco = Buffer.from([
          0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x44, 0x00,
          0x00, 0x00, 0x16, 0x00, 0x00, 0x00, 0x28, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x20, 0x00,
          0x00, 0x00, 0x01, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00
        ]);
        res.writeHead(200, {
          'Content-Type': 'image/x-icon',
          'Content-Length': emptyIco.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(emptyIco);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // On-the-fly JSX / TSX / TS -> Browser ESM transpilation for Stage 1 /src/ modules
    const sourceTs = ext === '.ts' && filePath.startsWith(path.join(ROOT_DIR,'src') + path.sep);
    if (tsCompiler && (sourceTs || ['.jsx','.tsx'].includes(ext))) {
      const sourceText = fs.readFileSync(filePath, 'utf8');
      const transpiled = tsCompiler.transpileModule(sourceText, {
        compilerOptions: {
          jsx: tsCompiler.JsxEmit.React,
          module: tsCompiler.ModuleKind.ESNext,
          target: tsCompiler.ScriptTarget.ES2022
        },
        fileName: path.basename(filePath)
      });
      const outBuf = Buffer.from(transpiled.outputText, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Content-Length': outBuf.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(outBuf);
      return;
    }

    const contentType = indexed?.contentType || MIME_MAP[ext] || 'application/octet-stream';

    const range = req.headers.range;
    if (range && STREAMABLE_EXTS.has(ext)) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (Number.isNaN(start) || start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      });
      const stream = fs.createReadStream(filePath, { start, end });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Permissions-Policy': 'unload=*'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. Kill stale server on :${port} or specify --port.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`⚡ Stage 1 Decoded Native Stack Server (Zero-Chunk Enforced) listening on http://127.0.0.1:${server.address().port}`);
    console.log(`📁 Serving Root: ${ROOT_DIR}`);
  });

  return server;
}

startServer(DEFAULT_PORT);
