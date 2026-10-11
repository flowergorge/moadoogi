// Google provides Firebase Secure Token public keys through both endpoint forms.
// Prefer the documented metadata/jwk URL; use the compatible legacy form as fallback.
const JWKS_URLS = [
  'https://www.googleapis.com/service_accounts/v1/metadata/jwk/securetoken@system.gserviceaccount.com',
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
];
const MAX_BODY_BYTES = 131072;
const MAX_ITEM_BYTES = 12000;
const MAX_SYNC_CHANGES = 100;
const ITEMS_PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES = 2097152;
const MAX_HTML_BYTES = 262144;
const MAX_OEMBED_BYTES = 32768;
const FETCH_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');
let jwksCache = { until: 0, keys: [] };
let jwksInFlight = null;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function failure(status, code, message) {
  throw new ApiError(status, code, message);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function allowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '';
  return new Set(raw.split(',').map(value => value.trim()).filter(value => {
    try {
      const url = new URL(value);
      return url.origin === value && ['https:', 'http:'].includes(url.protocol);
    } catch {
      return false;
    }
  }));
}

function addCors(response, origin, origins) {
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');
  if (origin && origins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(response.body, { status: response.status, headers });
}

function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
}

function decodeJwtObject(segment) {
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(segment)));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JWT JSON');
    return parsed;
  } catch {
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
}

async function getGoogleKeys() {
  if (Date.now() < jwksCache.until && jwksCache.keys.length) return jwksCache.keys;
  if (!jwksInFlight) {
    jwksInFlight = (async () => {
      for (const url of JWKS_URLS) {
        try {
          // Cloudflare Workers does not support redirect: 'error' for fetch().
          // Manual mode lets us reject any redirect without following it.
          const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
          if (!response.ok) {
            console.warn('Firebase signing keys fetch HTTP status', response.status);
            continue;
          }
          const body = await response.json().catch(() => null);
          if (!body || !Array.isArray(body.keys)) {
            console.warn('Firebase signing keys response was not a JWK set');
            continue;
          }
          const keys = body.keys.filter(key =>
            key && key.kty === 'RSA' && key.alg === 'RS256' &&
            key.use === 'sig' && typeof key.kid === 'string'
          );
          if (!keys.length) continue;
          const match = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('Cache-Control') || '');
          const ttl = match ? Number(match[1]) : 300;
          jwksCache = { keys, until: Date.now() + Math.max(60, Math.min(3600, ttl)) * 1000 };
          return keys;
        } catch (error) {
          // Do not log JWTs or credentials.
          console.warn('Firebase signing keys fetch failed', error?.name || 'network_error', String(error?.message || '').slice(0, 200));
        }
      }
      failure(503, 'key_service_unavailable', 'Authentication keys temporarily unavailable');
    })();
  }
  try {
    return await jwksInFlight;
  } finally {
    jwksInFlight = null;
  }
}

export async function verifyFirebaseIdToken(token, projectId) {
  if (typeof projectId !== 'string' || !projectId || projectId.startsWith('YOUR_')) {
    failure(503, 'not_configured', 'Firebase project ID not configured');
  }
  if (typeof token !== 'string' || token.length > 8192) {
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
  const segments = token.split('.');
  if (segments.length !== 3) failure(401, 'invalid_token', 'Invalid Firebase ID token');
  const [headerPart, payloadPart, signaturePart] = segments;
  const header = decodeJwtObject(headerPart);
  const payload = decodeJwtObject(payloadPart);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== projectId ||
    payload.iss !== 'https://securetoken.google.com/' + projectId ||
    typeof payload.sub !== 'string' ||
    payload.sub.length < 1 ||
    payload.sub.length > 128 ||
    !Number.isInteger(payload.exp) ||
    !Number.isInteger(payload.iat) ||
    payload.exp <= now ||
    payload.iat > now ||
    payload.exp <= payload.iat ||
    (payload.auth_time !== undefined && (!Number.isInteger(payload.auth_time) || payload.auth_time > now))
  ) {
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
  const keys = await getGoogleKeys();
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) failure(401, 'invalid_token', 'Invalid Firebase ID token');
  try {
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(signaturePart),
      encoder.encode(headerPart + '.' + payloadPart)
    );
    if (!valid) failure(401, 'invalid_token', 'Invalid Firebase ID token');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    failure(401, 'invalid_token', 'Invalid Firebase ID token');
  }
  return payload.sub;
}

