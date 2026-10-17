(() => {
'use strict';
const DAY=86400000;
function validDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01')return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function shiftMonth(month,amount){
  if(!validDate(month+'-01')||!Number.isInteger(amount))return null;
  const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+amount);
  const value=date.toISOString().slice(0,7);
  return validDate(value+'-01')?value:null;
}
function monthDays(month){
  if(!validDate(month+'-01'))return [];
  const first=new Date(month+'-01T12:00:00Z');
  const end=new Date(first);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  const length=Math.ceil((first.getUTCDay()+end.getUTCDate())/7)*7;
  const start=first.getTime()-first.getUTCDay()*DAY;
  return Array.from({length},(_,index)=>{
    const key=new Date(start+index*DAY).toISOString().slice(0,10);
    return {date:validDate(key)?key:'',current:key.startsWith(month+'-')};
  });
}
function groupItems(records){
  const groups=new Map();
  for(const item of records){
    if(!validDate(item.date))continue;
    if(!groups.has(item.date))groups.set(item.date,[]);
    groups.get(item.date).push(item);
  }
  for(const items of groups.values())items.sort((a,b)=>Number(Boolean(b.starred))-Number(Boolean(a.starred))||(a.rank??0)-(b.rank??0)||String(a.id).localeCompare(String(b.id)));
  return groups;
}
function create(root,{today,onSelect}){
  let selectedDate=today(),month=selectedDate.slice(0,7),records=[];
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=date=>new Intl.DateTimeFormat('ko-KR',{timeZone:'UTC',month:'long',day:'numeric',weekday:'long'}).format(new Date(date+'T12:00:00Z'));
  const statusClass=status=>({'관심':'interest','진행중':'progress','대기':'waiting','완료':'done','완성':'finished','미루기':'later','포기':'abandoned'}[status]||'interest');
  root.innerHTML='<div class="calendar-toolbar"><div><h2 id="calendar-month-title" aria-live="polite"></h2><p id="calendar-summary"></p></div><div class="calendar-controls"><button type="button" data-calendar-today>오늘</button><button type="button" data-calendar-step="-1" aria-label="이전 달">‹</button><label class="sr-only" for="calendar-month-input">이동할 연월</label><input type="month" id="calendar-month-input" min="0001-01" max="9999-12" aria-label="이동할 연월"><button type="button" data-calendar-step="1" aria-label="다음 달">›</button></div></div><div class="calendar-weekdays" aria-hidden="true">'+['일','월','화','수','목','금','토'].map(day=>'<span>'+day+'</span>').join('')+'</div><div class="calendar-grid" id="calendar-grid" aria-label="월간 일정"></div><p class="calendar-hint">날짜를 누르면 아래에 그날의 항목이 표시돼요. · 한국 시간 기준</p>';
  const grid=root.querySelector('#calendar-grid'),input=root.querySelector('#calendar-month-input');
  function render(next=records){
    const focused=root.ownerDocument.activeElement;
    const focusDate=focused?.dataset?.calendarDate,focusItem=focused?.dataset?.calendarItem;
    records=next;
    const groups=groupItems(records),current=today();
    root.querySelector('#calendar-month-title').textContent=Number(month.slice(0,4))+'년 '+Number(month.slice(5))+'월';
    const count=[...groups].reduce((sum,[key,items])=>sum+(key.startsWith(month+'-')?items.length:0),0);
    root.querySelector('#calendar-summary').textContent=count?'이번 달 일정 '+count+'개 · 모든 상태':'이번 달은 등록된 일정이 없어요';
    input.value=month;
    root.querySelector('[data-calendar-step="-1"]').disabled=!shiftMonth(month,-1);
    root.querySelector('[data-calendar-step="1"]').disabled=!shiftMonth(month,1);
    grid.innerHTML=monthDays(month).map(({date,current:inMonth})=>{
      if(!date)return '<div class="calendar-day outside"></div>';
      const items=groups.get(date)||[];
      return '<div class="calendar-day'+(!inMonth?' outside':'')+(date===selectedDate?' selected-day':'')+(date===current?' today-day':'')+'"><button type="button" class="calendar-date" data-calendar-date="'+date+'" aria-pressed="'+(date===selectedDate)+'"'+(date===current?' aria-current="date"':'')+' aria-label="'+date+', '+items.length+'개 일정"><span>'+Number(date.slice(8))+'</span>'+(items.length?'<small>'+items.length+'개</small>':'')+'</button><div class="calendar-events">'+items.slice(0,2).map(item=>'<button type="button" class="calendar-event '+statusClass(item.status)+'" data-calendar-item="'+escape(item.id)+'" data-calendar-date="'+date+'" title="'+escape(item.title+' · '+item.status)+'" aria-label="'+escape(item.title+', '+item.status)+'"><span class="calendar-status-dot" aria-hidden="true"></span><span>'+escape((item.starred?'★ ':'')+item.title)+'</span></button>').join('')+(items.length>2?'<button type="button" class="calendar-more" data-calendar-date="'+date+'">+'+(items.length-2)+'개 더 보기</button>':'')+'</div></div>';
    }).join('');
    if(focusDate){
      const replacement=[...grid.querySelectorAll('button')].find(button=>button.dataset.calendarDate===focusDate&&button.dataset.calendarItem===focusItem);
      replacement?.focus({preventScroll:true});
    }
  }
  function choose(date,id){
    if(!validDate(date))return;
    selectedDate=date;month=date.slice(0,7);render();onSelect(date,id);
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-calendar-today')){choose(today());return}
    if(button.dataset.calendarStep){
      const next=shiftMonth(month,Number(button.dataset.calendarStep));
      if(next)choose(next===today().slice(0,7)?today():next+'-01');
      return;
    }
    if(button.dataset.calendarDate)choose(button.dataset.calendarDate,button.dataset.calendarItem);
  });
  input.addEventListener('change',()=>{if(validDate(input.value+'-01'))choose(input.value+'-01')});
  return {render,get date(){return selectedDate},get dateLabel(){return label(selectedDate)}};
}
window.MoadoogiCalendar={validDate,shiftMonth,monthDays,groupItems,create};
})();
