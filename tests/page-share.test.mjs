import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const bookmarkletMatch = /^const bookmarklet=("[^\n]*");$/m.exec(source);
const shareFunctionMatch = /function receivePageShare\(\)\{[\s\S]*?\n\}/.exec(source);

test('browser bookmark sends page title and URL without a server crawler', () => {
  assert.ok(bookmarkletMatch, 'Bookmarklet must be installed by app.js');
  const href = JSON.parse(bookmarkletMatch[1]);
  assert.ok(href.startsWith('javascript:'));
  const opened = [];
  runInNewContext(href.slice('javascript:'.length), {
    document: { title: '소녀전선2 게시글 제목 - 아카라이브' },
    location: { href: 'https://arca.live/b/gilrsfrontline2exili/185523737' },
    window: { open: (...args) => opened.push(args) },
    JSON,
    encodeURIComponent
  });
  assert.equal(opened.length, 1);
  assert.equal(opened[0][1], '_blank');
  assert.equal(opened[0][2], 'noopener');
  const openedUrl = new URL(opened[0][0]);
  assert.equal(openedUrl.origin, 'https://flowergorge.github.io');
  const payload = JSON.parse(decodeURIComponent(openedUrl.hash.slice('#share='.length)));
  assert.equal(payload.title, '소녀전선2 게시글 제목 - 아카라이브');
  assert.equal(payload.url, 'https://arca.live/b/gilrsfrontline2exili/185523737');
});

test('share fragment fills capture and is removed from the address bar', () => {
  assert.ok(shareFunctionMatch, 'Share-fragment receiver must exist');
  const payload = { title: '테스트 제목', url: 'https://arca.live/b/gilrsfrontline2exili/185523737' };
  const capture = { value: '' };
  const location = { hash: '#share=' + encodeURIComponent(JSON.stringify(payload)), pathname: '/moadoogi/', search: '' };
  const replacements = [];
  const messages = [];
  const context = {
    location, receivedPageShare: null,
    safeUrl: value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } },
    $: () => capture, updateCapture: () => {}, toast: message => messages.push(message),
    history: { state: null, replaceState: (...args) => replacements.push(args) },
    JSON, decodeURIComponent
  };
  runInNewContext(shareFunctionMatch[0] + '\nreceivePageShare()', context);
  assert.equal(capture.value, payload.title + '\n' + payload.url);
  assert.equal(context.receivedPageShare.title, payload.title);
  assert.equal(replacements[0][2], '/moadoogi/');
  assert.match(messages[0], /제목과 주소/);
});