function requireBearer(request) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) failure(401, 'authorization_required', 'Firebase ID token required');
  return match[1];
}

function textField(value, name, limit, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > limit) {
    failure(400, 'invalid_item', 'Invalid ' + name);
  }
  return value;
}

function validId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) {
    failure(400, 'invalid_item', 'Invalid item ID');
  }
  return id;
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    failure(400, 'invalid_item', 'Item must be an object');
  }
  const keys = Object.keys(raw);
  if (keys.length > 40 || keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key) || key.length > 80)) {
    failure(400, 'invalid_item', 'Invalid item fields');
  }
  const item = { ...raw };
  item.id = validId(raw.id);
  item.title = textField(raw.title, 'title', 300);
  item.url = textField(raw.url, 'url', 4096);
  if (item.url) {
    let parsed;
    try { parsed = new URL(item.url); } catch { failure(400, 'invalid_item', 'Invalid item URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      failure(400, 'invalid_item', 'Invalid item URL');
    }
  }
  item.note = textField(raw.note, 'note', 5000);
  item.status = textField(raw.status, 'status', 100);
  item.date = textField(raw.date, 'date', 32);
  if (item.date && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    failure(400, 'invalid_item', 'Invalid item date');
  }
  item.created = textField(raw.created, 'created', 64, new Date().toISOString());
  if (!Number.isFinite(Date.parse(item.created))) failure(400, 'invalid_item', 'Invalid created timestamp');
  item.rank = raw.rank === undefined ? 0 : raw.rank;
  if (typeof item.rank !== 'number' || !Number.isFinite(item.rank) || Math.abs(item.rank) > 1e12) {
    failure(400, 'invalid_item', 'Invalid rank');
  }
  item.starred = raw.starred === undefined ? false : raw.starred;
  if (typeof item.starred !== 'boolean') failure(400, 'invalid_item', 'Invalid starred value');
  item.autoTagsApplied = raw.autoTagsApplied === undefined ? false : raw.autoTagsApplied;
  if (typeof item.autoTagsApplied !== 'boolean') failure(400, 'invalid_item', 'Invalid autoTagsApplied value');
  item.tags = raw.tags === undefined ? [] : raw.tags;
  if (
    !Array.isArray(item.tags) ||
    item.tags.length > 24 ||
    item.tags.some(tag => typeof tag !== 'string' || tag.length < 1 || tag.length > 80)
  ) failure(400, 'invalid_item', 'Invalid tags');
  const itemJson = JSON.stringify(item);
  if (encoder.encode(itemJson).byteLength > MAX_ITEM_BYTES) {
    failure(413, 'item_too_large', 'Item exceeds 12 KB');
  }
  return { item, itemJson };
}

async function readJsonBody(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    failure(415, 'unsupported_media_type', 'Expected application/json');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) {
    failure(413, 'body_too_large', 'Request body exceeds 128 KB');
  }
  if (!request.body) failure(400, 'invalid_json', 'Missing JSON body');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        failure(413, 'body_too_large', 'Request body exceeds 128 KB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required');
    return body;
  } catch {
    failure(400, 'invalid_json', 'Invalid JSON object');
  }
}

async function rateLimit(db, userId, endpoint, max) {
  const bucket = userId + ':' + endpoint;
  const windowStart = Math.floor(Date.now() / 60000);
  const result = await db.prepare(
    'INSERT INTO request_limits (bucket_key, window_start, counter) VALUES (?, ?, 1) ' +
    'ON CONFLICT(bucket_key) DO UPDATE SET window_start = excluded.window_start, ' +
    'counter = CASE WHEN request_limits.window_start = excluded.window_start ' +
    'THEN request_limits.counter + 1 ELSE 1 END RETURNING counter'
  ).bind(bucket, windowStart).first();
  if (!result || result.counter > max) failure(429, 'rate_limited', 'Request rate limit exceeded');
}

