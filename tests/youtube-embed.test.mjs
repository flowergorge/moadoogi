import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');
const fn = /function openYoutubeDialog\(id,title,url\)\{[\s\S]*?\n\}/.exec(app)?.[0];

test('YouTube embeds are only loaded when the user clicks Play, not via the local Python server', () => {
  assert.ok(fn, 'openYoutubeDialog must exist');
  assert.match(app, /id="youtube-play"/);
  assert.match(app, /\$\('youtube-play'\)\?\.addEventListener\('click'/);
  assert.doesNotMatch(app, /function activateYoutubePlayer/);
  assert.doesNotMatch(fn, /127\.0\.0\.1|fetch\(/);
  assert.match(html, /<dialog id="youtube-dialog"/);
  assert.match(css, /\.youtube-dialog-video\{[^\n]*min-height:200px/);
  assert.match(app, /addEventListener\('close',\(\)=>\$\('youtube-dialog-video'\)\.replaceChildren\(\)\)/);
});

test('YouTube modal uses an official embed URL and allows full-screen playback', () => {
  const dialog = { open:false, showModal() { this.open=true; }, close() { this.open=false; } };
  const container = { children:[], replaceChildren() { this.children=[]; }, append(iframe) { this.children.push(iframe); } };
  const title = { textContent:'' }, link = { href:'' };
  const elements = {'youtube-dialog':dialog, 'youtube-dialog-video':container, 'youtube-dialog-title':title, 'youtube-dialog-link':link};
  runInNewContext(fn + '\nopenYoutubeDialog("M7lc1UVf-VE", "Video title", "https://www.youtube.com/watch?v=M7lc1UVf-VE")', {
    $: id => elements[id]||null, document:{createElement:tag=>({tag})}, encodeURIComponent
  });
  assert.equal(dialog.open,true);
  assert.equal(title.textContent,'Video title');
  assert.equal(link.href,'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.equal(container.children.length,1);
  const iframe = container.children[0];
  assert.equal(iframe.tag,'iframe');
  assert.equal(iframe.src,'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=1&playsinline=1');
  assert.equal(iframe.referrerPolicy,'strict-origin-when-cross-origin');
  assert.equal(iframe.allowFullscreen,true);
});

test('Invalid video IDs do not generate an iframe', () => {
  let attempted = false;
  runInNewContext(fn + '\nopenYoutubeDialog("<img onerror=1>", "Title", "https://example.com")', {
    $:()=>{attempted=true;return null},document:{createElement:()=>{attempted=true}},encodeURIComponent
  });
  assert.equal(attempted,false);
});
