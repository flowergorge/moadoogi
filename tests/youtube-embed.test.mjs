import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../theme.css',import.meta.url),'utf8');
const logic=app.match(/function stopYoutubeInline\(\)\{[\s\S]*?(?=function render\(\))/)?.[0];
function setup(fail=false){
  const classes=new Set(),slot={elements:[],append(value){this.elements.push(value)}},box={isConnected:true,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}};
  let player;
  class Player{
    constructor(iframe,options){if(fail)throw Error('blocked');Object.assign(this,{iframe,options,destroyed:false});player=this}
    destroy(){this.destroyed=true}
  }
  const context={window:{YT:{Player}},location:{origin:'https://flowergorge.github.io'},$:id=>({'youtube-player-box':box,'youtube-embed-slot':slot}[id]),document:{createElement:tag=>({tag,remove(){this.removed=true}})},setTimeout:()=>1,clearTimeout:()=>{},Promise,encodeURIComponent};
  runInNewContext('let youtubeApiPromise=null,youtubePlayer=null,youtubePreviewEpoch=0;\n'+logic,context);
  return{context,classes,slot,get player(){return player}};
}
test('YouTube is inline instead of a popup',()=>{
  assert.match(app,/function showYoutubeInline\(id\)/);
  assert.match(app,/class="youtube-poster"/);
  assert.match(css,/\.youtube-player-box\.has-player \.youtube-poster\{display:none\}/);
  assert.doesNotMatch(html,/id="youtube-dialog"/);
});
test('YouTube player appears only after onReady',async()=>{
  assert.ok(logic);
  const h=setup();
  await runInNewContext('showYoutubeInline("M7lc1UVf-VE")',h.context);
  assert.equal(h.slot.elements.length,1);
  assert.equal(h.classes.has('has-player'),false);
  assert.equal(h.player.iframe.referrerPolicy,'strict-origin-when-cross-origin');
  assert.equal(h.player.iframe.src,'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?enablejsapi=1&playsinline=1&origin=https%3A%2F%2Fflowergorge.github.io');
  h.player.options.events.onReady();
  assert.equal(h.classes.has('has-player'),true);
});
test('YouTube error restores poster and switching scrap stops player',async()=>{
  const h=setup();
  await runInNewContext('showYoutubeInline("M7lc1UVf-VE")',h.context);
  h.player.options.events.onReady();
  h.player.options.events.onError({data:150});
  assert.equal(h.classes.has('has-player'),false);
  assert.equal(h.player.destroyed,true);
  const next=setup();
  await runInNewContext('showYoutubeInline("M7lc1UVf-VE")',next.context);
  runInNewContext('stopYoutubeInline()',next.context);
  assert.equal(next.player.destroyed,true);
  next.player.options.events.onReady();
  assert.equal(next.classes.has('has-player'),false);
});
test('Invalid ID and player constructor failure leave thumbnail',async()=>{
  const invalid=setup();
  await runInNewContext('showYoutubeInline("<bad>")',invalid.context);
  assert.equal(invalid.slot.elements.length,0);
  const failed=setup(true);
  await runInNewContext('showYoutubeInline("M7lc1UVf-VE")',failed.context);
  assert.equal(failed.classes.has('has-player'),false);
  assert.match(app,/class="youtube-poster" href="\$\{escapeHtml\(url\)\}"/);
});
