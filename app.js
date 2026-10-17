(() => {
'use strict';
const $ = id => document.getElementById(id);
const KST = 'Asia/Seoul', STORAGE = 'moadoogi-prototype-v1', THEME_KEY='moadoogi-theme';
const STATUS = ['전체','관심','진행중','대기','완료','완성','미루기','포기'];
const PAGE_SIZE = 30;
const demoData = [
  {id:'demo1',title:'SwiftUI Agent Skill — GitHub에서 발견한 도구',url:'https://github.com/twostraws/SwiftUI-Agent-Skill',note:'퇴근하고 README를 정독하고 실제로 쓸 만한지 살펴보기.',status:'관심',date:'',created:'2026-10-10T11:46:00+09:00'},
  {id:'demo2',title:'유튜브에서 발견한 흥미로운 영상',url:'https://www.youtube.com/watch?v=jfKfPfyJRdk',note:'퇴근 후 영상 시청하고 관련 자료도 찾아보기.',status:'관심',date:'',created:'2026-10-10T10:22:00+09:00'},
  {id:'demo3',title:'신작 게임 온라인 쇼케이스 일정',url:'https://www.youtube.com/',note:'2026년 10월 18일 온라인 쇼케이스. 집에서 방송 확인하기. (예시 데이터)',status:'진행중',date:'2026-10-18',created:'2026-10-09T23:11:00+09:00'},
  {id:'demo4',title:'X에서 본 새로운 개발 소식',url:'https://x.com/GoogleDevelopers',note:'눈여겨본 개발자 소식. 새 기능을 공개하면 테스트해 보기.',status:'관심',date:'',created:'2026-10-09T05:32:00+09:00'},
  {id:'demo5',title:'오픈클로 공식 사이트 살펴보기',url:'https://openclaw.ai/',note:'시놀로지에서 활용할 수 있는지 조사하기.',status:'미루기',date:'',created:'2026-10-08T08:20:00+09:00'},
  {id:'demo6',title:'개인 프로젝트 아이디어 정리',url:'',note:'모바일에서 링크와 텍스트를 공유해서 웹앱의 할 일 목록으로 모으는 기능.',status:'완료',date:'2026-10-14',created:'2026-10-07T14:50:00+09:00'}
];
let records;try{const saved=JSON.parse(localStorage.getItem(STORAGE));records=Array.isArray(saved)?saved:demoData}catch{records=demoData}
records=records.map((item,index)=>({...item,rank:Number.isFinite(item.rank)?item.rank:index,tags:item.autoTagsApplied?Array.isArray(item.tags)?item.tags:[]:itemTags(item),autoTagsApplied:true,starred:item.starred===true}));
let activeFilter='관심', search='', order='manual', onlyDated=false, selected=records.find(x=>x.status==='관심')?.id || records[0]?.id || null, editing=null;
let shownCount=PAGE_SIZE;
let calendarView=location.hash==='#calendar';
let scheduleCalendar;
let toastTimer;
let youtubeApiPromise=null,youtubePlayer=null,youtubePreviewEpoch=0;
let lastCapture={value:'',time:0};
let receivedPageShare=null;
let draftTags=[],editTags=[],captureStarred=false,activeTag=null,openStatusMenu=null,draggedId=null,dropPosition=null,projectView=false;
let theme='light';try{theme=localStorage.getItem(THEME_KEY)==='dark'?'dark':'light'}catch{}
const SIDEBAR_KEY='moadoogi-sidebar-collapsed';
let sidebarCollapsed=false;
try{sidebarCollapsed=localStorage.getItem(SIDEBAR_KEY)==='1'}catch{}
function setSidebarCollapsed(value){
  sidebarCollapsed=Boolean(value);
  document.querySelector('.app').classList.toggle('sidebar-collapsed',sidebarCollapsed);
  $('sidebar-toggle').setAttribute('aria-expanded',String(!sidebarCollapsed));
  const label=sidebarCollapsed?'사이드바 펼치기':'사이드바 접기';
  $('sidebar-toggle').setAttribute('aria-label',label);
  $('sidebar-toggle').title=label;
  $('sidebar-toggle-icon').textContent=sidebarCollapsed?'›':'‹';
  document.querySelector('.sidebar-toggle-text').textContent=sidebarCollapsed?'메뉴 펼치기':'메뉴 접기';
  try{localStorage.setItem(SIDEBAR_KEY,sidebarCollapsed?'1':'0')}catch{}
}
function setTheme(value){
  theme=value;document.documentElement.dataset.theme=value;
  $('theme-icon').textContent=value==='dark'?'☀':'☾';
  $('theme-toggle').setAttribute('aria-label',value==='dark'?'라이트 모드로 전환':'다크 모드로 전환');
  document.querySelector('meta[name="theme-color"]').content=value==='dark'?'#141720':'#f6f7fb';
  try{localStorage.setItem(THEME_KEY,value)}catch{}
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeUrl(str){try{const u=new URL(str);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
function typeOf(url){try{const h=new URL(url).hostname.toLowerCase();if(h==='youtu.be'||h==='youtube.com'||h.endsWith('.youtube.com'))return 'youtube';if(h==='bilibili.com'||h.endsWith('.bilibili.com')||h==='b23.tv')return 'bilibili';if(h==='x.com'||h.endsWith('.x.com')||h==='twitter.com'||h.endsWith('.twitter.com'))return 'x';if(h==='github.com')return 'github';if(h==='dcinside.com'||h.endsWith('.dcinside.com'))return 'dcinside';if(h==='arca.live'||h.endsWith('.arca.live'))return 'arca';if(h==='kone.gg'||h.endsWith('.kone.gg'))return 'kone';return 'website'}catch{return 'note'}}
function typeIcon(type){return SITE_LOGO[type]?siteIcon(type):{youtube:'▶',bilibili:'▣',x:'𝕏',github:'⌘',website:'↗',note:'✎'}[type]}
function typeName(type){return {youtube:'YouTube',bilibili:'비리비리',x:'X · 게시글',github:'GitHub',dcinside:'디시인사이드',arca:'아카라이브',kone:'코네',website:'웹사이트',note:'텍스트'}[type]}
function automaticTag(url){return {dcinside:'디시인사이드',arca:'아카라이브',kone:'코네',youtube:'유튜브',bilibili:'비리비리',github:'깃허브',x:'X게시글',website:'웹사이트'}[typeOf(url)]||''}
function xAuthorFromUrl(url){
  try{
    const username=new URL(url).pathname.split('/').filter(Boolean)[0];
    return username&&!['i','intent','search','home','explore'].includes(username.toLowerCase())?'@'+username:'X 게시물';
  }catch{return 'X 게시물'}
}
function itemTags(item){return [...new Set([...(Array.isArray(item.tags)?item.tags:[]),automaticTag(item.url)].filter(Boolean))]}
function originalLink(url,label='원본 주소'){
  const address=safeUrl(url);
  if(!address)return '';
  return '<span class="external-url-actions"><a class="external-url" href="'+escapeHtml(address)+'" target="_blank" rel="noopener noreferrer" title="원본을 새 탭에서 열기"><span class="external-url-label">'+escapeHtml(label)+'</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h6v6M19 5l-9 9"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a><button type="button" class="copy-url-button" data-copy-url="'+escapeHtml(address)+'" aria-label="주소 복사" title="주소를 클립보드에 복사"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M5 16H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h10a1 1 0 0 1 1 1v1"/></svg></button></span>';
}
async function copyOriginalUrl(button){
  const address=safeUrl(button.dataset.copyUrl);
  if(!address)return;
  let copied=false;
  try{
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(address);copied=true}
  }catch{}
  if(!copied){
    const focused=document.activeElement;
    const field=document.createElement('textarea');
    field.value=address;field.readOnly=true;
    field.style.cssText='position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    document.body.append(field);
    try{field.focus({preventScroll:true});field.select();copied=document.execCommand('copy')}catch{}
    finally{field.remove();if(focused?.isConnected)focused.focus({preventScroll:true})}
  }
  toast(copied?'주소를 복사했어요':'클립보드 복사가 제한됐어요. 주소를 직접 선택해 복사해 주세요.');
}
function urlLabel(url){try{const u=new URL(url);return u.hostname.replace(/^www\./,'')+u.pathname+(u.search||'')}catch{return url}}
const SITE_LOGO={dcinside:'assets/dcinside.ico',arca:'assets/arca.svg',kone:'assets/kone.png'};
function siteIcon(type){return SITE_LOGO[type]?'<img class="site-logo" src="'+SITE_LOGO[type]+'" alt="">':typeIcon(type)}
function youtubeId(url){try{const u=new URL(url);if(u.hostname==='youtu.be')return u.pathname.slice(1).split('/')[0];if(/^\/(shorts|live|embed)\//.test(u.pathname))return u.pathname.split('/')[2];return u.searchParams.get('v')}catch{return null}}
function githubPreviewUrl(value){
  try{
    const u=new URL(value);
    if(!['http:','https:'].includes(u.protocol)||u.hostname.toLowerCase()!=='github.com')return '';
    const [owner,repo]=u.pathname.split('/').filter(Boolean);
    // GitHub 기능·사용자 페이지에는 저장소의 대표 이미지가 없다.
    if(!owner||!repo||!/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(owner)||!/^[a-z\d_.-]{1,100}$/i.test(repo))return '';
    if(['about','apps','collections','enterprise','events','explore','features','issues','login','marketplace','new','notifications','orgs','organizations','pricing','pulls','search','security','settings','signup','sponsors','topics','users'].includes(owner.toLowerCase()))return '';
    return 'https://opengraph.githubassets.com/1/'+encodeURIComponent(owner)+'/'+encodeURIComponent(repo);
  }catch{return ''}
}
function kstDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function humanDate(iso){return new Intl.DateTimeFormat('ko-KR',{timeZone:KST,year:'numeric',month:'long',day:'numeric'}).format(new Date(iso))}
function humanDateTime(iso){return new Intl.DateTimeFormat('ko-KR',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date(iso))}
function savedDate(iso){
  const elapsed=Math.max(0,Date.now()-new Date(iso).getTime());
  if(elapsed<60000)return '방금 전';
  if(elapsed<3600000)return Math.floor(elapsed/60000)+'분 전';
  if(elapsed<86400000)return Math.floor(elapsed/3600000)+'시간 전';
  if(elapsed<604800000)return Math.floor(elapsed/86400000)+'일 전';
  return humanDate(iso);
}
function renderCaptureTime(){$('capture-timestamp').textContent=humanDateTime(new Date().toISOString())+' · KST'}
function normalizeTags(text){return [...new Set(String(text||'').split(/\s+/u).map(t=>t.replace(/^#+/,'').trim()).filter(Boolean))].slice(0,24)}
function renderTagChips(id,tags){
  const container=$(id);container.replaceChildren();
  for(const tag of tags){
    const chip=document.createElement('span');chip.className='tag-chip'+(tag==='쇼핑'?' shopping-tag':'');
    const name=document.createElement('span');name.textContent='#'+tag;
    const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.dataset.removeTag=tag;
    remove.setAttribute('aria-label',tag+' 태그 삭제');remove.title=tag+' 삭제';
    chip.append(name,remove);container.append(chip);
  }
}
function addDraftTags(text){draftTags=[...new Set([...draftTags,...normalizeTags(text)])].slice(0,24);renderTagChips('tag-chips',draftTags)}
function addEditTags(text){editTags=[...new Set([...editTags,...normalizeTags(text)])].slice(0,24);renderTagChips('edit-tag-chips',editTags)}
function renderDraftTags(){renderTagChips('tag-chips',draftTags)}
function renderEditTags(){renderTagChips('edit-tag-chips',editTags)}
function setCaptureStar(value){
  captureStarred=Boolean(value);const b=$('capture-star');b.textContent=captureStarred?'★':'☆';
  b.classList.toggle('is-starred',captureStarred);b.setAttribute('aria-pressed',String(captureStarred));
}
function daysUntil(date){if(!date)return null;const today=kstDate();return (Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000}
function urgency(item){if(!item.date||item.status==='완료'||item.status==='완성'||item.status==='포기')return null;const days=daysUntil(item.date);if(days===1)return {label:'내일 · 임박',tone:'soon'};if(days===0)return {label:'오늘 · 임박',tone:'today'};if(days<0)return {label:'지난 일정',tone:'overdue'};return null}
function extractDate(text){
  const iso=String(text).match(/\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/);
  if(iso){const dt=new Date(iso[0]);if(!isNaN(dt))return new Intl.DateTimeFormat('en-CA',{timeZone:KST,year:'numeric',month:'2-digit',day:'2-digit'}).format(dt)}
  const m=String(text).match(/(20\d{2})\s*[년.\/-]\s*(\d{1,2})\s*[월.\/-]\s*(\d{1,2})\s*일?/) || String(text).match(/(20\d{2})-(\d{2})-(\d{2})/);
  const short=String(text).match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  let y,month,d;
  if(m){[,y,month,d]=m.map(Number)} else if(short){const now=kstDate().split('-').map(Number);y=now[0];month=Number(short[1]);d=Number(short[2]);if(month<now[1]||(month===now[1]&&d<now[2]))y++} else return '';
  const check=new Date(Date.UTC(y,month-1,d));if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==month||check.getUTCDate()!==d)return '';
  return [String(y).padStart(4,'0'),String(month).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
/* 붙여넣기 수집: 주소와 함께 복사된 텍스트를 분리하고, 관련 날짜를 한국시간 기준으로 인식한다. */
function parseClip(raw){
  const input=String(raw||'').trim();
  if(!input)return null;
  const match=input.match(/https?:\/\/[^\s<>"“”‘’]+/i);
  let url='', remainder=input;
  if(match){
    const trimmed=match[0].replace(/[)\]}>,.!?，。]+$/g,'');
    url=safeUrl(trimmed);
    if(url)remainder=input.replace(match[0],'').trim();
  }
  const type=typeOf(url);
  const note=remainder.replace(/^[\s\-–—|]+|[\s\-–—|]+$/g,'').trim();
  const titleLine=note.split(/\r?\n/).map(t=>t.trim()).find(Boolean)||'';
  let fallback='나중에 확인할 텍스트';
  if(type==='youtube')fallback='YouTube에서 저장한 영상';
  else if(type==='bilibili')fallback='비리비리에서 저장한 영상';
  else if(type==='x'){
    const user=new URL(url).pathname.split('/')[1];
    fallback=user?'X에서 저장한 게시글 · @'+user:'X에서 저장한 게시글';
  }else if(type==='github')fallback='GitHub에서 발견한 프로젝트';
  else if(type==='dcinside')fallback='디시인사이드에서 발견한 글';
  else if(type==='arca')fallback='아카라이브에서 발견한 글';
  else if(type==='kone')fallback='코네에서 발견한 글';
  else if(type==='website')fallback=new URL(url).hostname.replace(/^www\./,'')+'에서 발견한 글';
  const title=(type==='x'&&url?xAuthorFromUrl(url):titleLine||fallback).slice(0,120);
  return {url,note,title,type,date:extractDate(note)};
}
function updateCapture(){
  const parsed=parseClip($('capture-input').value);
  $('capture-save').disabled=!parsed;
  return parsed;
}
function saveCapture(){
  const raw=$('capture-input').value.trim(),parsed=parseClip(raw);
  if(!parsed){toast('저장할 텍스트나 주소를 먼저 붙여넣어 주세요.');return}
  if(lastCapture.value===raw&&Date.now()-lastCapture.time<2000){$('capture-input').value='';updateCapture();return}
  // 공유 북마크가 전달한 페이지 제목은 서버 크롤링 없이 그대로 사용한다.
  const fromPageShare=receivedPageShare&&raw===receivedPageShare.text&&parsed.url===receivedPageShare.url;
  if(fromPageShare){parsed.title=receivedPageShare.title;parsed.note=''}
  receivedPageShare=null;
  const tags=[...new Set([...draftTags,...normalizeTags($('tag-input').value),automaticTag(parsed.url)].filter(Boolean))].slice(0,24);
  const item={id:'item-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),title:parsed.title,url:parsed.url,note:parsed.note,tags,autoTagsApplied:true,starred:captureStarred,status:'관심',date:parsed.date,created:new Date().toISOString(),rank:Math.min(0,...records.map(x=>x.rank))-1};
  lastCapture={value:raw,time:Date.now()};
  records=[item,...records];selected=item.id;activeFilter='관심';onlyDated=false;activeTag=null;shownCount=PAGE_SIZE;
  search='';$('search').value='';
  save();render();$('capture-input').value='';$('tag-input').value='';draftTags=[];renderDraftTags();setCaptureStar(false);updateCapture();
  if(item.url&&!fromPageShare)loadMetadataForItem(item);
  toast((parsed.date?'일정 '+parsed.date+'과 함께 ':'')+'관심 목록에 저장했어요');
}
async function loadMetadataForItem(item){
  const cloud=window.MoadoogiCloud;
  const useCloud=Boolean(cloud?.isReady());
  // 원격 웹앱에서는 로컬 Python 서버에 접근하지 않는다.
  if(!useCloud&&location.protocol!=='file:'&&location.hostname!=='localhost'&&location.hostname!=='127.0.0.1')return;
  const initialTitle=item.title,initialNote=item.note;
  const isX=typeOf(item.url)==='x';
  const endpoint='http://127.0.0.1:18976/api/'+(isX?'x':'title')+'?url='+encodeURIComponent(item.url);
  try{
    let result;
    if(useCloud){result=await (typeOf(item.url)==='bilibili'?window.MoadoogiBilibili.metadata(item.url,address=>cloud.metadata(address)):cloud.metadata(item.url));if(!result)return}
    else{const response=await fetch(endpoint,{signal:AbortSignal.timeout(9000)});if(!response.ok)return;result=await response.json()}
    const current=records.find(x=>x.id===item.id);
    if(!current||current.url!==item.url)return;
    if(typeOf(current.url)==='website')window.MoadoogiFavicons?.remember(current.url,result.favicon);
    if(isX){
      let changed=false;
      if(result.author&&current.title===initialTitle){
        const author=result.author.trim().slice(0,180);
        if(author&&author!==current.title){current.title=author;changed=true}
      }
      if(result.text&&current.note===initialNote&&!current.note.trim()){
        current.note=result.text.trim().slice(0,2500);changed=true;
      }
      if(!changed)return;
    }else{
      if(!result.title||current.title!==initialTitle)return;
      current.title=result.title.trim().slice(0,180);
    }
    save();render();toast(isX?'X 작성자·본문 정보를 가져왔어요':'게시글 제목을 자동으로 가져왔어요');
  }catch{
    if(typeOf(item.url)==='arca')toast('아카라이브가 제목 조회를 차단했어요. PC에서는 열린 페이지 수집 북마크를 사용해 주세요.');
    // 제목 조회 실패 시 이미 저장한 스크랩과 기존 제목은 그대로 보존한다.
  }
}
function save(){
  if(window.MoadoogiCloud?.isReady()){window.MoadoogiCloud.onLocalChange(records);return}
  try{localStorage.setItem(STORAGE,JSON.stringify(records))}catch{toast('현재 환경에서는 브라우저에 저장할 수 없어요.')}
}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('show');toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2700)}
function count(s){return s==='전체'?records.length:records.filter(x=>x.status===s).length}
function renderCounts(){
  $('interest').textContent=count('관심');
  $('progress').textContent=count('진행중');$('dated').textContent=records.filter(x=>x.date).length;
  const urgent=records.filter(x=>{const flag=urgency(x);return flag&&(flag.tone==='soon'||flag.tone==='today')}).length;
  $('urgent-count').hidden=urgent===0;
  $('urgent-count').textContent='● '+urgent+'건 임박';
  $('dated-stat').classList.toggle('has-urgent',urgent>0);
  document.querySelectorAll('[data-count]').forEach(el=>el.textContent=count(el.dataset.count));
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',!calendarView&&!projectView&&!activeTag&&!onlyDated&&b.dataset.filter===activeFilter));
  $('pills').innerHTML=STATUS.map(s=>`<button class="pill ${!projectView&&!activeTag&&!onlyDated&&s===activeFilter?'active':''}" data-pill="${s}">${s} <small>${count(s)}</small></button>`).join('');
  $('tag-filter-banner').hidden=!activeTag;
  $('tag-filter-label').textContent=activeTag?'#'+activeTag+' 태그의 스크랩':'';
}
function visible(){
  if(calendarView)return window.MoadoogiCalendar.groupItems(records).get(scheduleCalendar.date)||[];
  let list=records.filter(x=>projectView?x.status==='완성':activeTag?(x.tags||[]).includes(activeTag):(activeFilter==='전체'||x.status===activeFilter)&&(!onlyDated||x.date));
  if(search)list=list.filter(x=>[x.title,x.note,x.url,x.status,(x.tags||[]).join(' ')].join(' ').toLowerCase().includes(search));
  return [...list].sort((a,b)=>(Number(b.starred)-Number(a.starred))||(order==='manual'?a.rank-b.rank:order==='old'?a.created.localeCompare(b.created):order==='date'?(a.date||'9999').localeCompare(b.date||'9999'):order==='title'?a.title.localeCompare(b.title,'ko'):b.created.localeCompare(a.created)));
}
function filterByTag(tag){
  leaveCalendar();
  shownCount=PAGE_SIZE;
  activeTag=tag;activeFilter='전체';onlyDated=false;projectView=false;search='';$('search').value='';
  order='manual';$('sort').value=order;
  selected=visible()[0]?.id||null;
  $('detail').classList.remove('show-mobile');render();
  if(innerWidth<=900)document.querySelector('.section-title').scrollIntoView({behavior:'smooth',block:'start'});
}
function toggleStar(id){
  const item=records.find(x=>x.id===id);if(!item)return;
  item.starred=!item.starred;save();render();
  toast(item.starred?'중요 스크랩으로 지정했어요':'중요 표시를 해제했어요');
}
function moveItem(id,direction){
  order='manual';$('sort').value=order;
  const list=visible(),index=list.findIndex(x=>x.id===id),other=list[index+direction];
  if(index<0||!other)return;
  if(list[index].starred!==other.starred)return;
  const item=list[index],rank=item.rank;item.rank=other.rank;other.rank=rank;
  selected=id;save();render();toast(direction<0?'위로 이동했어요':'아래로 이동했어요');
}
function reorderCards(sourceId,targetId,after=false){
  const ids=visible().map(x=>x.id);
  if(sourceId===targetId||!ids.includes(sourceId)||!ids.includes(targetId))return;
  if(records.find(x=>x.id===sourceId).starred!==records.find(x=>x.id===targetId).starred){
    toast('별표 항목은 항상 목록 맨 위에 고정돼요');return;
  }
  const next=ids.filter(x=>x!==sourceId);
  next.splice(next.indexOf(targetId)+(after?1:0),0,sourceId);
  const included=new Set(ids),byId=new Map(records.map(x=>[x.id,x]));
  let n=0;
  const ordered=[...records].sort((a,b)=>a.rank-b.rank).map(x=>included.has(x.id)?byId.get(next[n++]):x);
  ordered.forEach((item,i)=>item.rank=i);
  records=ordered;order='manual';$('sort').value=order;selected=sourceId;
  save();render();toast('우선순위가 변경됐어요');
}
function clearDragState(){
  document.querySelectorAll('.card.dragging,.card.drop-before,.card.drop-after').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));
  draggedId=null;dropPosition=null;
}
function decorateCards(list){
  document.querySelectorAll('#cards [data-card]').forEach((card,index)=>{
    const item=list[index],end=card.querySelector('.card-end'),badge=end.querySelector('.status');
    if(!item||!badge)return;
    const status=document.createElement('button');
    status.type='button';
    status.className=badge.className;
    status.dataset.cycleStatus=item.id;
    status.setAttribute('aria-label',item.title+' 상태 '+item.status+', 상태 목록 열기');
    status.setAttribute('aria-haspopup','true');
    status.setAttribute('aria-expanded',String(openStatusMenu===item.id));
    status.title='상태 선택';status.textContent=item.status;
    badge.replaceWith(status);
    if(openStatusMenu===item.id){
      const menu=document.createElement('div');menu.className='status-menu';menu.setAttribute('role','group');menu.setAttribute('aria-label','상태 변경');
      const choices=item.status==='진행중'?['대기','완료','완성','미루기','포기']:STATUS.slice(1);
      for(const label of choices){
        const option=document.createElement('button');option.type='button';option.className='status-option status-'+label;
        option.dataset.setStatus=item.id;option.dataset.status=label;option.textContent=label;
        if(label===item.status)option.classList.add('is-current');menu.append(option);
      }
      end.append(menu);
    }
    const star=document.createElement('button');star.type='button';
    star.className='star-button card-star'+(item.starred?' is-starred':'');
    star.dataset.toggleStar=item.id;star.textContent=item.starred?'★':'☆';
    star.setAttribute('aria-label',item.starred?'별표 해제':'중요 스크랩으로 지정');
    star.setAttribute('aria-pressed',String(item.starred));
    card.querySelector('h3').prepend(star);
    for(const tag of item.tags||[]){
      const chip=document.createElement('button');chip.type='button';chip.className='tag user-tag'+(tag==='쇼핑'?' shopping-tag':'');
      chip.dataset.filterTag=tag;chip.textContent='#'+tag;chip.title='#'+tag+' 스크랩 보기';
      card.querySelector('.tags').append(chip);
    }
    const main=card.querySelector('.card-main');
    if(automaticTag(item.url))main.querySelector('.tags > .tag')?.remove();
    const summary=main.querySelector('p');
    if(item.url){
      summary.classList.add('card-url');
      summary.innerHTML=originalLink(item.url,urlLabel(item.url));
      if(item.note&&typeOf(item.url)!=='x'){
        const note=document.createElement('div');note.className='card-note';
        note.textContent=item.note;summary.after(note);
      }
    }
    if(typeOf(item.url)==='x'){
      const body=document.createElement('div');body.className='x-card-body';
      body.textContent=item.note||(/\/status\/\d+/.test(item.url)?'본문을 가져올 수 없었어요. 원본 게시물을 확인해 주세요.':'X 계정 주소예요. 개별 게시물 주소를 저장하면 본문을 가져올 수 있어요.');
      main.querySelector('.tags').before(body);
    }
    card.querySelector('.card-time').title=humanDateTime(item.created)+' KST';
    const urgent=urgency(item);
    if(urgent){const tag=document.createElement('span');tag.className='tag urgency '+urgent.tone;tag.textContent=urgent.label;card.querySelector('.tags').append(tag)}
    const handle=document.createElement('span');handle.className='drag-handle';handle.draggable=true;handle.tabIndex=0;
    handle.title='끌어서 우선순위 변경';handle.setAttribute('aria-label',item.title+' 끌어서 정렬');
    handle.textContent='⠿';card.prepend(handle);
  });
}
function renderCards(){
  const all=visible(),list=all.slice(0,shownCount);
  $('visible-count').textContent=all.length>list.length?list.length+' / '+all.length+'개':all.length+'개';
  $('cards').innerHTML=list.length?list.map(item=>{
    const type=typeOf(item.url);return `<article class="card ${item.id===selected?'selected':''}" data-card="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="${escapeHtml(item.title)} 상세보기"><input data-check="${escapeHtml(item.id)}" type="checkbox" ${item.status==='완료'?'checked':''} aria-label="완료 표시"><div class="kind-icon ${type}">${typeIcon(type)}</div><div class="card-main"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.note||item.url||'내가 저장한 텍스트')}</p><div class="tags"><span class="tag">${typeName(type)}</span>${item.date?`<span class="tag date">▤ ${escapeHtml(item.date)}</span>`:''}</div></div><div class="card-end"><span class="card-time">${escapeHtml(savedDate(item.created))}</span><span class="status status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></div></article>`;
  }).join(''):(calendarView?'<div class="empty"><strong>이날은 등록된 일정이 없어요</strong>다른 날짜를 선택하거나 스크랩 수정에서 관련 날짜를 지정해 주세요.</div>':'<div class="empty"><div style="font-size:26px">📭</div><strong>해당하는 항목이 없어요</strong>필터를 바꾸거나 새 항목을 추가해 보세요.</div>');
  decorateCards(list);
  document.querySelectorAll('#cards [data-card]').forEach((card,index)=>{
    const item=list[index];
    if(item&&typeOf(item.url)==='website')window.MoadoogiFavicons?.mount(card.querySelector('.kind-icon.website'),item.url);
  });
  if(list.length<all.length){
    const remaining=all.length-list.length;
    const section=document.createElement('div');
    section.className='load-more';
    section.innerHTML='<span class="load-more-progress">'+list.length+' / '+all.length+'개 표시</span><button type="button" class="load-more-button" data-load-more aria-label="스크랩 '+Math.min(PAGE_SIZE,remaining)+'개 더 불러오기">더 불러오기 <span aria-hidden="true">↓</span><small>('+Math.min(PAGE_SIZE,remaining)+'개)</small></button>';
    $('cards').append(section);
  }
}
function loadXWidgets(container){
  if(window.twttr?.widgets){window.twttr.widgets.load(container);return}
  if(document.querySelector('script[data-x-widgets]'))return;
  const script=document.createElement('script');script.src='https://platform.twitter.com/widgets.js';
  script.async=true;script.dataset.xWidgets='true';
  script.onload=()=>window.twttr?.widgets?.load(document);
  document.head.append(script);
}
function calendarLink(item){if(!item.date)return '';const start=item.date.replaceAll('-','');const dt=new Date(item.date+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+1);const end=dt.toISOString().slice(0,10).replaceAll('-','');return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:item.title,dates:start+'/'+end,details:[item.note,item.url].filter(Boolean).join('\n\n'),ctz:KST}).toString()}
function renderDetail(){
  stopYoutubeInline();
  const item=records.find(x=>x.id===selected);if(!item){$('detail').innerHTML='<div class="empty">저장한 항목을 선택하면 내용이 나타나요.</div>';return}
  const type=typeOf(item.url),id=youtubeId(item.url),url=safeUrl(item.url);
  const art=type==='youtube'&&id&&/^[\w-]{11}$/.test(id)?`<div class="youtube-player-box" id="youtube-player-box"><a class="youtube-poster" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="YouTube에서 원본 영상 열기"><img loading="lazy" alt="유튜브 영상 썸네일" src="https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg"><span class="youtube-original">▶ YouTube에서 열기 ↗</span></a><div class="youtube-embed-slot" id="youtube-embed-slot"></div></div>`:type==='x'&&/\/status\/\d+/.test(url)?`<div class="x-embed"><blockquote class="twitter-tweet" data-conversation="none"><a href="${escapeHtml(url)}">X 게시물 보기</a></blockquote></div>`:`<div class="preview-art ${type}"><div class="mark">${typeIcon(type)}</div><span>${typeName(type).toUpperCase()} PREVIEW</span></div>`;
  $('detail').innerHTML=`<div class="detail-head"><strong>🔖 상세 미리보기</strong><small>저장된 스크랩</small></div>${art}<h3>${escapeHtml(item.title)}</h3><div class="url">${escapeHtml(url||'직접 작성한 메모')}</div><div class="rule"></div><div class="detail-label">내용 및 메모</div><div class="description">${escapeHtml(item.note||'추가된 메모가 없어요.')}</div><div class="rule"></div><div class="detail-row"><span>현재 상태</span><select id="detail-status">${STATUS.slice(1).map(s=>`<option ${item.status===s?'selected':''}>${s}</option>`).join('')}</select></div><div class="detail-row"><span>저장한 날</span><strong>${escapeHtml(humanDate(item.created))}</strong></div>${item.date?`<div class="detail-row"><span>관련 날짜</span><strong>${escapeHtml(item.date)} (KST)</strong></div>`:''}<div class="detail-actions">${url?'<button class="secondary" id="open-link">↗ 원본 열기</button>':''}${item.date?'<button class="secondary" id="to-calendar">▤ 캘린더 추가</button>':''}<button class="subtle" id="edit">수정</button><button class="subtle" id="delete">삭제</button></div>${type==='x'?'<p class="footnote">X 글은 공개 게시물의 개별 주소가 있을 때 실제 서비스에서 공식 임베드를 연결할 수 있어요.</p>':''}`;
  if(type==='bilibili'&&url&&window.MoadoogiCloud?.isReady()){
    void window.MoadoogiBilibili.mount($('detail').querySelector('.preview-art.bilibili'),url,address=>window.MoadoogiCloud.metadata(address));
  }
  const githubImage=githubPreviewUrl(url);
  if(type==='website'&&url){
    const preview=$('detail').querySelector('.preview-art.website');
    if(preview){
      const label=preview.querySelector('span');
      window.MoadoogiFavicons?.mount(preview.querySelector('.mark'),url,{
        onLoad:()=>{label.textContent=new URL(url).hostname.replace(/^www\./,'');preview.classList.add('has-favicon')},
        onError:()=>{label.textContent='WEBSITE PREVIEW';preview.classList.remove('has-favicon')}
      });
      if(window.MoadoogiCloud?.isReady())void window.MoadoogiFavicons?.discover(url,address=>window.MoadoogiCloud.metadata(address));
    }
  }
  if(githubImage){
    const placeholder=$('detail').querySelector('.preview-art.github');
    if(placeholder){
      const frame=document.createElement('a');
      frame.className='github-preview-box';frame.href=url;frame.target='_blank';frame.rel='noopener noreferrer';
      frame.setAttribute('aria-label','GitHub 저장소 열기');
      const image=document.createElement('img');
      image.src=githubImage;image.loading='lazy';image.alt='GitHub 저장소 대표 이미지';image.referrerPolicy='no-referrer';
      image.addEventListener('error',()=>{if(frame.isConnected)frame.replaceWith(placeholder)});
      const action=document.createElement('span');action.className='github-preview-action';action.textContent='GitHub에서 보기 ↗';
      frame.append(image,action);placeholder.replaceWith(frame);
    }
  }
  const memoInput=document.createElement('textarea');
  memoInput.id='detail-note';memoInput.className='detail-note-input detail-composer-textarea';memoInput.rows=6;
  memoInput.placeholder='내용이나 메모를 이곳에 바로 작성하세요.';
  memoInput.setAttribute('aria-label','내용 및 메모 (입력 즉시 자동 저장)');
  memoInput.value=item.note||'';
  const memoCard=document.createElement('section');
  memoCard.className='detail-composer';
  memoCard.innerHTML='<div class="detail-composer-toolbar"><button type="button" class="detail-copy-button" id="detail-copy-note" aria-label="내용 및 메모 복사" title="내용 및 메모를 클립보드에 복사"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M5 16H4a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h10a1 1 0 0 1 1 1v1"/></svg></button></div><div class="detail-composer-body"></div><div class="detail-composer-footer"><svg class="detail-tag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13 12 21a2 2 0 0 1-2.8 0L3 14.8V4a1 1 0 0 1 1-1h10.8L20 8.2a3.4 3.4 0 0 1 0 4.8Z"/><circle cx="8.2" cy="8.2" r="1.3"/></svg><div class="detail-composer-tags" id="detail-composer-tags"></div><input type="text" id="detail-tag-input" aria-label="태그 입력, 스페이스로 구분" placeholder="태그를 입력하세요" autocomplete="off"></div>';
  memoCard.querySelector('.detail-composer-body').append(memoInput);
  $('detail').querySelector('.description').replaceWith(memoCard);
  const memoState=document.createElement('small');memoState.className='detail-note-state';
  memoState.textContent='자동 저장';
  $('detail').querySelector('.detail-label').append(memoState);
  const resizeMemo=()=>{memoInput.style.height='auto';memoInput.style.height=Math.max(120,memoInput.scrollHeight+2)+'px'};
  resizeMemo();
  memoInput.addEventListener('input',()=>{
    item.note=memoInput.value;save();renderCards();resizeMemo();
    memoState.textContent='✓ 저장됨';
  });
  memoInput.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();memoInput.blur()}
  });
  if(url)$('detail').querySelector('.url').innerHTML=originalLink(url,url);
  if(type==='youtube'&&id&&/^[\w-]{11}$/.test(id))void showYoutubeInline(id);
  const savedRow=[...$('detail').querySelectorAll('.detail-row')].find(el=>el.querySelector('span')?.textContent==='저장한 날');
  if(savedRow)savedRow.querySelector('strong').textContent=humanDateTime(item.created)+' (KST)';
  const star=document.createElement('button');star.type='button';star.className='star-button detail-star'+(item.starred?' is-starred':'');
  star.dataset.toggleStar=item.id;star.textContent=item.starred?'★':'☆';
  star.setAttribute('aria-label',item.starred?'별표 해제':'중요 스크랩으로 지정');
  star.setAttribute('aria-pressed',String(item.starred));
  memoCard.querySelector('.detail-composer-toolbar').append(star);
  const tagChips=memoCard.querySelector('#detail-composer-tags');
  const tagInput=memoCard.querySelector('#detail-tag-input');
  const drawDetailTags=()=>{
    tagChips.replaceChildren();
    for(const tag of item.tags||[]){
      const chip=document.createElement('span');chip.className='detail-composer-tag'+(tag==='쇼핑'?' shopping-tag':'');
      const label=document.createElement('button');label.type='button';label.className='detail-composer-tag-filter';
      label.dataset.filterTag=tag;label.textContent='#'+tag;label.title='#'+tag+' 태그 스크랩 보기';
      const remove=document.createElement('button');remove.type='button';remove.className='detail-composer-tag-remove';
      remove.textContent='×';remove.setAttribute('aria-label',tag+' 태그 삭제');remove.title=tag+' 삭제';
      remove.addEventListener('click',e=>{
        e.stopPropagation();item.tags=item.tags.filter(t=>t!==tag);
        save();drawDetailTags();renderCards();
      });
      chip.append(label,remove);tagChips.append(chip);
    }
  };
  const addDetailTags=(value)=>{
    const next=[...new Set([...(item.tags||[]),...normalizeTags(value.replace(/,/g,' '))])].slice(0,24);
    if(next.length!==(item.tags||[]).length){
      item.tags=next;save();drawDetailTags();renderCards();
    }
  };
  tagInput.addEventListener('input',e=>{
    if(e.isComposing||!/[\s,]/u.test(tagInput.value))return;
    const parts=tagInput.value.split(/[\s,]+/u);
    tagInput.value=parts.pop()||'';
    addDetailTags(parts.join(' '));
  });
  tagInput.addEventListener('keydown',e=>{
    if(e.isComposing)return;
    if(e.key===' '||e.key===','||e.key==='Enter'){
      e.preventDefault();addDetailTags(tagInput.value);tagInput.value='';
    }else if(e.key==='Backspace'&&!tagInput.value&&item.tags?.length){
      item.tags=item.tags.slice(0,-1);save();drawDetailTags();renderCards();
    }
  });
  tagInput.addEventListener('blur',()=>{
    if(tagInput.value.trim()){addDetailTags(tagInput.value);tagInput.value=''}
  });
  drawDetailTags();
  memoCard.querySelector('#detail-copy-note').addEventListener('click',async()=>{
    const content=memoInput.value;
    if(!content.trim()){toast('복사할 메모가 없어요.');return}
    let copied=false;
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(content);copied=true;
      }
    }catch{}
    if(!copied){
      const start=memoInput.selectionStart,end=memoInput.selectionEnd;
      memoInput.focus();memoInput.select();
      try{copied=document.execCommand('copy')}catch{}
      memoInput.setSelectionRange(start,end);
    }
    toast(copied?'내용 및 메모를 복사했어요':'클립보드 복사가 제한됐어요.');
  });
  if(type==='x'&&/\/status\/\d+/.test(url))loadXWidgets($('detail'));
  $('detail-status').addEventListener('change',e=>{item.status=e.target.value;save();render();toast('상태를 변경했어요')});
  $('open-link')?.addEventListener('click',()=>window.open(url,'_blank','noopener,noreferrer'));
  $('to-calendar')?.addEventListener('click',()=>window.open(calendarLink(item),'_blank','noopener,noreferrer'));
  $('edit').addEventListener('click',()=>openModal(item));
  $('delete').addEventListener('click',()=>{if(window.confirm('이 항목을 삭제할까요?')){records=records.filter(x=>x.id!==item.id);selected=records[0]?.id||null;save();render();toast('항목을 삭제했어요')}});
}
function stopYoutubeInline(){
  youtubePreviewEpoch++;
  if(youtubePlayer){
    const old=youtubePlayer;youtubePlayer=null;
    try{old.destroy()}catch{}
  }
}
function youtubeIframeApi(){
  if(window.YT?.Player)return Promise.resolve(window.YT);
  if(youtubeApiPromise)return youtubeApiPromise;
  youtubeApiPromise=new Promise(resolve=>{
    const previous=window.onYouTubeIframeAPIReady;
    let finished=false;
    const complete=value=>{if(finished)return;finished=true;clearTimeout(timer);resolve(value)};
    const timer=setTimeout(()=>complete(null),10000);
    window.onYouTubeIframeAPIReady=()=>{
      try{if(typeof previous==='function')previous()}catch{}
      complete(window.YT?.Player?window.YT:null);
    };
    const script=document.createElement('script');
    script.src='https://www.youtube.com/iframe_api';script.async=true;
    script.onerror=()=>complete(null);
    document.head.append(script);
  }).then(value=>{if(!value)youtubeApiPromise=null;return value});
  return youtubeApiPromise;
}
async function showYoutubeInline(id){
  if(!/^[\w-]{11}$/.test(id))return;
  const box=$('youtube-player-box'),slot=$('youtube-embed-slot'),generation=youtubePreviewEpoch;
  if(!box||!slot)return;
  const YT=await youtubeIframeApi();
  if(!YT||generation!==youtubePreviewEpoch||!box.isConnected)return;
  // 썸네일을 남겨둔 채 백그라운드에서 iframe 준비. 성공한 경우에만 표시한다.
  const iframe=document.createElement('iframe');
  iframe.title='YouTube 영상 재생';iframe.width='100%';iframe.height='100%';
  iframe.referrerPolicy='strict-origin-when-cross-origin';
  iframe.allow='encrypted-media; picture-in-picture; fullscreen';iframe.allowFullscreen=true;
  iframe.src='https://www.youtube-nocookie.com/embed/'+id+'?enablejsapi=1&playsinline=1&origin='+encodeURIComponent(location.origin);
  slot.append(iframe);
  let instance=null,failed=false,ready=false;
  const fallback=()=>{
    if(generation!==youtubePreviewEpoch||failed)return;
    failed=true;box.classList.remove('has-player');
    try{(instance||{destroy:()=>iframe.remove()}).destroy()}catch{iframe.remove()}
    if(youtubePlayer===instance)youtubePlayer=null;
  };
  try{
    instance=new YT.Player(iframe,{events:{
      onReady:()=>{
        if(generation!==youtubePreviewEpoch||!box.isConnected||failed)return;
        ready=true;box.classList.add('has-player');
      },
      onError:()=>fallback()
    }});
    if(failed){try{instance.destroy()}catch{}}
    else youtubePlayer=instance;
    setTimeout(()=>{if(!ready&&generation===youtubePreviewEpoch)fallback()},10000);
  }catch{fallback()}
}
function leaveCalendar(){
  calendarView=false;
  if(location.hash==='#calendar')history.replaceState(history.state,'',location.pathname+location.search);
}
function openCalendar(){
  calendarView=true;shownCount=PAGE_SIZE;activeTag=null;projectView=false;
  if(location.hash!=='#calendar')history.pushState(history.state,'',location.pathname+location.search+'#calendar');
  selected=visible()[0]?.id||null;
  $('detail').classList.remove('show-mobile');render();
  $('calendar-page').scrollIntoView({behavior:'smooth',block:'start'});
}
function render(){
  document.querySelector('.content').classList.toggle('calendar-view',calendarView);
  $('calendar-page').hidden=!calendarView;
  $('project-nav').classList.toggle('active',!calendarView&&projectView);
  $('project-nav').setAttribute('aria-current',!calendarView&&projectView?'page':'false');
  $('shopping-nav').classList.toggle('active',!calendarView&&activeTag==='쇼핑');
  $('shopping-nav').setAttribute('aria-current',!calendarView&&activeTag==='쇼핑'?'page':'false');
  $('tag-filter-banner').classList.toggle('shopping-tag',activeTag==='쇼핑');
  $('dated-nav').classList.toggle('active',calendarView);
  $('calendar-bottom-nav').classList.toggle('active',calendarView);
  $('dated-nav').setAttribute('aria-current',calendarView?'page':'false');
  $('calendar-bottom-nav').setAttribute('aria-current',calendarView?'page':'false');
  $('page-breadcrumb').textContent=calendarView?'일정 캘린더':projectView?'프로젝트':activeTag==='쇼핑'?'쇼핑':'스크랩 & 할 일';
  document.querySelector('.intro h1').textContent=calendarView?'일정 캘린더':projectView?'프로젝트 모아보기':activeTag==='쇼핑'?'쇼핑 모아보기':'내 스크랩 & 할 일 ✦';
  $('list-heading').textContent=calendarView?scheduleCalendar.dateLabel+' 일정':projectView?'완성한 프로젝트':activeTag==='쇼핑'?'쇼핑 태그의 스크랩':'내 스크랩 목록';
  if(calendarView){
    scheduleCalendar.render(records);
  }
  if(!visible().some(item=>item.id===selected))selected=visible()[0]?.id||null;
  renderCounts();renderCards();renderDetail();
}
function setFilter(status,dated=false){leaveCalendar();shownCount=PAGE_SIZE;activeFilter=status;onlyDated=dated;activeTag=null;projectView=false;$('detail').classList.remove('show-mobile');render()}
function openProjectView(){
  leaveCalendar();shownCount=PAGE_SIZE;projectView=true;activeTag=null;activeFilter='완성';onlyDated=false;search='';$('search').value='';
  order='manual';$('sort').value=order;selected=visible()[0]?.id||null;
  $('detail').classList.remove('show-mobile');render();
  if(innerWidth<=900)document.querySelector('.section-title').scrollIntoView({behavior:'smooth',block:'start'});
}
function openModal(item){
  editing=item?.id||null;$('modal-title').textContent=item?'스크랩 수정하기':'새 발견 저장하기';
  $('f-title').value=item?.title||'';$('f-url').value=item?.url||'';$('f-note').value=item?.note||'';
  editTags=[...(item?.tags||[])];$('f-tags').value='';renderEditTags();
  $('f-starred').checked=Boolean(item?.starred);
  $('f-status').value=item?.status||'관심';$('f-date').value=item?.date||'';
  $('example').hidden=!!item;$('modal-backdrop').classList.add('open');setTimeout(()=>$('f-title').focus(),30);
}
function closeModal(){$('modal-backdrop').classList.remove('open');editing=null}
function fillDemo(){$('f-title').value='퇴근 후 확인할 개발자 행사';$('f-url').value='https://developers.google.com/';$('f-note').value='2026년 10월 21일 개발자 행사 안내를 발견했어요. 퇴근 후 참여 방법 조사하기.';$('f-date').value=extractDate($('f-note').value);$('f-status').value='관심';toast('안드로이드 공유로 받은 내용을 채웠어요')}
$('capture-input').addEventListener('input',updateCapture);
$('tag-input').addEventListener('input',e=>{
  const value=e.target.value;
  if(/\s/u.test(value)){
    const parts=value.split(/\s+/u);addDraftTags(parts.slice(0,-1).join(' '));e.target.value=parts.at(-1);
  }
});
$('tag-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===' '){
    e.preventDefault();if(e.target.value.trim())addDraftTags(e.target.value);
    e.target.value='';
  }else if(e.key==='Backspace'&&!e.target.value&&draftTags.length){
    draftTags.pop();renderDraftTags();
  }
});
$('tag-chips').addEventListener('click',e=>{
  const b=e.target.closest('[data-remove-tag]');if(!b)return;
  draftTags=draftTags.filter(t=>t!==b.dataset.removeTag);renderDraftTags();
});
$('f-tags').addEventListener('input',e=>{
  if(e.isComposing)return;
  if(/\s/u.test(e.target.value)){
    const parts=e.target.value.split(/\s+/u);
    addEditTags(parts.slice(0,-1).join(' '));e.target.value=parts.at(-1);
  }
});
$('f-tags').addEventListener('keydown',e=>{
  if(e.isComposing)return;
  if(e.key===' '||e.key==='Enter'){
    e.preventDefault();if(e.target.value.trim())addEditTags(e.target.value);
    e.target.value='';
  }else if(e.key==='Backspace'&&!e.target.value&&editTags.length){
    editTags.pop();renderEditTags();
  }
});
$('edit-tag-chips').addEventListener('click',e=>{
  const b=e.target.closest('[data-remove-tag]');if(!b)return;
  editTags=editTags.filter(t=>t!==b.dataset.removeTag);renderEditTags();
});
$('capture-star').addEventListener('click',()=>setCaptureStar(!captureStarred));
$('theme-toggle').addEventListener('click',()=>setTheme(theme==='dark'?'light':'dark'));
$('tag-filter-clear').addEventListener('click',()=>setFilter('전체'));
// 편집창 안에서 붙여넣으면 입력만 하고, 다른 곳에서 Ctrl+V 하면 바로 스크랩한다.
document.addEventListener('paste',e=>{
  if(e.defaultPrevented||$('modal-backdrop').classList.contains('open'))return;
  if(e.target?.closest?.('textarea,input,[contenteditable="true"],[role="textbox"]'))return;
  const text=e.clipboardData?.getData('text/plain');
  if(!text?.trim())return;
  e.preventDefault();
  $('capture-input').value=text;updateCapture();saveCapture();
});
$('capture-save').addEventListener('click',saveCapture);
$('paste-clipboard').addEventListener('click',async()=>{
  try{
    if(!navigator.clipboard?.readText)throw new Error('Clipboard API unavailable');
    const content=await navigator.clipboard.readText();
    if(!content.trim()){
      toast('클립보드에 텍스트가 없어요.');$('capture-input').focus();return;
    }
    $('capture-input').value=content;updateCapture();saveCapture();
  }catch{
    $('capture-input').focus();
    toast('클립보드 접근이 제한됐어요. 입력창에서 Ctrl+V 또는 길게 눌러 붙여넣으세요.');
  }
});
$('sidebar-nav').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(b)setFilter(b.dataset.filter)});
$('bottom-nav').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(b)setFilter(b.dataset.filter)});
$('pills').addEventListener('click',e=>{const b=e.target.closest('[data-pill]');if(b)setFilter(b.dataset.pill)});
$('shopping-nav').addEventListener('click',()=>filterByTag('쇼핑'));
$('project-nav').addEventListener('click',openProjectView);
$('sidebar-toggle').addEventListener('click',()=>setSidebarCollapsed(!sidebarCollapsed));
$('dated-nav').addEventListener('click',openCalendar);
$('calendar-bottom-nav').addEventListener('click',openCalendar);
$('interest-stat').addEventListener('click',()=>setFilter('관심'));
$('progress-stat').addEventListener('click',()=>setFilter('진행중'));
$('dated-stat').addEventListener('click',openCalendar);
$('search').addEventListener('input',e=>{shownCount=PAGE_SIZE;search=e.target.value.trim().toLowerCase();renderCards()});
$('sort').addEventListener('change',e=>{shownCount=PAGE_SIZE;order=e.target.value;renderCards()});
$('cards').addEventListener('click',e=>{
  const copy=e.target.closest('[data-copy-url]');
  if(copy){e.preventDefault();e.stopPropagation();void copyOriginalUrl(copy);return}
  if(e.target.closest('[data-load-more]')){
    shownCount+=PAGE_SIZE;renderCards();return;
  }
  const star=e.target.closest('[data-toggle-star]');
  if(star){toggleStar(star.dataset.toggleStar);return}
  const tag=e.target.closest('[data-filter-tag]');
  if(tag){filterByTag(tag.dataset.filterTag);return}
  const chosen=e.target.closest('[data-set-status]');
  if(chosen){
    const item=records.find(x=>x.id===chosen.dataset.setStatus);
    if(item){item.status=chosen.dataset.status;openStatusMenu=null;save();render();toast('상태: '+item.status)}
    return;
  }
  const cycle=e.target.closest('[data-cycle-status]');
  if(cycle){
    const item=records.find(x=>x.id===cycle.dataset.cycleStatus);
    if(!item)return;
    openStatusMenu=openStatusMenu===item.id?null:item.id;
    renderCards();return;
  }
  if(e.target.closest('.drag-handle'))return;
  const check=e.target.closest('[data-check]');
  if(check){
    const item=records.find(x=>x.id===check.dataset.check);
    if(item){item.status=check.checked?'완료':'관심';save();render();toast(check.checked?'완료 처리했어요':'관심으로 돌렸어요')}
    return;
  }
  if(e.target.closest('a[href]'))return;
  const b=e.target.closest('[data-card]');
  if(b){selected=b.dataset.card;$('detail').classList.add('show-mobile');render();if(innerWidth<=900)$('detail').scrollIntoView({behavior:'smooth',block:'start'})}
});
$('detail').addEventListener('click',e=>{
  const copy=e.target.closest('[data-copy-url]');
  if(copy){e.preventDefault();e.stopPropagation();void copyOriginalUrl(copy);return}
  const star=e.target.closest('[data-toggle-star]');
  if(star){toggleStar(star.dataset.toggleStar);return}
  const tag=e.target.closest('[data-filter-tag]');
  if(tag)filterByTag(tag.dataset.filterTag);
});
$('cards').addEventListener('dragstart',e=>{
  const handle=e.target.closest('.drag-handle');if(!handle)return;
  const card=handle.closest('[data-card]');draggedId=card?.dataset.card;if(!draggedId)return;
  e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedId);
  e.dataTransfer.setDragImage(card,25,card.offsetHeight/2);
  setTimeout(()=>card.classList.add('dragging'),0);
});
$('cards').addEventListener('dragover',e=>{
  if(!draggedId)return;
  const target=e.target.closest('[data-card]');if(!target||target.dataset.card===draggedId)return;
  e.preventDefault();e.dataTransfer.dropEffect='move';
  document.querySelectorAll('.card.drop-before,.card.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));
  const after=e.clientY>target.getBoundingClientRect().top+target.offsetHeight/2;
  target.classList.add(after?'drop-after':'drop-before');
  dropPosition={id:target.dataset.card,after};
});
$('cards').addEventListener('drop',e=>{
  if(!draggedId||!dropPosition)return;
  e.preventDefault();const source=draggedId,target=dropPosition;
  clearDragState();reorderCards(source,target.id,target.after);
});
$('cards').addEventListener('dragend',clearDragState);
$('cards').addEventListener('keydown',e=>{
  if(!e.target.matches('.drag-handle')||!['ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();const id=e.target.closest('[data-card]').dataset.card;
  moveItem(id,e.key==='ArrowUp'?-1:1);
  document.querySelector('[data-card="'+CSS.escape(id)+'"] .drag-handle')?.focus();
});
document.addEventListener('click',e=>{
  if(openStatusMenu&&!e.target.closest('[data-cycle-status],[data-set-status],.status-menu')){
    openStatusMenu=null;renderCards();
  }
});
$('cards').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.card')){e.preventDefault();e.target.click()}});
$('example').addEventListener('click',fillDemo);
$('modal-close').addEventListener('click',closeModal);
$('modal-backdrop').addEventListener('click',e=>{if(e.target===$('modal-backdrop'))closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});
for(const id of ['f-title','f-note'])$(id).addEventListener('input',()=>{if(!$('f-date').value){const found=extractDate($('f-title').value+' '+$('f-note').value);if(found)$('f-date').value=found}});
$('f-url').addEventListener('input',()=>{if(!$('f-title').value.trim())try{$('f-title').value=new URL($('f-url').value).hostname.replace(/^www\./,'')+'에서 발견한 글'}catch{}});
$('item-form').addEventListener('submit',e=>{
  e.preventDefault();
  const title=$('f-title').value.trim(),url=$('f-url').value.trim(),note=$('f-note').value.trim();
  if(!title)return;
  if(url&&!safeUrl(url)){toast('주소는 http 또는 https로 시작해야 해요');return}
  const old=records.find(x=>x.id===editing);
  const id=old?.id||'item-'+Date.now()+'-'+Math.random().toString(36).slice(2,7);
  const tags=[...new Set([...editTags,...normalizeTags($('f-tags').value)])].slice(0,24);
  if((!old||old.url!==url)&&automaticTag(url)&&!tags.includes(automaticTag(url)))tags.push(automaticTag(url));
  const data={id,title,url,note,tags,autoTagsApplied:true,starred:$('f-starred').checked,status:$('f-status').value,date:$('f-date').value||extractDate(title+' '+note),created:old?.created||new Date().toISOString(),rank:old?.rank??Math.min(0,...records.map(x=>x.rank))-1};
  records=old?records.map(x=>x.id===id?data:x):[data,...records];
  selected=id;activeFilter=data.status;onlyDated=false;activeTag=null;shownCount=PAGE_SIZE;
  save();closeModal();render();toast(old?'항목을 수정했어요':'항목을 저장했어요');
});
$('today').textContent=new Intl.DateTimeFormat('ko-KR',{timeZone:KST,month:'long',day:'numeric',weekday:'short'}).format(new Date());
// 열린 페이지에서 북마크를 누르면 document.title과 URL을 모아두기로 전달한다.
// URL fragment는 서버로 전송되지 않으며, 수신 직후 주소창에서 제거한다.
const bookmarklet="javascript:(function(){var t=document.title||'';var u=location.href;var p=encodeURIComponent(JSON.stringify({title:t,url:u}));window.open('https://flowergorge.github.io/moadoogi/#share='+p,'_blank','noopener')})()";
$('page-bookmarklet').setAttribute('href',bookmarklet);
$('page-bookmarklet').addEventListener('click',event=>{
  event.preventDefault();toast('이 링크를 북마크바에 끌어다 놓고, 저장할 게시글에서 해당 북마크를 누르세요.');
});
function receivePageShare(){
  if(!location.hash.startsWith('#share='))return;
  try{
    const encoded=location.hash.slice(7);
    if(encoded.length>20000)throw Error('공유 데이터가 너무 큽니다');
    const payload=JSON.parse(decodeURIComponent(encoded));
    const url=safeUrl(payload?.url);
    const title=String(payload?.title||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,180);
    if(!url||!title||/^just a moment/i.test(title))throw Error('페이지 제목이나 주소가 없습니다');
    receivedPageShare={url,title,text:title+'\n'+url};
    $('capture-input').value=receivedPageShare.text;
    updateCapture();
    toast('페이지 제목과 주소를 받았어요. 스크랩을 눌러 저장하세요.');
  }catch{toast('공유한 페이지의 제목과 주소를 읽을 수 없어요.')}
  finally{history.replaceState(history.state,'',location.pathname+location.search)}
}
scheduleCalendar=window.MoadoogiCalendar.create($('calendar-page'),{
  today:kstDate,
  onSelect:(_date,id)=>{
    shownCount=PAGE_SIZE;
    selected=id||visible()[0]?.id||null;
    $('detail').classList.toggle('show-mobile',Boolean(id));render();
    if(id)$('detail').scrollIntoView({behavior:'smooth',block:'start'});
  }
});
window.addEventListener('hashchange',()=>{
  calendarView=location.hash==='#calendar';
  $('detail').classList.remove('show-mobile');render();
});
setTheme(theme);
setSidebarCollapsed(sidebarCollapsed);
renderCaptureTime();
setInterval(renderCaptureTime,1000);
setInterval(()=>{if(!draggedId){renderCards();if(calendarView)scheduleCalendar.render(records)}},60000);
render();
receivePageShare();
window.MoadoogiCloud?.init({
  getRecords:()=>records,
  readLocalRecords:()=>{
    try{const data=JSON.parse(localStorage.getItem(STORAGE));return Array.isArray(data)?data:[]}
    catch{return []}
  },
  persistLocalRecords:next=>{
    try{localStorage.setItem(STORAGE,JSON.stringify(next))}
    catch{toast('브라우저 저장 공간에 복원하지 못했어요')}
  },
  replaceRecords:next=>{
    records=next.map((item,index)=>({
      ...item,rank:Number.isFinite(item.rank)?item.rank:index,
      tags:Array.isArray(item.tags)?item.tags:[],autoTagsApplied:true,starred:item.starred===true
    }));
    selected=records.find(item=>item.id===selected)?.id||records.find(x=>x.status==='관심')?.id||records[0]?.id||null;
    shownCount=PAGE_SIZE;activeTag=null;render();
  },
  restoreLocalRecords:()=>{
    let saved;
    try{saved=JSON.parse(localStorage.getItem(STORAGE))}catch{}
    const next=Array.isArray(saved)?saved:demoData;
    records=next.map((item,index)=>({
      ...item,rank:Number.isFinite(item.rank)?item.rank:index,
      tags:Array.isArray(item.tags)?item.tags:itemTags(item),autoTagsApplied:true,starred:item.starred===true
    }));
    selected=records.find(x=>x.status==='관심')?.id||records[0]?.id||null;
    shownCount=PAGE_SIZE;activeTag=null;render();
  },
  showToast:toast
});
})();
