/* 모아두기 구글 로그인 / D1 동기화 브리지. 클라우드 미설정 시 로컬 모드 유지 */
(() => {
'use strict';
const cfg=window.MOADOOGI_CONFIG||{}, fb=cfg.firebase||{};
const base=String(cfg.apiBase||'').replace(/\/+$/,'');
const configured=base.startsWith('https://')&&['apiKey','authDomain','projectId','appId'].every(k=>fb[k]);
const $=id=>document.getElementById(id), pendingKey=uid=>'moadoogi-pending-v1:'+uid;
const copy=value=>JSON.parse(JSON.stringify(value));
function validBackupItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('올바르지 않은 백업 항목');
  const id=String(item.id||''),title=String(item.title||''),url=String(item.url||''),note=String(item.note||'');
  if(!id||id.length>160||!title||title.length>300||url.length>4096||note.length>5000)throw Error('백업의 ID·제목·메모 길이를 확인해 주세요');
  if(url){let u;try{u=new URL(url)}catch{throw Error('올바르지 않은 백업 링크')};if(!['http:','https:'].includes(u.protocol))throw Error('HTTP(S) 링크만 지원해요')}
  const created=typeof item.created==='string'&&Number.isFinite(Date.parse(item.created))?item.created:new Date().toISOString();
  const tags=Array.isArray(item.tags)?item.tags.filter(t=>typeof t==='string'&&t.length<=80).slice(0,24):[];
  return {id,title,url,note,tags,status:['관심','진행중','대기','완료','완성','미루기','포기'].includes(item.status)?item.status:'관심',date:/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')?item.date:'',created,rank:Number.isFinite(item.rank)?item.rank:0,starred:item.starred===true,autoTagsApplied:true};
}
const snap=items=>new Map(items.map(item=>[item.id,JSON.stringify(item)]));
let app,auth,authLib,user,ready=false,loading=false,flushing=false,epoch=0,lastPull=0,changeVersion=0;
let baseline=new Map(),pending=new Map(),flushTimer=null;
function status(message,mode='idle'){const el=$('cloud-status');if(el){el.textContent=message;el.dataset.state=mode}}
function describeCloudError(error){
  const known={
    key_service_unavailable:'구글 인증키 서버에 일시적으로 연결할 수 없어요',
    invalid_token:'로그인 인증이 유효하지 않아요. 재로그인해 주세요',
    authorization_required:'로그인 인증정보가 전달되지 않았어요',
    origin_forbidden:'웹앱 접속 주소가 서버에서 허용되지 않았어요',
    rate_limited:'요청이 너무 많아요. 잠시 후 다시 시도해 주세요',
    not_configured:'클라우드 서버 설정을 확인해야 해요',
    internal_error:'서버 내부 오류가 발생했어요'
  };
  if(known[error?.code])return known[error.code];
  if(error?.name==='TimeoutError'||error?.name==='AbortError')return '서버 응답 시간이 초과됐어요';
  if(error instanceof TypeError)return '인터넷 연결이나 서버 접속을 확인해 주세요';
  return '서버 응답 오류'+(error?.status?' ('+error.status+')':'');
}
function buttons(){
  $('cloud-login').hidden=!configured||!!user;
  $('cloud-logout').hidden=!user;
  $('cloud-refresh').hidden=!user;
  $('cloud-import').hidden=!ready||!app.readLocalRecords().length;
  $('cloud-user').textContent=user?(user.displayName||user.email||'구글 계정'):'';
}
function savePending(){if(user)try{localStorage.setItem(pendingKey(user.uid),JSON.stringify([...pending]))}catch{}}
function restorePending(){
  try{const items=JSON.parse(localStorage.getItem(pendingKey(user.uid))||'[]');pending=new Map(Array.isArray(items)?items:[])}
  catch{pending=new Map()}
}
async function api(path,options={}){
  if(!user)throw Error('구글 로그인이 필요해요.');
  const token=await user.getIdToken();
  const response=await fetch(base+path,{
    ...options,
    headers:{Authorization:'Bearer '+token,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},
    signal:options.signal||AbortSignal.timeout(15000)
  });
  let data={};try{data=await response.json()}catch{}
  if(!response.ok){
    const error=new Error(data.message||data.error||'서버 오류');
    error.code=data.error;
    error.status=response.status;
    throw error;
  }
  return data;
}
async function getAll(){
  const list=[];
  for(let i=0;i<100;i++){
    const data=await api('/api/items?offset='+(i*100));
    if(!Array.isArray(data.items))throw Error('스크랩 응답 오류');
    list.push(...data.items);
    if(data.items.length<100)return list;
  }
  throw Error('스크랩 목록이 너무 커요.');
}
function overlayPending(items){
  const byId=new Map(items.map(item=>[item.id,item]));
  for(const [id,c] of pending){if(c.op==='delete')byId.delete(id);else byId.set(id,c.item)}
  return [...byId.values()];
}
async function flush(){
  if(!ready||!user||flushing||!pending.size)return;
  flushing=true;const uid=user.uid;
  try{
    while(user?.uid===uid&&pending.size){
      // Worker 요청 제한(128 KB)을 넘지 않도록 변경 묶음 크기를 제한한다.
      const changes=[];let bytes=0;
      for(const change of pending.values()){
        const size=JSON.stringify(change).length*3;
        if(changes.length&&(changes.length>=20||bytes+size>100000))break;
        changes.push(change);bytes+=size;
      }
      await api('/api/sync',{method:'POST',body:JSON.stringify({changes})});
      if(user?.uid!==uid)return;
      for(const c of changes){
        if(JSON.stringify(pending.get(c.id))===JSON.stringify(c))pending.delete(c.id);
      }
      savePending();
    }
    status('✓ 동기화 완료','ok');
  }catch(error){status('동기화 대기 · '+describeCloudError(error),'error')}
  finally{flushing=false}
}
function queueFlush(){clearTimeout(flushTimer);flushTimer=setTimeout(()=>{void flush()},500)}
async function refresh(){
  if(!user||loading)return;
  loading=true;const generation=epoch,uid=user.uid;
  status('☁ 스크랩 불러오는 중','loading');
  try{
    if(ready){await flush();if(pending.size)return}
    const version=changeVersion,remote=await getAll();
    if(epoch!==generation||user?.uid!==uid)return;
    if(version!==changeVersion){queueFlush();return}
    const next=overlayPending(remote);
    app.replaceRecords(next);
    baseline=snap(next);ready=true;lastPull=Date.now();
    status(pending.size?'☁ 전송 대기 중':'✓ 동기화 완료','ok');buttons();
    if(pending.size)queueFlush();
  }catch(error){status('클라우드 연결 실패 · '+describeCloudError(error),'error')}
  finally{loading=false}
}
function signedOut(){
  ++epoch;clearTimeout(flushTimer);
  user=null;ready=false;pending=new Map();baseline=new Map();
  app.restoreLocalRecords();
  status(configured?'구글 로그인하면 동기화':'로컬 저장 모드');
  buttons();
}
async function setupAuth(){
  if(!configured){status('로컬 저장 · 클라우드 설정 전');buttons();return}
  try{
    const [{initializeApp},authMethods]=await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js')
    ]);
    authLib=authMethods;
    auth=authMethods.getAuth(initializeApp(fb));
    await authMethods.setPersistence(auth,authMethods.browserLocalPersistence);
    authMethods.onAuthStateChanged(auth,async account=>{
      if(!account){signedOut();return}
      ++epoch;ready=false;user=account;restorePending();buttons();
      await refresh();
    },()=>status('인증 상태를 확인하지 못했어요','error'));
    status('구글 로그인 확인 중','loading');
  }catch{status('구글 인증 모듈 오류','error')}
}
window.MoadoogiCloud={
  isReady:()=>ready,
  init(adapter){
    app=adapter;buttons();
    $('cloud-login').addEventListener('click',async()=>{
      if(!auth||!authLib)return;
      try{await authLib.signInWithPopup(auth,new authLib.GoogleAuthProvider())}
      catch{status('로그인 실패 · 팝업과 Firebase 설정을 확인해 주세요','error')}
    });
    $('cloud-logout').addEventListener('click',async()=>{
      if(!auth||!authLib)return;
      await flush();
      try{await authLib.signOut(auth)}catch{app.showToast('로그아웃 오류')}
    });
    $('cloud-refresh').addEventListener('click',()=>{void refresh()});
    $('cloud-export').addEventListener('click',()=>{
      const data={format:'moadoogi-backup-v1',exportedAt:new Date().toISOString(),items:app.getRecords()};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      const link=document.createElement('a');
      link.href=url;link.download='moadoogi-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),3000);
      app.showToast('스크랩 JSON 백업을 다운로드했어요');
    });
    $('cloud-import-file').addEventListener('click',()=>$('cloud-file').click());
    $('cloud-file').addEventListener('change',async event=>{
      const file=event.target.files?.[0];event.target.value='';
      if(!file)return;
      try{
        if(file.size>10000000)throw Error('최대 10MB 파일만 지원해요');
        const data=JSON.parse(await file.text());
        if(data?.format!=='moadoogi-backup-v1'||!Array.isArray(data.items)||data.items.length>2000)throw Error('모아두기 백업 파일이 아니에요');
        const imported=data.items.map(validBackupItem);
        if(!confirm('백업의 스크랩 '+imported.length+'개를 현재 '+(ready?'구글 계정':'브라우저')+'에 추가할까요?'))return;
        const existingItems=(!ready&&!app.readLocalRecords().length)?[]:app.getRecords();
        const next=existingItems.map(copy),byId=new Map(next.map(item=>[item.id,item]));
        let added=0;
        for(const item of imported){
          if(byId.has(item.id)){
            if(JSON.stringify(validBackupItem(byId.get(item.id)))===JSON.stringify(item))continue;
            item.id='import-'+crypto.randomUUID();
          }
          next.push(item);byId.set(item.id,item);added++;
        }
        app.replaceRecords(next);
        if(ready)this.onLocalChange(next);else app.persistLocalRecords(next);
        app.showToast(added+'개 스크랩을 복원했어요');buttons();
      }catch(error){app.showToast('백업 복원 실패: '+error.message)}
    });
    $('cloud-import').addEventListener('click',()=>{
      if(!ready)return;
      const local=app.readLocalRecords();
      if(!local.length||!confirm('기존 로컬 스크랩 '+local.length+'개를 구글 계정에 추가할까요? 클라우드 데이터는 삭제하지 않습니다.'))return;
      const next=app.getRecords().map(copy),existing=new Map(next.map(x=>[x.id,x]));
      let added=0;
      for(const item of local){
        const value=copy(item);
        if(existing.has(value.id)){
          if(JSON.stringify(existing.get(value.id))===JSON.stringify(value))continue;
          value.id='import-'+crypto.randomUUID();
        }
        next.push(value);existing.set(value.id,value);added++;
      }
      app.replaceRecords(next);this.onLocalChange(next);buttons();
      app.showToast(added+'개 스크랩을 동기화 목록에 추가했어요');
    });
    window.addEventListener('focus',()=>{if(ready&&Date.now()-lastPull>10000)void refresh()});
    setInterval(()=>{if(ready&&!document.hidden&&Date.now()-lastPull>30000)void refresh()},35000);
    void setupAuth();
  },
  onLocalChange(items){
    if(!ready||!user)return;
    changeVersion++;
    const latest=snap(items);
    for(const [id,json] of latest)if(baseline.get(id)!==json)pending.set(id,{op:'upsert',id,item:JSON.parse(json)});
    for(const id of baseline.keys())if(!latest.has(id))pending.set(id,{op:'delete',id});
    baseline=latest;savePending();status('☁ 동기화 중','loading');queueFlush();
  },
  async metadata(url){
    if(!ready||!user)return null;
    return api('/api/metadata?url='+encodeURIComponent(url));
  }
};
})();
