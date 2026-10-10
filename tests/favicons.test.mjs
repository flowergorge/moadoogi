import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../favicons.js',import.meta.url),'utf8');
const tick=()=>new Promise(setImmediate);
function setup(outcomes={}){
  const images=[],timers=new Map();let seq=0;
  class FakeImage{
    constructor(){this.style={setProperty(){}};images.push(this)}
    set src(value){this._src=value;queueMicrotask(()=>{
      const result=typeof outcomes[value]==='function'?outcomes[value](images.filter(x=>x._src===value).length):outcomes[value];
      if(result==='hang')return;
      if(result){this.naturalWidth=32;this.naturalHeight=32;this.onload?.()}
      else this.onerror?.();
    })}
    get src(){return this._src}
  }
  const window={};
  runInNewContext(source,{window,URL,Map,Set,Image:FakeImage,Date,setTimeout:fn=>{timers.set(++seq,fn);return seq},clearTimeout:id=>timers.delete(id)});
  const element=()=>({isConnected:true,textContent:'↗',classList:{add(){},remove(){}},replaceChildren(img){this.image=img;this.textContent=''}});
  return {...window.MoadoogiFavicons,images,timers,element};
}
test('general-site root icon displays only after load and sends no referrer',async()=>{
  const app=setup({'https://example.com/favicon.ico':true}),el=app.element();
  app.mount(el,'https://example.com/article');assert.equal(el.textContent,'↗');
  await tick();assert.equal(el.image.src,'https://example.com/favicon.ico');
  assert.ok(app.images.every(img=>img.referrerPolicy==='no-referrer'));
});
test('failed and timed-out images leave original arrow; failed probes are reused',async()=>{
  const app=setup(),a=app.element(),b=app.element();
  app.mount(a,'https://example.com/one');await tick();
  app.mount(b,'https://example.com/two');await tick();
  assert.equal(a.textContent,'↗');assert.equal(b.textContent,'↗');assert.equal(app.images.length,1);
  const slow=setup({'https://example.com/favicon.ico':'hang'}),el=slow.element();
  slow.mount(el,'https://example.com/');await tick();
  for(const fn of [...slow.timers.values()])fn();await tick();assert.equal(el.textContent,'↗');
});
test('declared site icon updates both mounted views; an invalid declared icon falls back to root',async()=>{
  const app=setup({'https://example.com/favicon.ico':true,'https://cdn.example.com/icon.svg':true});
  const a=app.element(),b=app.element(),page='https://example.com/post';
  app.mount(a,page);app.mount(b,page);await tick();
  app.remember(page,'https://cdn.example.com/icon.svg');await tick();
  assert.equal(a.image.src,'https://cdn.example.com/icon.svg');assert.equal(b.image.src,a.image.src);
  const other=setup({'https://example.com/favicon.ico':true}),el=other.element();
  other.remember(page,'https://cdn.example.com/missing.ico');other.mount(el,page);await tick();
  assert.equal(el.image.src,'https://example.com/favicon.ico');
});
test('detached views cannot be changed by late image responses',async()=>{
  const app=setup({'https://example.com/favicon.ico':true}),el=app.element();
  app.mount(el,'https://example.com/');el.isConnected=false;await tick();assert.equal(el.textContent,'↗');
});
test('only safe public HTTPS icon URLs are used',()=>{
  const app=setup();
  for(const value of ['javascript:alert(1)','data:image/svg+xml,abc','https://localhost/x','https://127.0.0.1/x','https://host.local/x','https://host.local./x','https://u:p@example.com/x','https://example.com:8443/x'])assert.equal(app.publicIcon(value),'');
  assert.equal(app.rootIcon('http://example.com/post'),'https://example.com/favicon.ico');
  assert.equal(app.rootIcon('https://127.0.0.1/post'),'');
});
test('metadata discovery is deduplicated and capped to preserve save request headroom',async()=>{
  const app=setup();let calls=0;
  const loader=async()=>{calls++;return {}};
  await Promise.all([app.discover('https://example.com/a',loader),app.discover('https://example.com/a',loader)]);
  assert.equal(calls,1);
  for(let i=0;i<10;i++)await app.discover('https://example.com/'+i,loader);
  assert.equal(calls,6);
});
