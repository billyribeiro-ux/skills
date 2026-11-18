import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Scope exclusions to workflow-owned locations: a public /build asset is valid capture evidence.
const excludedPaths = new Set(['.git','node_modules','forensics/parity-reports','forensics/parity']);

function fileDigest(file, size, buffer) {
  const hash = crypto.createHash('sha256');
  if (size <= buffer.length) return hash.update(fs.readFileSync(file)).digest('hex');
  const fd = fs.openSync(file,'r');
  try {
    let bytes;
    while ((bytes = fs.readSync(fd,buffer,0,buffer.length,null)) > 0) hash.update(buffer.subarray(0,bytes));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/**
 * Computes a deterministic SHA-256 tree digest for a pipeline stage directory,
 * excluding transient parity reports and the stage certificate file itself.
 */
export function computeStageDigest(stage, rootDir) {
  const absRoot = path.resolve(rootDir);
  if (!fs.existsSync(absRoot)) return null;

  const certName = `stage${stage}-cert.json`;
  const entries = [];
  const buffer = Buffer.allocUnsafe(1024 * 1024);

  function walk(dir) {
    const dirItems = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of dirItems) {
      if (item.name === '.DS_Store') continue;
      const full = path.join(dir, item.name);
      const rel = path.relative(absRoot, full).replace(/\\/g, '/');

      if (excludedPaths.has(rel) || (stage === 2 && ['.svelte-kit','build'].includes(rel))) continue;
      if (item.isSymbolicLink()) {
        const resolved = fs.realpathSync(full);
        const base = fs.realpathSync(absRoot);
        if (!resolved.startsWith(base + path.sep)) throw new Error('Untracked external stage link: '+rel);
        const target = fs.readlinkSync(full);
        entries.push({rel, size:Buffer.byteLength(target), sha256:crypto.createHash('sha256').update('link\0'+target).digest('hex')});
      } else if (item.isDirectory()) {
        walk(full);
      } else if (item.isFile()) {
        if (rel === `forensics/${certName}`) continue;
        // Stage 2 excludes conversion-batches scratch metadata that doesn't affect runtime parity
        if (stage === 2 && rel === 'conversion-batches.json') continue;
        const stat = fs.statSync(full);
        const fileHash = fileDigest(full,stat.size,buffer);
        entries.push({ rel, size: stat.size, sha256: fileHash });
      }
    }
  }

  walk(absRoot);

  const treeHasher = crypto.createHash('sha256');
  for (const ent of entries) {
    treeHasher.update(`${ent.rel}\0${ent.size}\0${ent.sha256}\n`);
  }
  return {
    digest: treeHasher.digest('hex'),
    fileCount: entries.length
  };
}

export function manifestRoutes(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'forensics', 'routes-manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.routes) || !manifest.routes.length || manifest.excludedOrFailed?.length) {
    throw new Error('Missing or incomplete route coverage in ' + dir);
  }
  const routes = manifest.routes.map(entry => typeof entry === 'string' ? entry : entry?.route);
  if (routes.some(route => typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) || new Set(routes).size !== routes.length) {
    throw new Error('Invalid or duplicate route in ' + dir);
  }
  return routes;
}

function assertRouteSet(dir, checkedRoutes) {
  const expected = manifestRoutes(dir);
  if (!Array.isArray(checkedRoutes) || expected.length !== checkedRoutes.length || !expected.every(route => checkedRoutes.includes(route))) {
    throw new Error('Verified routes differ from route manifest in ' + dir);
  }
}

export function getCertPath(stage, dir) {
  return path.resolve(dir, 'forensics', `stage${stage}-cert.json`);
}

export function invalidateStageCert(stage, dir) {
  const certPath = getCertPath(stage, dir);
  if (fs.existsSync(certPath)) {
    try {
      fs.unlinkSync(certPath);
    } catch {}
  }
}

/**
 * Mints a hash-pinned Stage Certification Passport ONLY after 100% route + gate pass.
 */
