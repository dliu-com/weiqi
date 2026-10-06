import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareReportFiles,reportEvents} from '../backend/report-renderer/report-job.mjs';
const key='games/20261006/20/reports/'+'a'.repeat(64)+'.json',event={id:'2026100620',reportKey:key,jobId:'deep-job'};
function setup(){
 const entries=new Map([['records/games/20261006/20/metadata.json',{analysis:{deep:{status:'ready',jobId:'deep-job'}}}],['records/'+key,{id:'2026100620'}]]),writes=[];
 const store={json:async(bucket,key)=>entries.get(bucket+'/'+key)||null,put:async(bucket,key,body,type)=>{writes.push({key,type});entries.set(bucket+'/'+key,type==='application/json'?JSON.parse(body):body);}};
 let calls=0;const render=async()=>{calls++;return Object.fromEntries(['en','zh'].map(lang=>[lang,{pdf:Buffer.from('%PDF'),html:'<main>'+lang+'</main>',pageCount:17}]));};
 return {entries,writes,options:{store,render,version:'v1',libraryBucket:'records',siteBucket:'site'},calls:()=>calls};
}
test('FIFO queue envelopes deliver their parsed report request to preparation',async()=>{
 const s=setup(),requests=reportEvents({Records:[{body:JSON.stringify(event)}]});
 assert.deepEqual(requests,[event]);assert.deepEqual(reportEvents(event),[event]);
 assert.equal((await prepareReportFiles(requests[0],s.options)).prepared,true);
 assert.throws(()=>reportEvents({Records:[{body:'invalid JSON'}]}),SyntaxError);
});
test('completion prepares both languages before publishing readiness and duplicate events reuse files',async()=>{
 const s=setup(),result=await prepareReportFiles(event,s.options);assert.equal(result.prepared,true);assert.equal(s.calls(),1);
 const ready=s.entries.get('site/prepared-reports/2026100620/index.json');assert.equal(ready.status,'ready');assert.deepEqual(Object.keys(ready.languages),['en','zh']);
 assert.equal(s.writes.at(-1).key,'prepared-reports/2026100620/index.json');assert.equal(s.writes.filter(w=>w.type==='application/pdf').length,2);assert.equal(s.writes.filter(w=>w.type.startsWith('text/html')).length,2);
 assert.equal((await prepareReportFiles(event,s.options)).alreadyPrepared,true);assert.equal(s.calls(),1);
});
test('stale completions cannot prepare files and renderer failures never publish ready',async()=>{
 const s=setup();assert.equal((await prepareReportFiles({...event,jobId:'old-job'},s.options)).ignored,true);assert.equal(s.calls(),0);
 s.options.render=async()=>{throw Error('Rendering failed');};await assert.rejects(prepareReportFiles(event,s.options),/Rendering failed/);assert.equal(s.entries.get('site/prepared-reports/2026100620/index.json').status,'failed');
});