function parseItemsOffset(url) {
  const values = url.searchParams.getAll('offset');
  if (!values.length) return 0;
  const raw = values[0];
  if (values.length !== 1 || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    failure(400, 'invalid_offset', 'offset must be a non-negative safe integer');
  }
  return Number(raw);
}

async function getItems(db, userId, offset) {
  const query = await db.prepare(
    'SELECT item_json FROM items WHERE user_id = ? ORDER BY rank ASC, created DESC, id ASC LIMIT ? OFFSET ?'
  ).bind(userId, ITEMS_PAGE_SIZE, offset).all();
  const rows = query.results || [];
  const items = rows.map(row => JSON.parse(row.item_json));
  const serialized = JSON.stringify({ items });
  if (encoder.encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
    failure(413, 'response_too_large', 'Page exceeds 2 MB response limit');
  }
  return new Response(serialized, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function applySync(db, userId, request) {
  const payload = await readJsonBody(request);
  if (!Array.isArray(payload.changes) || !payload.changes.length || payload.changes.length > MAX_SYNC_CHANGES) {
    failure(400, 'invalid_changes', 'Expected 1 to 100 changes');
  }
  const commands = [];
  const now = Date.now();
  for (const change of payload.changes) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      failure(400, 'invalid_changes', 'Invalid change');
    }
    if (change.op === 'upsert') {
      const { item, itemJson } = normalizeItem(change.item);
      commands.push(db.prepare(
        'INSERT INTO items (user_id, id, item_json, rank, created, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, id) ' +
        'DO UPDATE SET item_json = excluded.item_json, rank = excluded.rank, ' +
        'created = excluded.created, updated_at = excluded.updated_at'
      ).bind(userId, item.id, itemJson, item.rank, item.created, now));
    } else if (change.op === 'delete') {
      commands.push(db.prepare('DELETE FROM items WHERE user_id = ? AND id = ?').bind(userId, validId(change.id)));
    } else {
      failure(400, 'invalid_changes', 'Unsupported change operation');
    }
  }
  await db.batch(commands);
  return json({ ok: true });
}

// HTTPS only, no userinfo, IP literals, nonstandard ports, single-label or internal names.
// All redirected destinations pass through this function again.
export function validatePublicHttpsUrl(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) {
    failure(400, 'invalid_url', 'A valid HTTPS URL is required');
  }
  let url;
  try { url = new URL(value); } catch { failure(400, 'invalid_url', 'Invalid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    failure(400, 'invalid_url', 'Only public HTTPS URLs on port 443 are allowed');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host ||
    host.length > 253 ||
    !host.includes('.') ||
    host.startsWith('[') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    /^(?:\d+|0x[0-9a-f]+)$/i.test(host) ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.split('.').some(part => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-')) ||
    /(?:^|\.)(?:localhost|local|lan|internal|intranet|home|corp|localdomain|onion|test|invalid|arpa)$/.test(host) ||
    /(?:^|\.)(?:localhost|metadata|instance-data)(?:\.|$)/.test(host)
  ) {
    failure(400, 'unsafe_url', 'Private or internal hosts are not allowed');
  }
  url.hash = '';
  return url;
}

async function readLimited(response, max, allowTruncate) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const pieces = [];
  let count = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (count + value.byteLength > max) {
        if (!allowTruncate) failure(422, 'response_too_large', 'Remote response exceeds size limit');
        const remaining = max - count;
        if (remaining > 0) pieces.push(value.subarray(0, remaining));
        await reader.cancel();
        break;
      }
      pieces.push(value);
      count += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(pieces.reduce((sum, item) => sum + item.byteLength, 0));
  let offset = 0;
  for (const piece of pieces) { buffer.set(piece, offset); offset += piece.byteLength; }
  return decoder.decode(buffer);
}

