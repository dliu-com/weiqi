import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash,randomUUID} from 'node:crypto';
function dispatcher({lookupFailure=false,deepFailure=false}={}){
 const id='2026100601',key='games/'+id+'/metadata.json',original='(;SZ[19]KM[6.5];B[dd];W[pp])';
 const files=new Map([[key,JSON.stringify({id,analysis:{status:'queued'}})],['games/'+id+'/original.sgf',original]]),submitted=[];let lookups=0;
 class GetObjectCommand{constructor(input){this.input=input;}}class PutObjectCommand{constructor(input){this.input=input;}}class SubmitJobCommand{constructor(input){this.input=input;}}
 class S3Client{async send(c){if(c instanceof GetObjectCommand)return {ETag:'test',Body:{transformToString:async()=>files.get(c.input.Key)}};files.set(c.input.Key,c.input.Body);return {};}}
 class BatchClient{async send(c){if(deepFailure&&c.input.jobName.endsWith('-deep'))throw Error('Deep submit unavailable');submitted.push(c.input);return {jobId:'job-'+submitted.length};}}
 const exports={},source=['src/engine.js','src/sgf.js','backend/library-service.js','backend/fargate-dispatcher.cjs'].map(f=>readFileSync(new URL('../'+f,import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
 vm.runInNewContext(source,{exports,TextEncoder,require:name=>name.includes('client-s3')?{S3Client,GetObjectCommand,PutObjectCommand}:name.includes('client-batch')?{BatchClient,SubmitJobCommand}:{createHash,randomUUID},process:{env:{LIBRARY_BUCKET:'test',JOB_QUEUE:'quick',DEEP_QUEUE:'deep',JOB_DEFINITION:'definition'}},console:{error(){}},resolveLatestModel:async()=>{lookups++;if(lookupFailure)throw Error('Latest lookup unavailable');return {name:'kata1-test.bin.gz',key:'models/kata1-test.bin.gz',url:'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-test.bin.gz'};}});
 const call=count=>exports.handler({Records:[{messageId:'message',body:JSON.stringify({id}),attributes:{ApproximateReceiveCount:String(count)}}]});
 return {call,files,submitted,key,original,lookups:()=>lookups};
}
test('dispatcher selects one fresh latest model for two 32-CPU jobs and reuses existing job IDs on repeated delivery',async()=>{
 const d=dispatcher();await d.call(1);await d.call(2);assert.equal(d.submitted.length,2);assert.equal(d.lookups(),1);
 for(const job of d.submitted){assert.equal(job.containerOverrides.resourceRequirements.find(r=>r.type==='VCPU').value,'32');assert.equal(job.containerOverrides.resourceRequirements.find(r=>r.type==='MEMORY').value,'61440');assert.equal(job.containerOverrides.environment.find(v=>v.name==='KATAGO_MODEL_URL').value,'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-test.bin.gz');}
 assert.equal(JSON.parse(d.files.get('jobs/2026100601/quick-request.json')).query.maxVisits,10);assert.equal(JSON.parse(d.files.get('jobs/2026100601/deep-request.json')).query.maxVisits,128);
 assert.equal(JSON.parse(d.files.get(d.key)).analysis.deep.jobId,'job-2');assert.equal([...d.files.keys()].filter(k=>k.startsWith('models/')).length,0);
});
test('repeated latest-model lookup failure marks analysis failed while preserving the original game and submitting no paid jobs',async()=>{
 const d=dispatcher({lookupFailure:true});assert.equal((await d.call(1)).batchItemFailures.length,1);assert.equal((await d.call(3)).batchItemFailures.length,0);
 assert.equal(JSON.parse(d.files.get(d.key)).analysis.status,'failed');assert.equal(d.submitted.length,0);assert.equal(d.files.get('games/2026100601/original.sgf'),d.original);
});
test('failed deep submission preserves already available quick results and never submits the quick job twice',async()=>{
 const d=dispatcher({deepFailure:true});await d.call(1);const meta=JSON.parse(d.files.get(d.key));meta.analysis.quick.status='ready';meta.analysis.available='quick';meta.analysis.dispatchedAt='2026-01-01T00:00:00Z';d.files.set(d.key,JSON.stringify(meta));await d.call(3);
 const state=JSON.parse(d.files.get(d.key)).analysis;assert.equal(state.deep.status,'failed');assert.equal(state.status,'ready');assert.equal(state.available,'quick');assert.equal(d.submitted.length,1);
});
