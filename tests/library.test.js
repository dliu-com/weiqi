import test from 'node:test';
import assert from 'node:assert/strict';
import {readSgf,kataQuery} from '../src/sgf.js';
import {saveRecord,uploadRecord} from '../backend/library-service.js';
const id='12345678-1234-1234-1234-123456789abc';
const sample='(;GM[1]FF[4]CA[UTF-8]SZ[19]KM[6.5]RU[Japanese]GN[Test]PB[A]PW[B]C[escaped \\] ; ( comment];B[dd](;W[pp];B[])(;W[dp]))';
test('SGF imports variations, escapes and passes; KataGo uses the main line and original rules',()=>{
 const r=readSgf(sample);assert.equal(r.nodes.length,5);assert.deepEqual(r.mainLine,[0,1,2,3]);assert.equal(r.nodes[0].comment,'escaped ] ; ( comment');assert.equal(r.nodes[1].children.length,2);assert.equal(r.nodes[4].board[15*19+3],'W');
 const q=kataQuery(r,id,1);assert.equal(q.rules,'japanese');assert.equal(q.komi,6.5);assert.equal(q.maxVisits,1);assert.deepEqual(q.analyzeTurns,[0,1,2,3]);assert.deepEqual(q.moves,[['B','D16'],['W','Q4'],['B','pass']]);
});
test('setup stones and compressed ranges reconstruct correctly; other sizes are rejected',()=>{
 const r=readSgf('(;SZ[19]HA[2]AB[cc][gg]PL[W];W[ee])');assert.equal(r.initialPlayer,'W');assert.equal(r.nodes[0].board[40],'B');assert.equal(r.nodes[1].board[80],'W');assert.equal(kataQuery(r,id).initialStones.length,2);
 assert.equal(readSgf('(;SZ[19]AB[aa:bb])').nodes[0].board.split('B').length-1,4);
 for(const size of [9,13])assert.throws(()=>readSgf('(;SZ['+size+'])'),/Only 19/);
});
test('malformed, oversized, unsupported and illegal SGF is rejected before storage',()=>{
 for(const source of ['', '(;SZ[19]', '(;SZ[19])garbage','(;SZ[19])(;SZ[19])','(;GM[2])','(;SZ[8])','(;SZ[19]CA[GB2312])','(;SZ[19];B[zz])','(;SZ[19];B[aa];W[aa])','(;SZ[19];B[aa]W[bb])','(;SZ[19];AB[aa])','(;C[unterminated)','(;C['+'a'.repeat(256*1024)+'])'])assert.throws(()=>readSgf(source));
});
test('saving portable files is idempotent and refuses to overwrite another game',async()=>{
 const files=new Map(),store={get:async key=>files.get(key),create:async(key,value)=>{if(files.has(key))return false;files.set(key,value);return true;}};
 const meta=await saveRecord(store,sample,'test.sgf',id);assert.equal(meta.analysis.status,'queued');assert.equal(files.get('games/'+id+'/original.sgf'),sample);assert.equal(files.size,3);
 await saveRecord(store,sample,'test.sgf',id);assert.equal(files.size,3);await assert.rejects(()=>saveRecord(store,'(;SZ[19])','other.sgf',id),e=>e.statusCode===409);
 await assert.rejects(()=>saveRecord(store,sample,'x','../../etc'),e=>e.statusCode===400);
});

test('daily IDs are sequential, concurrent-safe and upload retries reuse their ID',async()=>{
 const files=new Map(),store={get:async key=>{if(!files.has(key))throw Object.assign(Error(),{name:'NoSuchKey'});return files.get(key);},create:async(key,value)=>{if(files.has(key))return false;files.set(key,value);return true;}};
 const now=new Date('2026-10-05T15:00:00Z'),other='22345678-1234-1234-1234-123456789abc';
 const [a,b]=await Promise.all([uploadRecord(store,sample,'a.sgf',id,now),uploadRecord(store,sample,'b.sgf',other,now)]);
 assert.deepEqual([a.id,b.id].sort(),['2026100501','2026100502']);
 assert.equal((await uploadRecord(store,sample,'a.sgf',id,new Date('2026-10-06'))).id,a.id);
 await assert.rejects(()=>uploadRecord(store,'(;SZ[19])','other.sgf',id,now),e=>e.statusCode===409);
 const third='32345678-1234-1234-1234-123456789abc';const [c,d]=await Promise.all([uploadRecord(store,sample,'c.sgf',third,now),uploadRecord(store,sample,'c.sgf',third,now)]);assert.equal(c.id,'2026100503');assert.equal(d.id,c.id);
});
function memoryStore(){const files=new Map();return {files,get:async key=>{if(!files.has(key))throw Object.assign(Error(),{name:'NoSuchKey'});return files.get(key);},create:async(key,value)=>{if(files.has(key))return false;files.set(key,value);return true;}};}
const uploadId=n=>String(n).padStart(8,'0')+'-1234-1234-1234-123456789abc';
test('concurrent uploads claim at most 10 paid slots, keeping later records replayable',async()=>{
 const store=memoryStore(),now=new Date('2026-10-05T15:00:00Z');
 const records=await Promise.all(Array.from({length:21},(_,n)=>uploadRecord(store,sample,'game.sgf',uploadId(n),now)));
 assert.equal(records.filter(r=>r.analysis.status==='queued').length,10);
 const limited=records.find(r=>r.analysis.status==='limited');assert.equal(limited.analysis.dailyLimit,10);assert.equal(await store.get('games/'+limited.id+'/original.sgf'),sample);
 assert.equal([...store.files.keys()].filter(k=>k.startsWith('daily-analysis/')).length,10);
});
test('operator benchmarks do not consume public paid slots; retries and the London day are respected',async()=>{
 const store=memoryStore(),now=new Date('2026-10-05T22:59:59Z');
 for(let n=100;n<121;n++)await uploadRecord(store,sample,'benchmark.sgf',uploadId(n),now,{analysis:false});
 const record=await uploadRecord(store,sample,'game.sgf',uploadId(200),now);assert.equal(record.id,'2026100522');assert.equal(record.analysis.status,'queued');
 await uploadRecord(store,sample,'game.sgf',uploadId(200),now);assert.equal([...store.files.keys()].filter(k=>k.startsWith('daily-analysis/')).length,1);
 const next=await uploadRecord(store,sample,'game.sgf',uploadId(201),new Date('2026-10-05T23:00:01Z'));assert.equal(next.id,'2026100601');
 assert.equal([...store.files.keys()].filter(k=>k.startsWith('daily-analysis/')).length,2);
 await assert.rejects(()=>uploadRecord(store,'(;SZ[9])','bad.sgf',uploadId(202),now));assert.equal([...store.files.keys()].filter(k=>k.startsWith('daily-analysis/')).length,2);
});