async function fetchPublicText(initial, kind, signal, headers = {}) {
  let current = validatePublicHttpsUrl(initial);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    let response;
    try {
      response = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: kind === 'html' ? 'text/html, application/xhtml+xml;q=0.9' : 'application/json',
          ...headers
        },
        signal
      });
    } catch (error) {
      if (error && error.name === 'TimeoutError') failure(504, 'upstream_timeout', 'Remote website timed out');
      failure(502, 'upstream_failed', 'Could not retrieve remote website');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (!location || redirects === MAX_REDIRECTS) failure(422, 'invalid_redirect', 'Too many redirects');
      await response.body?.cancel();
      // A relative Location is resolved against the previous, verified URL.
      current = validatePublicHttpsUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) failure(502, 'upstream_failed', 'Remote website did not return a successful response');
    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    const validType = kind === 'html'
      ? /^(text\/html|application\/xhtml\+xml)(?:;|$)/.test(contentType)
      : /^(application\/json|text\/json)(?:;|$)/.test(contentType);
    if (!validType) failure(415, 'unsupported_remote_type', 'Remote website returned unsupported content');
    const body = await readLimited(response, kind === 'html' ? MAX_HTML_BYTES : MAX_OEMBED_BYTES, kind === 'html');
    return { body, url: current.href };
  }
  failure(422, 'invalid_redirect', 'Too many redirects');
}

function decodeEntities(input) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return input.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (full, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1].toLowerCase() === 'x';
      const number = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(number) && number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number) : '';
    }
    return named[entity.toLowerCase()] || full;
  });
}

function cleanText(value, limit = 300) {
  return decodeEntities(String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' '))
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function stripHtml(html) {
  return cleanText(
    String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
    2500
  );
}

function htmlAttributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

