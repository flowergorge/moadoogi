import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeShareTags,withShareTags,withSourceUrl,suggestedShareTags} from '../mobile-core.mjs';
test('tags normalize hash/comma/space input, deduplicate, and enforce server limits',()=>{
 assert.deepEqual(normalizeShareTags('#쇼핑, 게임 쇼핑'),['쇼핑','게임']);
 assert.throws(()=>normalizeShareTags('가'.repeat(81)),/80자/);
 assert.throws(()=>withShareTags({tags:[]},Array.from({length:25},(_,i)=>'t'+i)),/24개/);
 assert.ok(suggestedShareTags(['쇼핑','내태그']).includes('내태그'));
});
test('source changes preserve custom tags, note, and user-removed tags when URL is unchanged',()=>{
 const item={url:'',note:'원문',tags:['쇼핑']};
 const updated=withSourceUrl(item,'https://github.com/owner/project');
 assert.deepEqual(updated.tags,['쇼핑','깃허브']);assert.equal(updated.note,'원문');
 assert.deepEqual(withSourceUrl({...updated,tags:['쇼핑']},updated.url).tags,['쇼핑']);
 assert.throws(()=>withSourceUrl(item,'not-a-url'),/주소/);
});