export function mintStageCert({ stage, dir, routes, summary = {} }) {
  const absDir = path.resolve(dir);
  assertRouteSet(absDir, routes);
  const certPath = getCertPath(stage, absDir);
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  const tree = computeStageDigest(stage, absDir);
  if (!tree) {
    throw new Error(`Cannot certify Stage ${stage}: directory missing (${absDir})`);
  }

  const cert = {
    schemaVersion: 2,
    stage,
    passed: true,
    certifiedAt: new Date().toISOString(),
    digest: tree.digest,
    fileCount: tree.fileCount,
    routeCount: Array.isArray(routes) ? routes.length : 0,
    routes: Array.isArray(routes) ? routes : [],
    summary
  };

  fs.writeFileSync(certPath, JSON.stringify(cert, null, 2), 'utf8');
  return cert;
}

/**
 * Hard gate: refuses execution unless the prerequisite stage passed 100% of checks
 * AND no files in that stage have drifted since certification.
 */
export function assertStageCertified({ requiredStage, dir, callerName = 'Pipeline Stage' }) {
  const absDir = path.resolve(dir);
  const certPath = getCertPath(requiredStage, absDir);

  const remediationCmds = {
    0: `node .agent/skills/har-ground-truth-mirror/scripts/verify-stage0-mirror.mjs --live "<TARGET_URL>" --local "http://localhost:3010" --mirror-dir "${dir}"`,
    1: `node .agent/skills/native-stack-decompiler/scripts/verify-stage1-native.mjs --mirror "http://localhost:3010" --native "http://localhost:3011" --mirror-dir "./00-mirror" --native-dir "${dir}"`,
    2: `node .agent/skills/svelte5-stack-converter/scripts/verify-stage2-svelte5.mjs --mirror-url "http://localhost:3010" --native-url "http://localhost:3011" --svelte-url "http://localhost:3012"`
  };

  if (!fs.existsSync(absDir)) {
    console.error(`\n🚫 [PIPELINE LOCK — STAGE ${requiredStage} MISSING] "${callerName}" cannot proceed.`);
    console.error(`   Prerequisite directory does not exist: ${absDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(certPath)) {
    console.error(`\n🚫 [PIPELINE LOCK — STAGE ${requiredStage} UNCERTIFIED] "${callerName}" refused.`);
    console.error(`   Missing signed Stage ${requiredStage} certificate: ${certPath}`);
    console.error(`   You MUST pass Stage ${requiredStage} across 100% of captured routes before advancing.`);
    console.error(`   Run: ${remediationCmds[requiredStage]}`);
    process.exit(1);
  }

  let cert;
  try {
    cert = JSON.parse(fs.readFileSync(certPath, 'utf8'));
  } catch (err) {
    console.error(`\n🚫 [PIPELINE LOCK — CORRUPT STAGE ${requiredStage} CERT] ${certPath}: ${err.message}`);
    process.exit(1);
  }

  if (!cert || cert.passed !== true || cert.stage !== requiredStage || !cert.digest) {
    console.error(`\n🚫 [PIPELINE LOCK — INVALID STAGE ${requiredStage} CERT] "${callerName}" refused.`);
    console.error(`   Certificate did not record a clean pass. Re-run:\n   ${remediationCmds[requiredStage]}`);
    process.exit(1);
  }

  assertRouteSet(absDir, cert.routes);

  const currentTree = computeStageDigest(requiredStage, absDir);
  if (!currentTree || currentTree.digest !== cert.digest) {
    console.error(`\n🚫 [PIPELINE LOCK — STALE STAGE ${requiredStage} CERT] "${callerName}" refused.`);
    console.error(`   Files in ${absDir} changed AFTER Stage ${requiredStage} was certified!`);
    console.error(`   Certified digest: ${cert.digest.slice(0, 16)}... (${cert.fileCount} files)`);
    console.error(`   Current digest:   ${(currentTree?.digest || 'none').slice(0, 16)}... (${currentTree?.fileCount ?? 0} files)`);
    console.error(`   Re-verify Stage ${requiredStage} cleanly:\n   ${remediationCmds[requiredStage]}`);
    process.exit(1);
  }

  console.log(`  🔒 Stage ${requiredStage} Lock Verified (${cert.routeCount} route(s), digest ${cert.digest.slice(0, 12)}..., ${cert.certifiedAt})`);
  return cert;
}
