import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{getSuggestedTags} from '../src/index.js';
test('suggestions rank only the signed-in user tags, cap results, and parameterize user IDs',async()=>{
 const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE items(user_id TEXT,item_json TEXT)');
 const insert=sql.prepare('INSERT INTO items VALUES (?,?)');
 insert.run('alice',JSON.stringify({tags:['쇼핑','게임']}));insert.run('alice',JSON.stringify({tags:['쇼핑']}));
 insert.run('bob',JSON.stringify({tags:['다른계정비밀']}));
 for(let i=0;i<30;i++)insert.run('alice',JSON.stringify({tags:['tag'+i]}));
 const db={prepare(query){return {bind(uid){return {async all(){return {results:sql.prepare(query).all(uid)}}}}}}};
 const data=await (await getSuggestedTags(db,'alice')).json();assert.equal(data.tags[0],'쇼핑');assert.equal(data.tags.length,16);assert.ok(!data.tags.includes('다른계정비밀'));
 assert.deepEqual(await (await getSuggestedTags(db,"' OR 1=1 --")).json(),{tags:[]});
 sql.close();
});
test('tag suggestions require authentication before accessing database',async()=>{
 const response=await worker.fetch(new Request('https://api.example.test/api/tags'),{DB:{prepare(){throw Error('must not query')}},FIREBASE_PROJECT_ID:'test',ALLOWED_ORIGINS:'https://flowergorge.github.io'});
 assert.equal(response.status,401);
});
