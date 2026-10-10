(() => {
'use strict';
const cache=new Map();
let discoveries=[];
function thumbnail(value){
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.endsWith('.hdslb.com'))return '';
    return u.href;
  }catch{return ''}
}
function metadata(url,loader){
  const hit=cache.get(url);
  if(hit&&hit.until>Date.now())return hit.promise;
  const entry={until:Date.now()+60000};
  entry.promise=Promise.resolve().then(()=>loader(url)).then(data=>{
    entry.until=Date.now()+600000;return data||{};
  }).catch(()=>({}));
  cache.set(url,entry);
  if(cache.size>100)cache.delete(cache.keys().next().value);
  return entry.promise;
}
async function mount(placeholder,url,loader){
  if(!placeholder)return;
  if(!cache.has(url)){
    discoveries=discoveries.filter(time=>time>Date.now()-60000);
    if(discoveries.length>=6)return;
    discoveries.push(Date.now());
  }
  const data=await metadata(url,loader);
  if(!placeholder.isConnected)return;
  const src=thumbnail(data.thumbnail);
  if(!src)return;
  const frame=document.createElement('a'),image=document.createElement('img'),action=document.createElement('span');
  frame.className='bilibili-preview-box';frame.href=url;frame.target='_blank';frame.rel='noopener noreferrer';
  frame.setAttribute('aria-label','비리비리에서 원본 영상 열기');
  image.alt='비리비리 영상 썸네일';image.referrerPolicy='no-referrer';
  image.onload=()=>{if(placeholder.isConnected)placeholder.replaceWith(frame)};
  image.onerror=()=>{if(frame.isConnected)frame.replaceWith(placeholder)};
  action.className='bilibili-preview-action';action.textContent='▶ 비리비리에서 보기 ↗';
  frame.append(image,action);
  image.src=src;
}
window.MoadoogiBilibili={metadata,mount,thumbnail};
})();
