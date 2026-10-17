import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const file = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = file('app.js'), index = file('index.html'), cloud = file('cloud-client.js');
const calendar = file('calendar.js'), worker = file('worker/src/index.js');
const workflow = file('.github/workflows/pages.yml'), css = file('sidebar.css');

test('state names remain distinct across UI, backup and calendar', () => {
  const states = ['관심','진행중','대기','완료','완성','미루기','포기'];
  assert.ok(app.includes("const STATUS = ['전체','관심','진행중','대기','완료','완성','미루기','포기']"));
  for (const state of states) {
    assert.ok(index.includes('data-filter="' + state + '"'), state + ' sidebar');
    assert.ok(index.includes('<option>' + state + '</option>'), state + ' edit');
    assert.ok(cloud.includes("'" + state + "'"), state + ' backup');
  }
  assert.match(calendar, /'대기':'waiting'/);
  assert.match(calendar, /'완성':'finished'/);
  assert.match(css, /\.status-대기/);
  assert.match(css, /\.status-완성/);
});

test('project view filters solely finished items, exits on ordinary views', () => {
  assert.match(app, /projectView\?x\.status==='완성'/);
  assert.match(app, /function openProjectView\(\)/);
  assert.match(app, /function setFilter\(status,dated=false\).*projectView=false/);
  assert.match(app, /activeTag=tag;activeFilter='전체';onlyDated=false;projectView=false/);
  assert.match(app, /calendarView=true;shownCount=PAGE_SIZE;activeTag=null;projectView=false/);
  assert.match(index, /id="project-nav"/);
  assert.ok(!/projectView\?x\.status==='완료'/.test(app));
});

test('the in-progress card menu offers exactly five requested next states', () => {
  assert.ok(app.includes("item.status==='진행중'?['대기','완료','완성','미루기','포기']:STATUS.slice(1)"));
  assert.match(app, /status\.setAttribute\('aria-expanded'/);
  assert.match(app, /option\.dataset\.setStatus=item\.id/);
});

test('sidebar persists a compact state, and the Pages job publishes its CSS', () => {
  assert.match(app, /moadoogi-sidebar-collapsed/);
  assert.match(app, /localStorage\.setItem\(SIDEBAR_KEY/);
  assert.match(app, /classList\.toggle\('sidebar-collapsed'/);
  assert.match(index, /id="sidebar-toggle"/);
  assert.match(index, /\.\/sidebar\.css/);
  assert.match(workflow, /sidebar\.css _site\//);
  assert.match(css, /@media \(min-width:901px\)/);
  assert.match(css, /@media \(max-width:900px\)/);
});

test('Worker accepts the new status strings without a migration', () => {
  assert.match(worker, /item\.status = textField\(raw\.status, 'status', 100\)/);
  assert.ok(!/status\s+TEXT\s+CHECK\s*\(/i.test(worker));
  assert.match(file('mobile-core.mjs'), /status: '관심'/);
});

test('calendar keeps scheduled finished/waiting items', () => {
  const context={window:{}};
  runInNewContext(calendar,context);
  const a={id:'a',status:'대기',date:'2026-10-18',rank:0};
  const b={id:'b',status:'완성',date:'2026-10-18',rank:1};
  const groups=context.window.MoadoogiCalendar.groupItems([a,b]);
  assert.deepEqual(Array.from(groups.get('2026-10-18'),x=>x.status), ['대기','완성']);
});
