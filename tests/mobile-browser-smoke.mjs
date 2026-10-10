// Run with PLAYWRIGHT_MODULE and CHROME_PATH when not installed locally.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..');
const server = http.createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox'] });
const authMock = `
const stored=localStorage.getItem('test-user');
function make(uid){return uid?{uid,displayName:uid==='a'?'테스트 계정':'다른 계정',email:uid+'@example.test',getIdToken:async()=> 'mock-token-'+uid}:null}
const auth={currentUser:make(stored)};let callback;
export function getAuth(){return auth}
export const browserLocalPersistence='local';
export async function setPersistence(){}
export function onAuthStateChanged(_,cb){callback=cb;cb(auth.currentUser)}
window.setTestUser=uid=>{auth.currentUser=make(uid);if(uid)localStorage.setItem('test-user',uid);else localStorage.removeItem('test-user');callback?.(auth.currentUser)};
export class GoogleAuthProvider{setCustomParameters(){}}
export async function signInWithPopup(){window.setTestUser(auth.currentUser?'b':'a');return {user:auth.currentUser}}
export async function signOut(){window.setTestUser(null)};
`;
let checks = 0;
async function setup() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await context.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ contentType: 'text/javascript', body: route.request().url().includes('firebase-auth') ? authMock : 'export function initializeApp(config){return config}' }));
  return { context, page, errors };
}
const share = (text, title = '') => base + '/mobile.html?capture=1#share=' + encodeURIComponent(JSON.stringify({ id: 'aa6bb573-772a-4a33-aaf3-7da8fb978adf', text, title }));
try {
  {
    const { context, page, errors } = await setup();
    const posts = [];
    await page.route('https://moadoogi-api.flowergorge.workers.dev/**', route => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postData());
        return route.fulfill({ status: posts.length === 1 ? 503 : 200, contentType: 'application/json', body: posts.length === 1 ? '{"error":"internal_error"}' : '{"ok":true}' });
      }
      return route.fulfill({ contentType: 'application/json', body: '{"title":"GitHub 프로젝트"}' });
    });
    await page.goto(share('https://github.com/twostraws/SwiftUI-Agent-Skill'));
    await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(posts.length, 0);
    await page.click('#login');
    await page.locator('#save').waitFor({ state: 'visible' });
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: process.env.SCREENSHOT_DIR + '/share-ready.png' });
    await page.click('#save');
    await page.locator('#status.error').waitFor();
    await page.click('#save');
    await page.locator('#success').waitFor({ state: 'visible' });
    assert.equal(posts.length, 2);
    assert.equal(posts[0], posts[1], 'retry must preserve exact request body');
    assert.equal(JSON.parse(posts[1]).changes[0].item.title, 'GitHub 프로젝트');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: process.env.SCREENSHOT_DIR + '/share-saved.png' });
    await page.reload();
    await page.locator('#success').waitFor({ state: 'visible' });
    assert.equal(posts.length, 2, 'reload after success must not save again');
    assert.deepEqual(errors, []);
    checks++; await context.close();
  }
  {
    const { context, page, errors } = await setup();
    await page.goto(base + '/mobile.html');
    await page.click('#login');
    await page.locator('#logout').waitFor({ state: 'visible' });
    await page.reload();
    await page.locator('#logout').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#account-email').textContent(), 'a@example.test');
    await page.click('#switch');
    await page.waitForFunction(() => document.getElementById('account-email').textContent === 'b@example.test');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: process.env.SCREENSHOT_DIR + '/account.png' });
    await page.click('#logout');
    await page.locator('#login').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    checks++; await context.close();
  }
  {
    const { context, page, errors } = await setup();
    const posts = [];
    await page.route('https://moadoogi-api.flowergorge.workers.dev/**', route => {
      if (route.request().method() === 'POST') {
        posts.push(JSON.parse(route.request().postData()));
        return route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
    });
    await page.goto(share('<img src=x onerror=alert(1)>\nhttps://arca.live/b/test/1'));
    await page.click('#login');
    await page.click('#save');
    await page.locator('#success').waitFor({ state: 'visible' });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].changes[0].item.note, '<img src=x onerror=alert(1)>');
    assert.equal(await page.locator('.preview img').count(), 0);
    assert.deepEqual(errors, []);
    checks++; await context.close();
  }
  {
    const { context, page, errors } = await setup();
    let posts = 0;
    await page.route('https://moadoogi-api.flowergorge.workers.dev/**', route => { posts++; return route.abort(); });
    await page.goto(share('저장할 메모'));
    await page.click('#login');
    await page.click('#save');
    await page.locator('#status.error').waitFor();
    await page.evaluate(() => window.setTestUser('b'));
    await page.click('#save');
    assert.equal(posts, 1, 'failed share must never be retried into a different account');
    assert.match(await page.locator('#status').textContent(), /처음 저장/);
    assert.deepEqual(errors, []);
    checks++; await context.close();
  }
  console.log(`${checks} browser flows passed (mock auth/API; not a real-device OAuth test).`);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
