import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

function fallback({status='RUNNABLE',race=false,lostSubmit=false,delayedCancel=false}={}){
 const files=new Map(),submitted=[];let cancelled=0,current=status,cancelPolls=0;
 const id='2026100601',phase='quick',jobId='gpu-job',key='games/'+id+'/metadata.json';
 const metadata={analysis:{enqueuedAt:'2026-10-06T00:00:00Z',status:'queued',model:{key:'models/latest.bin.gz',url:'https://media.katagotraining.org/latest.bin.gz'},quick:{status:'queued',jobId},deep:{status:'queued',jobId:'gpu-deep'}}};
 files.set(key,JSON.stringify(metadata));files.set('jobs/'+id+'/quick-request.json',JSON.stringify({id,phase,enqueuedAt:metadata.analysis.enqueuedAt,nodeIds:[0,1,2],query:{maxVisits:64}}));
 class GetObjectCommand{constructor(input){this.input=input;}}
 class PutObjectCommand{constructor(input){this.input=input;}}
 class DescribeJobsCommand{constructor(input){this.input=input;}}
 class ListJobsCommand{constructor(input){this.input=input;}}
 class CancelJobCommand{constructor(input){this.input=input;}}
 class SubmitJobCommand{constructor(input){this.input=input;}}
 class S3Client{async send(c){if(c instanceof GetObjectCommand)return {ETag:'test',Body:{transformToString:async()=>files.get(c.input.Key)}};files.set(c.input.Key,c.input.Body);return {};}}
 class BatchClient{async send(c){
  if(c instanceof DescribeJobsCommand){if(delayedCancel&&cancelled&&++cancelPolls>=3)current='FAILED';return {jobs:[{jobId,status:current}]};}
  if(c instanceof CancelJobCommand){cancelled++;current=race?'RUNNING':delayedCancel?'RUNNABLE':'FAILED';return {};}
  if(c instanceof ListJobsCommand)return {jobSummaryList:submitted.map(s=>({jobId:'cpu-job',createdAt:s.time,status:'RUNNING'}))};
  submitted.push({input:c.input,time:Date.now()});if(lostSubmit)throw Error('Response lost');return {jobId:'cpu-job'};
 }}
 const exports={};vm.runInNewContext(readFileSync(new URL('../backend/gpu-fallback.cjs',import.meta.url),'utf8'),{exports,require:name=>name.includes('client-s3')?{S3Client,GetObjectCommand,PutObjectCommand}:{BatchClient,DescribeJobsCommand,ListJobsCommand,CancelJobCommand,SubmitJobCommand},process:{env:{LIBRARY_BUCKET:'test',CPU_QUICK_QUEUE:'cpu-quick',CPU_DEEP_QUEUE:'cpu-deep',CPU_JOB_DEFINITION:'cpu-definition'}},setTimeout:callback=>callback(),console:{error(){}}});
 const call=count=>exports.handler({Records:[{messageId:'message',body:JSON.stringify({id,phase,jobId}),attributes:{ApproximateReceiveCount:String(count||1)}}]});
 return {call,files,submitted,metadata:()=>JSON.parse(files.get(key)),cancelled:()=>cancelled};
}
test('capacity fallback confirms GPU cancellation, keeps original enqueue/model and submits paid CPU work only once',async()=>{
 const f=fallback();await f.call();await f.call();assert.equal(f.cancelled(),1);assert.equal(f.submitted.length,1);
 const request=JSON.parse(f.files.get('jobs/2026100601/quick-request.json'));
 assert.equal(request.query.maxVisits,4);assert.equal(request.enqueuedAt,'2026-10-06T00:00:00Z');assert.equal(request.compute.vCpu,32);
 assert.equal(f.metadata().analysis.quick.jobId,'cpu-job');assert.equal(f.metadata().analysis.deep.jobId,'gpu-deep');
 assert.equal(f.submitted[0].input.containerOverrides.environment.find(e=>e.name==='KATAGO_MODEL_KEY').value,'models/latest.bin.gz');
});
test('already running GPU analysis never launches a CPU duplicate',async()=>{
 const f=fallback({status:'RUNNING'});await f.call();assert.equal(f.cancelled(),0);assert.equal(f.submitted.length,0);
});
test('GPU starting during cancellation restores its job ID and avoids paid CPU work',async()=>{
 const f=fallback({race:true});await f.call();assert.equal(f.submitted.length,0);assert.equal(f.metadata().analysis.quick.jobId,'gpu-job');
});
test('lost CPU submit response is recovered by job lookup without submitting another paid job',async()=>{
 const f=fallback({lostSubmit:true});assert.equal((await f.call()).batchItemFailures.length,1);await f.call(2);
 assert.equal(f.submitted.length,1);assert.equal(f.metadata().analysis.quick.jobId,'cpu-job');
});

test('asynchronous GPU cancellation is confirmed before CPU analysis is submitted',async()=>{
 const f=fallback({delayedCancel:true});await f.call();assert.equal(f.cancelled(),1);assert.equal(f.submitted.length,1);assert.equal(f.metadata().analysis.quick.jobId,'cpu-job');
});
