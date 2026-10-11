import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as core from '../mobile-core.mjs';

const source = fs.readFileSync(new URL('../mobile-client.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\n/, '')
  .replace("import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js')", 'Promise.resolve(mockFirebase)')
  .replace("import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js')", 'Promise.resolve(mockAuth)');
const id = 'aa6bb573-772a-4a33-aaf3-7da8fb978adf';
function storage(map = new Map()) {
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
}
async function page({ text, title = '', session = storage(), initialUid = null, response, tagResponse }  = {}) {
  const elements = new Map(), calls = [], tagCalls = [];
  function node() { return { value: '', hidden: false, disabled: false, textContent: '', children: [], attrs: {}, classList: { toggle() {} }, events: {}, setAttribute(k,v) { this.attrs[k]=v; }, replaceChildren(...children) { this.children=children; }, append(...children) { this.children.push(...children); }, addEventListener(type, callback) { this.events[type] = callback; } }; }
  function element(id) {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  }
  let changed;
  function user(uid) { return uid ? { uid, displayName: uid, email: uid + '@example.test', getIdToken: async () => 'mock-token' } : null; }
  const auth = { currentUser: user(initialUid) };
  const mockAuth = {
    getAuth: () => auth, setPersistence: async () => {}, browserLocalPersistence: 'local',
    onAuthStateChanged: (_, cb) => { changed = cb; cb(auth.currentUser); },
    GoogleAuthProvider: class { setCustomParameters() {} },
    signInWithPopup: async () => { auth.currentUser = user(auth.currentUser ? 'b' : 'a'); changed(auth.currentUser); },
    signOut: async () => { auth.currentUser = null; changed(null); }
  };
  const location = { search: text === undefined ? '' : '?capture=1', pathname: '/mobile.html', hash: text === undefined ? '' : '#share=' + encodeURIComponent(JSON.stringify({ id, text, title })) };
  const context = { ...core, URLSearchParams, URL, JSON, Promise, Error, TypeError, AbortSignal, location, sessionStorage: session,
    history: { replaceState: () => { location.hash = ''; } },
    document: { getElementById: element, createElement: node }, mockAuth, mockFirebase: { initializeApp: () => ({}) },
    window: { MOADOOGI_CONFIG: { apiBase: 'https://api.example.test', firebase: {} } },
    fetch: async (url, options) => { if (url.endsWith('/api/tags')) { tagCalls.push({url,...options}); return tagResponse ? tagResponse(url,options) : {ok:true,status:200,json:async()=>({tags:['내태그']})}; } calls.push({ url, ...options }); return response ? response(url, options, calls) : { ok: true, status: 200, json: async () => ({ ok: true, title: '조회된 제목' }) }; }
  };
  await vm.runInNewContext('(async()=>{\n' + source + '\n})()', context);
  return { element, calls, tagCalls, session, location, click: id => element(id).events.click(), setUser: uid => { auth.currentUser = user(uid); changed(auth.currentUser); } };
}
test('share requires explicit save; popup login updates account; metadata and save succeed', async () => {
  const app = await page({ text: 'https://example.com/article' });
  assert.equal(app.location.hash, '');
  assert.equal(app.calls.length, 0);
  assert.equal(app.element('login').hidden, false);
  await app.click('login');
  assert.equal(app.element('save').hidden, false);
  assert.match(app.element('status').textContent, /저장/);
  await app.click('save');
  assert.equal(app.calls.length, 2);
  assert.equal(app.element('success').hidden, false);
  const body = JSON.parse(app.calls[1].body);
  assert.equal(body.changes[0].item.title, '조회된 제목');
  await app.click('save');
  assert.equal(app.calls.length, 2);
});
test('uncertain response can be retried with the exact same item without a second metadata fetch', async () => {
  let posts = 0;
  const app = await page({ text: 'https://example.com', initialUid: 'a', response: async (url, options) => {
    if (options.method === 'POST' && ++posts === 1) throw new TypeError('network');
    return { ok: true, status: 200, json: async () => ({ ok: true, title: '제목' }) };
  } });
  await app.click('save');
  assert.equal(app.element('success').hidden, true);
  await app.click('save');
  assert.equal(app.element('success').hidden, false);
  assert.equal(app.calls.length, 3);
  assert.equal(app.calls[1].body, app.calls[2].body);
});
test('failed share cannot be sent to another account', async () => {
  const app = await page({ text: '메모', initialUid: 'a', response: async () => { throw new TypeError('network'); } });
  await app.click('save');
  app.setUser('b');
  await app.click('save');
  assert.equal(app.calls.length, 1);
  assert.match(app.element('status').textContent, /처음 저장/);
});
test('metadata failure preserves share, account page supports change and logout', async () => {
  const app = await page({ text: '글 내용 https://arca.live/b/test/1', initialUid: 'a', response: async (url, options) => ({ ok: !!options.method, status: options.method ? 200 : 502, json: async () => ({ ok: true }) }) });
  await app.click('save');
  assert.equal(app.element('success').hidden, false);
  assert.equal(JSON.parse(app.calls.at(-1).body).changes[0].item.note, '글 내용');
  const account = await page({ initialUid: 'a' });
  assert.equal(account.element('account-panel').hidden, false);
  assert.equal(account.element('capture-panel').hidden, true);
  await account.click('switch');
  assert.equal(account.element('account-email').textContent, 'b@example.test');
  await account.click('logout');
  assert.equal(account.element('login').hidden, false);
});
test('expired ID token is refreshed; double-click while saving sends only once', async () => {
  let complete;
  const waiting = new Promise(resolve => { complete = resolve; });
  const app = await page({ text: '메모', initialUid: 'a', response: async (url, options, calls) => {
    if (calls.length === 1) return { ok: false, status: 401, json: async () => ({}) };
    await waiting;
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  } });
  const saving = app.click('save');
  await app.click('save');
  complete(); await saving;
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[0].body, app.calls[1].body);
  assert.equal(app.element('success').hidden, false);
});
test('corrupt old draft does not prevent a new share; completed draft cannot save again', async () => {
  const session = storage(new Map([['moadoogi-android-share-v1', 'broken']]));
  const app = await page({ text: '메모', initialUid: 'a', session });
  await app.click('save');
  const reopened = await page({ text: '메모', initialUid: 'a', session });
  assert.equal(reopened.element('success').hidden, false);
  await reopened.click('save');
  assert.equal(reopened.calls.length, 0);
});

test('recommended and typed tags plus a supplied source are included in the saved item',async()=>{
  const app=await page({text:'선택한 문장',initialUid:'a'});
  await new Promise(setImmediate);
  assert.equal(app.tagCalls.length,1);
  const recommended=app.element('suggested-tags').children;
  assert.ok(recommended.some(x=>x.textContent.includes('내태그')));
  recommended.find(x=>x.textContent.includes('쇼핑')).events.click();
  app.element('source-url').value='https://example.com/product';
  app.element('source-url').events.input();app.element('source-url').events.change();
  app.element('tag-input').value='#장바구니, 선물';app.element('tag-input').events.input();
  await app.click('save');
  const item=JSON.parse(app.calls.at(-1).body).changes[0].item;
  assert.deepEqual(item.tags,['쇼핑','웹사이트','장바구니','선물']);assert.equal(item.url,'https://example.com/product');assert.equal(item.note,'선택한 문장');
});
test('invalid source blocks writes; failed-save retries freeze tags and preserve the request',async()=>{
  let posts=0;
  const app=await page({text:'메모',initialUid:'a',response:async(url,options)=>{
    if(options.method==='POST'&&++posts===1)throw new TypeError('network');
    return {ok:true,status:200,json:async()=>({ok:true})};
  }});
  app.element('source-url').value='javascript:alert(1)';await app.click('save');assert.equal(app.calls.length,0);
  app.element('source-url').value='';app.element('tag-input').value='쇼핑';await app.click('tag-add');
  await app.click('save');assert.equal(app.element('capture-options').disabled,true);
  app.element('suggested-tags').children.find(x=>x.textContent.includes('게임')).events.click();
  await app.click('save');assert.equal(app.calls[0].body,app.calls[1].body);
});
test('old-account recommendations are ignored after account changes, network failures keep defaults',async()=>{
  let finishA;
  const pendingA=new Promise(resolve=>{finishA=resolve});
  const app=await page({text:'메모',initialUid:'a',tagResponse:async()=>pendingA});
  app.setUser(null);finishA({ok:true,status:200,json:async()=>({tags:['계정A비공개태그']})});
  await new Promise(setImmediate);
  assert.ok(!app.element('suggested-tags').children.some(x=>x.textContent.includes('계정A')));
  const failed=await page({text:'메모',initialUid:'b',tagResponse:async()=>{throw new TypeError('network')}});
  await new Promise(setImmediate);
  assert.ok(failed.element('suggested-tags').children.some(x=>x.textContent.includes('쇼핑')));
});
test('draft tag text and source survive reopening before saving and recommendation toggles are reversible',async()=>{
  const app=await page({text:'메모',initialUid:'a'});
  app.element('source-url').value='https://example.com/source';app.element('source-url').events.input();
  app.element('tag-input').value='나의태그';app.element('tag-input').events.input();
  const next=await page({text:'메모',initialUid:'a',session:app.session});
  assert.equal(next.element('source-url').value,'https://example.com/source');assert.equal(next.element('tag-input').value,'나의태그');
  const shopping=()=>next.element('suggested-tags').children.find(x=>x.textContent.includes('쇼핑'));
  shopping().events.click();assert.equal(shopping().attrs['aria-pressed'],'true');
  shopping().events.click();assert.equal(shopping().attrs['aria-pressed'],'false');
});
