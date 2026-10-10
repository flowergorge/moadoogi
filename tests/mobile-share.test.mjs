import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShareFragment, buildShareItem } from '../mobile-core.mjs';
const id = 'aa6bb573-772a-4a33-aaf3-7da8fb978adf';
const parse = data => parseShareFragment('#share=' + encodeURIComponent(JSON.stringify({ id, ...data })));

test('Chrome shares preserve the supplied title, URL, and one stable item id', () => {
  const data = parse({ text: 'https://github.com/twostraws/SwiftUI-Agent-Skill', title: 'SwiftUI Agent Skill' });
  const item = buildShareItem(data);
  assert.equal(item.id, 'android-' + id);
  assert.equal(item.title, 'SwiftUI Agent Skill');
  assert.equal(item.note, '');
  assert.deepEqual(item.tags, ['깃허브']);
  assert.ok(Math.abs(item.rank) <= 1e12, 'must obey Worker rank bounds');
  assert.equal(item.status, '관심');
});
test('Korean text-only shares remain intact; HTML is data', () => {
  const text = '퇴근하고 확인하기\n<img src=x onerror=alert(1)>';
  const item = buildShareItem(parse({ text }));
  assert.equal(item.url, '');
  assert.equal(item.note, text);
  assert.deepEqual(item.tags, []);
});
test('URL plus description keeps the note and automatic tag', () => {
  const item = buildShareItem(parse({ text: '재밌는 영상\nhttps://youtu.be/abcdefghijk' }));
  assert.equal(item.note, '재밌는 영상');
  assert.equal(item.url, 'https://youtu.be/abcdefghijk');
  assert.deepEqual(item.tags, ['유튜브']);
});
test('credential URLs never become navigable scrap links', () => {
  const item = buildShareItem(parse({ text: 'https://user:password@example.com/a' }));
  assert.equal(item.url, '');
  assert.equal(item.note, 'https://user:password@example.com/a');
});
test('invalid share payloads and oversize UTF-8 records are rejected, never silently cut', () => {
  assert.throws(() => parse({ text: '' }));
  assert.throws(() => parseShareFragment('#share=%xx'));
  assert.throws(() => buildShareItem(parse({ text: '가'.repeat(4500) })), /용량/);
  assert.throws(() => buildShareItem(parse({ text: 'a'.repeat(5001) })), /5,000/);
  assert.equal(parseShareFragment(''), null);
});
