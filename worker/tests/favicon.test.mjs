import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFaviconUrl, extractHtmlMetadata } from '../src/index.js';

test('favicon discovery handles relative paths, redirect destination, entities and shortcut rel',()=>{
  assert.equal(extractFaviconUrl('<link href="../icon.png?a=1&amp;b=2" rel="shortcut icon">','https://example.com/posts/article'),'https://example.com/icon.png?a=1&b=2');
  assert.equal(extractFaviconUrl('<LINK REL="ICON" HREF="icon.png">','https://redirected.example.com/folder/post'),'https://redirected.example.com/folder/icon.png');
});
test('declared base and higher-quality icons are respected',()=>{
  const html='<base href="https://cdn.example.com/assets/"><link rel="apple-touch-icon" href="apple.png" sizes="180x180"><link rel="icon" href="small.png" sizes="16x16"><link rel="icon" href="large.png" sizes="64x64">';
  assert.equal(extractFaviconUrl(html,'https://example.com/'),'https://cdn.example.com/assets/large.png');
  assert.equal(extractFaviconUrl(html+'<link rel="icon" href="vector.svg" type="image/svg+xml">','https://example.com/'),'https://cdn.example.com/assets/vector.svg');
});
test('unsafe favicon URLs are rejected and comments/scripts are not icons',()=>{
  const refs=['http://example.com/a.png','javascript:alert(1)','data:image/png;base64,abc','https://127.0.0.1/icon','https://[::1]/icon','https://user:pass@example.com/icon','https://example.com:8080/icon','https://host.internal/icon'];
  for(const href of refs)assert.equal(extractFaviconUrl(`<link rel="icon" href="${href}">`,'https://example.com/'),'');
  assert.equal(extractFaviconUrl('<!-- <link rel="icon" href="/fake.png"> --><script>"<link rel=icon href=/also-fake.png>"</script>','https://example.com/'),'');
});
test('metadata returns the icon address without fetching image content; old calls stay compatible',()=>{
  assert.deepEqual(extractHtmlMetadata('<title>Article</title>'),{title:'Article'});
  assert.deepEqual(extractHtmlMetadata('<title>Article</title><link rel="icon" href="/site.png">','https://example.com/post'),{title:'Article',favicon:'https://example.com/site.png'});
  assert.equal(extractFaviconUrl('<link rel=stylesheet href=/main.css>','https://example.com/'),'');
});
