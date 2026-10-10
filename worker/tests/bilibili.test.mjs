import test from 'node:test';
import assert from 'node:assert/strict';
import { bilibiliVideo, bilibiliThumbnail, getBilibiliMetadata } from '../src/index.js';
const url='https://www.bilibili.com/video/BV17x411w7KC/';
const pic='https://i0.hdslb.com/bfs/archive/cover.jpg';
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const html=body=>new Response(body,{headers:{'Content-Type':'text/html'}});
test('Bilibili BV/av links parse strictly; unsafe URLs and misleading hosts are rejected',()=>{
  assert.deepEqual(bilibiliVideo(url+'?p=2'),{key:'bvid',id:'BV17x411w7KC'});
  assert.deepEqual(bilibiliVideo('https://m.bilibili.com/video/av170001'),{key:'aid',id:'170001'});
  for(const value of ['https://bilibili.com.evil.test/video/BV17x411w7KC','https://bilibili.com/','https://bilibili.com/video/BV17x411w7KCevil','https://u:p@bilibili.com/video/av1'])assert.equal(bilibiliVideo(value),null);
  assert.equal(bilibiliThumbnail('//i0.hdslb.com/a.jpg'),'https://i0.hdslb.com/a.jpg');
  for(const value of ['https://evil.test/a.jpg','https://i0.hdslb.com.evil.test/a','https://u:p@i0.hdslb.com/a','data:image/png,x'])assert.equal(bilibiliThumbnail(value),'');
});
test('public video API yields title and original CDN address without fetching image bytes',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async u=>{calls.push(u);return json({code:0,data:{title:'테스트 &amp; 영상',pic,owner:{name:'제작자'}}})});
  assert.deepEqual(await getBilibiliMetadata(new URL(url)),{title:'테스트 & 영상',thumbnail:pic,author:'제작자'});
  assert.equal(calls.length,1);assert.match(calls[0],/^https:\/\/api\.bilibili\.com\/x\/web-interface\/view\?bvid=/);
});
test('b23 shares resolve to video API, while malicious redirects are never followed',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async u=>{calls.push(u);return u.includes('b23.tv')?new Response(null,{status:302,headers:{Location:url}}):json({code:0,data:{title:'영상',pic}})});
  assert.equal((await getBilibiliMetadata(new URL('https://b23.tv/example'))).thumbnail,pic);
  assert.equal(calls.length,2);
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});
  await assert.rejects(getBilibiliMetadata(new URL('https://b23.tv/evil')));
  globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://example.com/'}});
  await assert.rejects(getBilibiliMetadata(new URL('https://b23.tv/evil')));
});
test('blocked API uses page metadata; unavailable videos fail safely; non-video pages get no video image',async t=>{
  t.mock.method(globalThis,'fetch',async u=>u.includes('api.bilibili.com')?new Response('',{status:412}):html(`<title>페이지 제목</title><meta property="og:image" content="${pic}">`));
  assert.deepEqual(await getBilibiliMetadata(new URL(url)),{title:'페이지 제목',thumbnail:pic});
  assert.deepEqual(await getBilibiliMetadata(new URL('https://www.bilibili.com/')),{title:'페이지 제목'});
  globalThis.fetch=async()=>new Response('',{status:412});
  await assert.rejects(getBilibiliMetadata(new URL(url)));
});
