import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const context={window:{}};
runInNewContext(readFileSync(new URL('../calendar.js',import.meta.url),'utf8'),context);
const {validDate,shiftMonth,monthDays,groupItems}=context.window.MoadoogiCalendar;

test('calendar validates dates including leap years without normalizing invalid dates',()=>{
  for(const date of ['2024-02-29','2026-10-11','2000-02-29','0001-01-01','9999-12-31'])assert.equal(validDate(date),true,date);
  for(const date of ['',null,'2026-02-29','1900-02-29','2026-04-31','2026-13-01','2026-1-01','0000-01-01'])assert.equal(validDate(date),false,String(date));
});
test('month navigation crosses years and keeps supported date boundaries',()=>{
  assert.equal(shiftMonth('2026-12',1),'2027-01');
  assert.equal(shiftMonth('2026-01',-1),'2025-12');
  assert.equal(shiftMonth('2024-03',-1),'2024-02');
  assert.equal(shiftMonth('0001-01',-1),null);
  assert.equal(shiftMonth('9999-12',1),null);
});
test('month grids include every day once, begin Sunday, and cover four to six weeks',()=>{
  for(const [month,count] of [['2024-02',29],['2026-02',28],['2026-05',31],['2026-10',31],['2027-01',31]]){
    const days=monthDays(month),current=days.filter(day=>day.current);
    assert.equal(current.length,count);
    assert.equal(new Set(days.map(day=>day.date)).size,days.length);
    assert.equal(new Date(days[0].date+'T12:00:00Z').getUTCDay(),0);
    assert.equal(days.length%7,0);
    assert.ok(days.length>=28&&days.length<=42);
    for(let i=1;i<days.length;i++)assert.equal(new Date(days[i].date+'T12:00:00Z')-new Date(days[i-1].date+'T12:00:00Z'),86400000);
  }
});
test('calendar groups all statuses, omits undated items, refreshes edits and deletion without mutating records',()=>{
  const records=[{id:'a',date:'2026-10-11',status:'완료',rank:1},{id:'b',date:'2026-10-11',status:'관심',starred:true,rank:2},{id:'c',date:'2026-10-12',status:'포기'}, {id:'memo',date:''},{id:'bad',date:'2026-02-30'}];
  const before=JSON.stringify(records),group=groupItems(records);
  assert.equal(JSON.stringify(group.get('2026-10-11').map(x=>x.id)),JSON.stringify(['b','a']));
  assert.equal(group.size,2);assert.equal(JSON.stringify(records),before);
  records[0].date='2026-10-12';records.splice(1,1);
  const updated=groupItems(records);
  assert.equal(updated.has('2026-10-11'),false);assert.equal(updated.get('2026-10-12').length,2);
});
