import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { buildShareItem } from '../mobile-core.mjs';
const source=readFileSync(new URL('../bilibili.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function setup(){
  const elements=[];
  const document={createElement(tag){const node={tag,children:[],setAttribute(){},append(...args){this.children.push(...args)}};elements.push(node);return node}};
  const window={};runInNewContext(source,{window,document,URL,Map,Date,Promise});
  return {...window.MoadoogiBilibili,elements};
}
test('web and Android shares add Bilibili tag for official and short links only',()=>{
  const functions=app.match(/function typeOf\(url\).*$/m)[0]+'\n'+app.match(/function automaticTag\(url\).*$/m)[0];
  for(const url of ['https://www.bilibili.com/video/BV17x411w7KC','https://m.bilibili.com/video/av170001','https://b23.tv/abc']){
    assert.equal(runInNewContext(functions+'\nautomaticTag(url)',{URL,url}),'비리비리');
    assert.deepEqual(buildShareItem({id:'test',text:url}).tags,['비리비리']);
  }
  assert.deepEqual(buildShareItem({id:'test',text:'https://bilibili.com.evil.test/video/av1'}).tags,['웹사이트']);
});
test('metadata requests are shared and failed requests do not throw or flood retries',async()=>{
  const ui=setup();let calls=0;
  const load=async()=>{calls++;return {thumbnail:'https://i0.hdslb.com/cover.jpg'}};
  await Promise.all([ui.metadata('a',load),ui.metadata('a',load)]);assert.equal(calls,1);
  const fail=async()=>{calls++;throw Error('412')};
  await ui.metadata('b',fail);await ui.metadata('b',fail);assert.equal(calls,2);
});
test('thumbnail replaces fallback only on load, uses no referrer, and restores on error',async()=>{
  const ui=setup(),placeholder={isConnected:true,replaceWith(frame){this.frame=frame}};
  await ui.mount(placeholder,'https://www.bilibili.com/video/av1',async()=>({thumbnail:'https://i0.hdslb.com/cover.jpg'}));
  const image=ui.elements.find(x=>x.tag==='img');assert.equal(placeholder.frame,undefined);assert.equal(image.referrerPolicy,'no-referrer');
  image.onload();assert.equal(placeholder.frame.className,'bilibili-preview-box');
  placeholder.frame.isConnected=true;placeholder.frame.replaceWith=node=>{assert.equal(node,placeholder)};image.onerror();
});
test('late results, failed metadata and untrusted images keep the original preview',async()=>{
  const ui=setup();
  await ui.mount({isConnected:false},'a',async()=>({thumbnail:'https://i0.hdslb.com/a.jpg'}));
  await ui.mount({isConnected:true},'b',async()=>{throw Error('412')});
  await ui.mount({isConnected:true},'c',async()=>({thumbnail:'https://evil.test/a.jpg'}));
  assert.equal(ui.elements.length,0);
});
