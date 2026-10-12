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

test('separate source URL preserves the selected quote and unrelated embedded links', () => {
  const text = '참고 링크 https://other.example/article 와 선택한 문장';
  const item = buildShareItem(parse({text, sourceUrl:'https://example.com/source'}));
  assert.equal(item.url,'https://example.com/source');assert.equal(item.note,text);
  const quote=buildShareItem(parse({text:'선택한 문장',title:'선택한 문장'}));
  assert.equal(quote.note,'선택한 문장');
});
test('explicit source rejects non-web and credential links without discarding selected text', () => {
  for(const sourceUrl of ['javascript:alert(1)','content://private/item','android-app://browser','https://user:pass@example.com/']){
    const item=buildShareItem(parse({text:'선택한 문장',sourceUrl}));assert.equal(item.url,'');assert.equal(item.note,'선택한 문장');
  }
});

test('X enrichment applies only real post metadata and fits within the UTF-8 item limit', async () => {
  const { xPostAuthor, withShareMetadata, assertItemSize } = await import('../mobile-core.mjs');
  assert.equal(xPostAuthor('https://www.twitter.com/flower/status/12345/photo/1'),'@flower');
  assert.equal(xPostAuthor('https://x.com/i/status/12345'),'X 게시물');
  for(const url of ['https://x.com/home','https://x.com/flower','https://x.com/flower/status/abc','https://evil.example/flower/status/12345'])assert.equal(xPostAuthor(url),'');
  const item=buildShareItem(parse({text:'공유 본문 https://x.com/flower/status/12345',title:'X에서 공유'}));
  assert.equal(item.title,'@flower');
  const missing=withShareMetadata(item,{title:'본문 제목만 있음'});
  assert.equal(missing.title,'@flower');assert.equal(missing.note,'공유 본문');
  const tooBig=withShareMetadata(item,{author:'작성자',text:'가'.repeat(5000)});
  assert.equal(tooBig.title,'작성자');assert.equal(tooBig.note,'공유 본문');assertItemSize(tooBig);
});
