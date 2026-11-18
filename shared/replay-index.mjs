/** Index the captured GET representations by their browser-visible replay URL. */
export function createReplayLookup({assets, fixtures = [], routes}) {
  const origin = assets?.targetOrigin || routes?.targetOrigin;
  if (!origin) return () => null;
  const target = new URL(origin);
  const entries = new Map();
  const replayKey = (source) => {
    const url = new URL(source, target);
    const local = url.hostname.replace(/^www\./, '') === target.hostname.replace(/^www\./, '') && url.port === target.port;
    return (local ? '' : '/__external/' + url.host) + url.pathname + url.search;
  };
  for (const asset of assets?.assets || []) {
    entries.set(replayKey(asset.url), {file: asset.relPath, contentType: asset.contentType});
  }
  for (const fixture of fixtures || []) {
    if (!fixture.url || !fixture.file) continue;
    const isRSC = fixture.isRSC ?? fixture.file.endsWith('.rsc');
    entries.set((isRSC ? 'rsc:' : '') + replayKey(fixture.url), {
      file: fixture.file,
      contentType: isRSC ? 'text/x-component; charset=utf-8' : 'application/json; charset=utf-8'
    });
  }
  for (const route of routes?.routes || []) {
    if (route.documentFile) entries.set(route.route, {file: route.documentFile, contentType: 'text/html; charset=utf-8'});
  }
  return (requestUrl, {method = 'GET', isRSC = false} = {}) => {
    if (method !== 'GET' && method !== 'HEAD') return null;
    const url = new URL(requestUrl, target);
    const key = url.pathname + url.search;
    return entries.get((isRSC || url.searchParams.has('_rsc') ? 'rsc:' : '') + key) || null;
  };
}
