#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
};

const DEFAULT_PORT = parseInt(getArg('--port', process.env.PORT || '3010'), 10);
const ROOT_DIR = path.resolve(getArg('--dir', './00-mirror'));

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.riv': 'application/octet-stream',
  '.rsc': 'text/x-component; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8'
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
  '.bin',
  '.glb'
]);

function getQueryKeyedRelPath(relPath, search) {
  if (!search || search === '?') return relPath;
  const ext = path.extname(relPath);
  const qHash = crypto.createHash('sha1').update(search).digest('hex').slice(0, 12);
  return `${relPath}__q_${qHash}${ext}`;
}

function findApiFixture(fixtureDir, pathname, search, isRSC) {
  if (!fs.existsSync(fixtureDir)) return null;
  const ext = isRSC ? 'rsc' : 'json';
  const safeBase = pathname.replace(/^\/+/, '').replace(/\//g, '__') || 'root';
  const searchHash = search ? Buffer.from(search).toString('hex').slice(0, 16) : '';
  const directCandidates = [
    path.join(fixtureDir, `${safeBase}${searchHash ? '__' + searchHash : ''}.${ext}`),
    path.join(fixtureDir, `${safeBase}.${ext}`)
  ];
  for (const cf of directCandidates) {
    if (fs.existsSync(cf) && fs.statSync(cf).isFile()) return cf;
  }
  const prefix = `${safeBase}__`;
  const files = fs.readdirSync(fixtureDir);
  const match = files.find((f) => f.startsWith(prefix) && f.endsWith(`.${ext}`));
  return match ? path.join(fixtureDir, match) : null;
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const parsedUrl = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const rawPathname = parsedUrl.pathname;
    const pathname = decodeURIComponent(rawPathname);
    const isRSC = parsedUrl.searchParams.has('_rsc') || req.headers['rsc'] === '1';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      res.end();
      return;
    }

    // 1. Neutralize third-party telemetry beacons
    if (pathname.startsWith('/ingest/') || pathname === '/ingest') {
      res.writeHead(200, {
        'Content-Type': pathname.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(pathname.endsWith('.js') ? '/* airgap telemetry noop */' : JSON.stringify({ status: 1 }));
      return;
    }

    if (
      pathname === '/__cookiebot_mock.js' ||
      pathname.includes('/uc.js') ||
      pathname.startsWith('/consentconfig/')
    ) {
      res.writeHead(200, {
        'Content-Type': pathname.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(
        pathname.endsWith('.json')
          ? JSON.stringify({ cbid: 'mock', domains: ['localhost', '127.0.0.1'] })
          : 'window.Cookiebot={consent:{necessary:true,preferences:true,statistics:true,marketing:true},hasResponse:true,declined:false,runScripts:()=>{}};window.CookieConsent=window.Cookiebot;'
      );
      return;
    }

    // 2. API Fixtures & RSC Streams
    const fixtureDir = path.join(ROOT_DIR, '__api_fixtures__');
    const matchedFixture = findApiFixture(fixtureDir, pathname, parsedUrl.search, isRSC);
    if (matchedFixture) {
      res.writeHead(200, {
        'Content-Type': isRSC ? 'text/x-component; charset=utf-8' : 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        Vary: isRSC ? 'RSC, Next-Router-State-Tree, Next-Router-Prefetch' : 'Accept'
      });
      fs.createReadStream(matchedFixture).pipe(res);
      return;
    }

    // 3. Static Asset & Next.js /_next/image Resolution (supporting both decoded, raw, & query-keyed paths)
    let targetRelPath = pathname.replace(/^\/+/, '');
    const rawRelPath = rawPathname.replace(/^\/+/, '');
    let assetSearch = parsedUrl.search;

    if (pathname === '/_next/image') {
      const imgParam = parsedUrl.searchParams.get('url');
      if (imgParam) {
        const decoded = decodeURIComponent(imgParam);
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          try {
            const u = new URL(decoded);
            targetRelPath = path.join('__external', u.hostname, decodeURIComponent(u.pathname).replace(/^\/+/, ''));
            if (u.search) assetSearch = u.search;
          } catch {
            targetRelPath = decoded.replace(/^\/+/, '');
          }
        } else {
          const qIdx = decoded.indexOf('?');
          targetRelPath = (qIdx !== -1 ? decoded.slice(0, qIdx) : decoded).replace(/^\/+/, '');
          if (qIdx !== -1) assetSearch = decoded.slice(qIdx);
        }
      }
    }

    const candidates = [];
    if (assetSearch && assetSearch !== '?') {
      const qTarget = getQueryKeyedRelPath(targetRelPath, assetSearch);
      const qRaw = getQueryKeyedRelPath(rawRelPath, assetSearch);
      candidates.push(
        path.join(ROOT_DIR, qTarget),
        path.join(ROOT_DIR, qRaw),
        path.join(ROOT_DIR, '__external', qTarget),
        path.join(ROOT_DIR, '__external', qRaw)
      );
    }
    candidates.push(
      path.join(ROOT_DIR, targetRelPath === '' ? 'index.html' : targetRelPath),
      path.join(ROOT_DIR, rawRelPath === '' ? 'index.html' : rawRelPath),
      path.join(ROOT_DIR, targetRelPath, 'index.css'),
      path.join(ROOT_DIR, targetRelPath, 'index.html'),
      path.join(ROOT_DIR, `${targetRelPath}.html`),
      path.join(ROOT_DIR, '__external', targetRelPath),
      path.join(ROOT_DIR, '__external', rawRelPath)
    );

    const filePath = candidates.find((f) => fs.existsSync(f) && fs.statSync(f).isFile());

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
    const contentType = MIME_MAP[ext] || 'application/octet-stream';

    // 4. HTTP 206 Partial Content Byte-Range Streaming
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
    console.log(`📡 Stage 0 Ground-Truth Mirror Server listening on http://localhost:${port}`);
    console.log(`📁 Serving Root: ${ROOT_DIR}`);
  });

  return server;
}

startServer(DEFAULT_PORT);
