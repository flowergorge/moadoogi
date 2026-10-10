import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const projectId = 'moadoogi-page-test';
const origin = 'https://flowergorge.github.io';

async function createAuth() {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  Object.assign(publicKey, { kid: 'paging-test-key', alg: 'RS256', use: 'sig' });
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(value).toString('base64url');
  const header = encode(JSON.stringify({ alg: 'RS256', kid: 'paging-test-key' }));
  const payload = encode(JSON.stringify({
    aud: projectId,
    iss: 'https://securetoken.google.com/' + projectId,
    sub: 'user-a',
    exp: now + 3600,
    iat: now - 60,
    auth_time: now - 60
  }));
  const signed = header + '.' + payload;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed)
  );
  return {
    idToken: signed + '.' + encode(signature),
    jwksResponse: { keys: [publicKey] }
  };
}

function createD1Mock(entries) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          if (sql.startsWith('INSERT INTO request_limits')) {
            return {
              async first() { return { counter: 1 }; }
            };
          }
          assert.match(sql, /^SELECT item_json FROM items WHERE user_id = \? ORDER BY rank ASC, created DESC, id ASC LIMIT \? OFFSET \?$/);
          assert.equal(values[1], 100, 'Always use a 100-item page size');
          return {
            async all() {
              const [userId, limit, offset] = values;
              const ordered = entries.filter(row => row.user_id === userId).sort((a, b) =>
                a.rank - b.rank ||
                b.created.localeCompare(a.created) ||
                a.id.localeCompare(b.id)
              );
              return { results: ordered.slice(offset, offset + limit).map(row => ({ item_json: row.item_json })) };
            }
          };
        }
      };
    }
  };
}

function createEntries() {
  const entries = [];
  for (let index = 0; index < 252; index++) {
    const item = {
      id: 'item-' + String(index).padStart(4, '0'),
      rank: index % 7,
      created: '2026-10-' + String((index % 4) + 1).padStart(2, '0') + 'T10:00:00.000Z',
      title: 'Saved item ' + index,
      note: 'x'.repeat(5000),
      tags: ['saved']
    };
    entries.push({ user_id: 'user-a', ...item, item_json: JSON.stringify(item) });
  }
  for (let index = 0; index < 105; index++) {
    const item = { id: 'other-' + index, rank: index, created: '2026-10-01T00:00:00Z', title: 'Private' };
    entries.push({ user_id: 'user-b', ...item, item_json: JSON.stringify(item) });
  }
  return entries;
}

test('pagination retrieves each item exactly once with stable sorting and 100/page', async () => {
  const entries = createEntries();
  const db = createD1Mock(entries);
  const { idToken, jwksResponse } = await createAuth();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /^https:\/\/www\.googleapis\.com\/service_accounts\/v1\/jwk\//);
    return new Response(JSON.stringify(jwksResponse), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=300' }
    });
  };
  const environment = { DB: db, FIREBASE_PROJECT_ID: projectId, ALLOWED_ORIGINS: origin };
  const requestPage = async query => {
    const response = await worker.fetch(new Request('https://api.example/api/items' + query, {
      headers: { Origin: origin, Authorization: 'Bearer ' + idToken }
    }), environment);
    const body = await response.json();
    return { response, body };
  };
  try {
    const expected = entries.filter(row => row.user_id === 'user-a')
      .sort((a, b) => a.rank - b.rank || b.created.localeCompare(a.created) || a.id.localeCompare(b.id))
      .map(row => row.id);
    const actual = [];
    for (const [offset, size] of [[0, 100], [100, 100], [200, 52], [300, 0]]) {
      const { response, body } = await requestPage('?offset=' + offset);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
      assert.equal(body.items.length, size);
      assert.ok(Number(response.headers.get('Content-Length') || 0) <= 2097152);
      actual.push(...body.items.map(item => item.id));
    }
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, 252);
    assert.deepEqual(
      (await requestPage('')).body.items.map(item => item.id),
      expected.slice(0, 100),
      'Missing offset defaults to zero'
    );
    for (const query of [
      '?offset=-1', '?offset=1.5', '?offset=abc', '?offset=01',
      '?offset=9007199254740992', '?offset=0&offset=100', '?offset='
    ]) {
      const { response, body } = await requestPage(query);
      assert.equal(response.status, 400, query);
      assert.equal(body.error, 'invalid_offset', query);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