// Return an original-site URL only; never fetch, proxy, or store the icon bytes.
export function extractFaviconUrl(html, pageUrl) {
  let base;
  try { base = validatePublicHttpsUrl(pageUrl); } catch { return ''; }
  const source = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const baseTag = source.match(/<base\b[^>]{0,4096}>/i);
  if (baseTag) {
    const href = htmlAttributes(baseTag[0]).href;
    if (href) try { base = validatePublicHttpsUrl(new URL(href, base).href); } catch {}
  }
  const candidates = [];
  for (const match of source.matchAll(/<link\b[^>]{0,4096}>/gi)) {
    const attrs = htmlAttributes(match[0]);
    const rel = (attrs.rel || '').toLowerCase().split(/\s+/);
    const regular = rel.includes('icon');
    if (!regular && !rel.includes('apple-touch-icon') && !rel.includes('apple-touch-icon-precomposed')) continue;
    if (!attrs.href) continue;
    try {
      const url = validatePublicHttpsUrl(new URL(attrs.href, base).href).href;
      const size = Math.max(0, ...[...(attrs.sizes || '').matchAll(/(?:^|\s)(\d+)x\d+/g)].map(m => Math.min(96, Number(m[1]))));
      const vector = /svg/i.test(attrs.type || '') || /\.svg(?:[?#]|$)/i.test(url);
      candidates.push({ url, score: (regular ? 200 : 0) + (vector ? 100 : size) });
    } catch { /* Ignore non-public, insecure, data:, or malformed icon references. */ }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || '';
}

export function extractHtmlMetadata(html, pageUrl) {
  const tags = [...String(html).matchAll(/<meta\b[^>]{0,4096}>/gi)];
  const meta = {};
  for (const match of tags) {
    const attributes = {};
    const attrRegex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g;
    for (const attribute of match[0].matchAll(attrRegex)) {
      attributes[attribute[1].toLowerCase()] = attribute[2] ?? attribute[3] ?? attribute[4];
    }
    const key = (attributes.property || attributes.name || '').toLowerCase();
    if (key && attributes.content && !meta[key]) meta[key] = attributes.content;
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = cleanText(meta['og:title'] || meta['twitter:title'] || (titleTag && titleTag[1]) || '');
  const author = cleanText(meta.author || meta['article:author'] || meta['twitter:creator'] || '', 180);
  const text = cleanText(meta['og:description'] || meta.description || meta['twitter:description'] || '', 2500);
  const favicon = extractFaviconUrl(html, pageUrl);
  return Object.fromEntries(Object.entries({ title, author, text, favicon }).filter(([, value]) => value));
}

function parseOembedJson(body) {
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid oEmbed data');
    return data;
  } catch {
    failure(502, 'invalid_oembed', 'Remote oEmbed returned invalid JSON');
  }
}


export function bilibiliVideo(value) {
  let u;
  try { u = validatePublicHttpsUrl(value); } catch { return null; }
  if (u.hostname !== 'bilibili.com' && !u.hostname.endsWith('.bilibili.com')) return null;
  const match = /^\/video\/(BV[0-9A-Za-z]{10}|av[1-9]\d{0,19})(?:\/|$)/.exec(u.pathname);
  return match ? { key: match[1].startsWith('BV') ? 'bvid' : 'aid', id: match[1].replace(/^av/, '') } : null;
}
export function bilibiliThumbnail(value) {
  try {
    const url = validatePublicHttpsUrl(String(value || '').replace(/^(?:http:)?\/\//, 'https://'));
    return url.hostname.endsWith('.hdslb.com') ? url.href : '';
  } catch { return ''; }
}
async function resolveBilibiliShort(target, signal) {
  let current = target;
  for (let count = 0; count < MAX_REDIRECTS; count++) {
    if (current.hostname !== 'b23.tv') return current;
    const response = await fetch(current.href, { redirect: 'manual', signal });
    await response.body?.cancel();
    if (![301,302,303,307,308].includes(response.status)) return current;
    const location = response.headers.get('Location');
    if (!location) return current;
    const next = validatePublicHttpsUrl(new URL(location, current).href);
    if (next.hostname !== 'b23.tv' && next.hostname !== 'bilibili.com' && !next.hostname.endsWith('.bilibili.com')) {
      failure(422, 'invalid_redirect', 'Bilibili share link redirected outside Bilibili');
    }
    current = next;
  }
  return current;
}
export async function getBilibiliMetadata(target, signal) {
  if (target.hostname === 'b23.tv') target = await resolveBilibiliShort(target, signal);
  const video = bilibiliVideo(target.href);
  if (video) {
    try {
      const endpoint = 'https://api.bilibili.com/x/web-interface/view?' + new URLSearchParams({ [video.key]: video.id });
      const response = await fetchPublicText(endpoint, 'json', signal, { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.bilibili.com/' });
      const data = JSON.parse(response.body);
      if (data.code === 0 && data.data) {
        const title = cleanText(data.data.title);
        const thumbnail = bilibiliThumbnail(data.data.pic);
        const author = cleanText(data.data.owner?.name, 180);
        if (title || thumbnail) return { ...(title ? { title } : {}), ...(thumbnail ? { thumbnail } : {}), ...(author ? { author } : {}) };
      }
    } catch { /* Unavailable public API falls back to the original page. */ }
  }
  const response = await fetchPublicText(target.href, 'html', signal);
  const result = extractHtmlMetadata(response.body, response.url);
  if (bilibiliVideo(response.url)) {
    for (const match of response.body.matchAll(/<meta\b[^>]{0,4096}>/gi)) {
      const attrs = htmlAttributes(match[0]);
      if (!['og:image', 'twitter:image'].includes((attrs.property || attrs.name || '').toLowerCase())) continue;
      const thumbnail = bilibiliThumbnail(attrs.content);
      if (thumbnail) { result.thumbnail = thumbnail; break; }
    }
  }
  return result;
}

async function getMetadata(request) {
  const raw = new URL(request.url).searchParams.get('url') || '';
  const target = validatePublicHttpsUrl(raw);
  const host = target.hostname.replace(/^www\./, '');
  const isYoutube = ['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host);
  const isX = ['x.com', 'twitter.com', 'mobile.twitter.com'].includes(host);
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);

  if (host === 'bilibili.com' || host.endsWith('.bilibili.com') || host === 'b23.tv') {
    return getBilibiliMetadata(target, signal);
  }

  if (isYoutube || isX) {
    const endpoint = isYoutube
      ? 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(target.href)
      : 'https://publish.twitter.com/oembed?omit_script=true&url=' + encodeURIComponent(target.href);
    try {
      const result = await fetchPublicText(endpoint, 'json', signal);
      const data = parseOembedJson(result.body);
      if (isYoutube) {
        const title = cleanText(data.title);
        const author = cleanText(data.author_name, 180);
        if (title) return { title, ...(author ? { author } : {}) };
      } else {
        const author = cleanText(data.author_name, 180);
        const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(data.html || '');
        const text = stripHtml(paragraph ? paragraph[1] : data.html || '');
        if (author || text) {
          return { ...(author ? { author } : {}), ...(text ? { text } : {}), ...(text ? { title: text.slice(0, 180) } : {}) };
        }
      }
    } catch {
      // oEmbed is best effort, so an unavailable provider falls back to page metadata.
    }
  }

  const result = await fetchPublicText(target.href, 'html', signal);
  return extractHtmlMetadata(result.body, result.url);
}

export async function getSuggestedTags(db, userId) {
  const result = await db.prepare(
    "SELECT t.value AS tag, COUNT(*) AS uses FROM items AS i, json_each(i.item_json, '$.tags') AS t " +
    "WHERE i.user_id = ? AND t.type = 'text' AND length(t.value) BETWEEN 1 AND 80 " +
    "GROUP BY t.value ORDER BY uses DESC, t.value ASC LIMIT 16"
  ).bind(userId).all();
  return json({ tags: (result.results || []).map(row => row.tag) });
}

async function route(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found', message: 'Unknown API endpoint' }, 404);
  if (!env.DB || !env.FIREBASE_PROJECT_ID) {
    failure(503, 'not_configured', 'Worker backend is not configured');
  }
  const userId = await verifyFirebaseIdToken(requireBearer(request), env.FIREBASE_PROJECT_ID);
  if (url.pathname === '/api/items' && request.method === 'GET') {
    const offset = parseItemsOffset(url);
    await rateLimit(env.DB, userId, 'items', 120);
    return getItems(env.DB, userId, offset);
  }
  if (url.pathname === '/api/tags' && request.method === 'GET') {
    await rateLimit(env.DB, userId, 'tags', 30);
    return getSuggestedTags(env.DB, userId);
  }
  if (url.pathname === '/api/sync' && request.method === 'POST') {
    await rateLimit(env.DB, userId, 'sync', 30);
    return applySync(env.DB, userId, request);
  }
  if (url.pathname === '/api/metadata' && request.method === 'GET') {
    await rateLimit(env.DB, userId, 'metadata', 15);
    return json(await getMetadata(request));
  }
  if (['/api/items', '/api/sync', '/api/metadata', '/api/tags'].includes(url.pathname)) {
    return json({ error: 'method_not_allowed', message: 'Unsupported HTTP method' }, 405);
  }
  return json({ error: 'not_found', message: 'Unknown API endpoint' }, 404);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const origins = allowedOrigins(env || {});
    let response;
    try {
      if (!origins.size) failure(503, 'not_configured', 'Allowed origins not configured');
      if (origin && !origins.has(origin)) failure(403, 'origin_forbidden', 'Origin is not allowed');
      if (request.method === 'OPTIONS') {
        if (!origin) failure(400, 'invalid_preflight', 'Origin header is required');
        response = new Response(null, { status: 204 });
      } else {
        response = await route(request, env);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        response = json({ error: error.code, message: error.message }, error.status);
      } else {
        console.error('Worker request failed', error);
        response = json({ error: 'internal_error', message: 'Unexpected server error' }, 500);
      }
    }
    return addCors(response, origin, origins);
  }
};
