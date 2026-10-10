/* Original-site image URLs only. No image proxy, binary download, or server storage. */
(() => {
'use strict';
const known=new Map(),probes=new Map(),discoveries=new Map(),mounts=new Set();
let lookupWindow=0,lookupCount=0;
const TTL=10*60*1000;
function publicIcon(value){
  try{
    if(typeof value!=='string'||value.length>4096)return '';
    const u=new URL(value),host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return '';
    if(!host.includes('.')||host.startsWith('[')||/^[\d.]+$/.test(host)||!/^[a-z0-9.-]+$/.test(host))return '';
    if(/(?:^|\.)(?:localhost|local|lan|internal|intranet|home|corp|localdomain|onion|test|invalid|arpa)$/.test(host)||/(?:^|\.)(?:localhost|metadata|instance-data)(?:\.|$)/.test(host))return '';
    return u.href;
  }catch{return ''}
}
function rootIcon(page){
  try{const u=new URL(page);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return '';u.protocol='https:';return publicIcon(new URL('/favicon.ico',u).href)}catch{return ''}
}
function put(map,key,value){if(map.size>=256&&!map.has(key))map.delete(map.keys().next().value);map.set(key,value)}
function probe(url){
  const old=probes.get(url);if(old&&Date.now()-old.at<TTL)return old.promise;
  const promise=new Promise(resolve=>{
    const img=new Image();let finished=false;
    const done=value=>{if(finished)return;finished=true;clearTimeout(timer);img.onload=img.onerror=null;resolve(value)};
    const timer=setTimeout(()=>done(null),7000);
    img.referrerPolicy='no-referrer';img.decoding='async';
    img.onload=()=>done(img.naturalWidth>0&&img.naturalHeight>0?{url,width:img.naturalWidth,height:img.naturalHeight}:null);
    img.onerror=()=>done(null);img.src=url;
  });
  put(probes,url,{at:Date.now(),promise});return promise;
}
async function paint(state){
  const revision=++state.revision;
  const candidates=[...new Set([known.get(state.page),rootIcon(state.page)].filter(Boolean))];
  for(const url of candidates){
    const result=await probe(url);
    if(revision!==state.revision||!state.element.isConnected)return;
    if(!result)continue;
    const img=new Image();img.alt='';img.className='website-favicon';img.referrerPolicy='no-referrer';img.decoding='async';
    img.style.setProperty('--favicon-size',Math.min(64,Math.max(24,Math.min(result.width,result.height)))+'px');
    // Keep the original arrow until this exact DOM image has loaded successfully.
    img.onload=()=>{
      if(revision!==state.revision||!state.element.isConnected)return;
      state.element.replaceChildren(img);state.element.classList.add('has-favicon');state.onLoad?.();
    };
    img.onerror=()=>{
      if(revision!==state.revision||!state.element.isConnected)return;
      state.element.textContent='↗';state.element.classList.remove('has-favicon');state.onError?.();
    };
    img.src=result.url;return;
  }
}
function remember(page,value){
  const url=publicIcon(value);if(!rootIcon(page)||!url||known.get(page)===url)return;
  put(known,page,url);
  for(const state of mounts){if(!state.element.isConnected)mounts.delete(state);else if(state.page===page)void paint(state)}
}
function mount(element,page,options={}){
  if(!element||!rootIcon(page))return;
  for(const state of mounts)if(!state.element.isConnected||state.element===element){state.revision++;mounts.delete(state)}
  const state={element,page,revision:0,...options};mounts.add(state);void paint(state);
}
async function discover(page,loader){
  if(!rootIcon(page)||typeof loader!=='function'||known.has(page))return;
  const now=Date.now();if(now-(discoveries.get(page)||0)<TTL)return;
  if(now-lookupWindow>=60000){lookupWindow=now;lookupCount=0}
  // Leave headroom in the shared 15/min metadata endpoint for newly saved links.
  if(lookupCount>=6)return;lookupCount++;put(discoveries,page,now);
  try{const data=await loader(page);remember(page,data?.favicon)}catch{/* Keep the existing display. */}
}
window.MoadoogiFavicons={mount,remember,discover,publicIcon,rootIcon};
})();
