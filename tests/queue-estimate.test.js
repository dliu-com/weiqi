import test from 'node:test';import assert from 'node:assert/strict';
import {estimateQueue} from '../src/queue-estimate.js';
import {queueWait,analysisCompletion,pendingAnalysis} from '../src/analysis-status.js';
const now=Date.parse('2026-10-06T12:00:00Z'),target={jobId:'target',createdAt:now,status:'RUNNABLE'};
const analysis={quick:{status:'queued',estimatedSeconds:60},deep:{status:'queued',estimatedSeconds:3000}};
test('empty queue gives a fixed typical startup window and stops estimating after it expires',()=>{
 const first=estimateQueue({target,jobs:[target],slots:2,now}),later=estimateQueue({target,jobs:[target],slots:2,now:now+30000});
 assert.deepEqual(first.startsAt,{earliest:now+60000,latest:now+180000});assert.deepEqual(first.startsAt,later.startsAt);
 assert.deepEqual(queueWait({queueStatus:first},now+30000).seconds,{earliest:30,latest:150});
 const expired=estimateQueue({target,jobs:[target],slots:2,now:now+181000});assert.equal(expired.state,'capacity_wait');assert.equal(expired.startsAt,null);
 assert.equal(analysisCompletion({status:'queued',estimatedSeconds:60,queueStatus:first},321,now+181000),null);
});
test('busy GPUs must finish deep analysis, not only their quick results, before the next job starts',()=>{
 const a={jobId:'a',status:'RUNNING',createdAt:now-100000},b={jobId:'b',status:'RUNNING',createdAt:now-100000};
 const states=new Map([['a',{quick:{status:'ready'},deep:{status:'running',estimatedSeconds:1200,startedAt:new Date(now-300000).toISOString()}}],['b',{quick:{status:'ready'},deep:{status:'running',estimatedSeconds:1800,startedAt:new Date(now-300000).toISOString()}}]]);
 const result=estimateQueue({target,jobs:[target,a,b],analyses:states,slots:2,now});
 assert.equal(result.activeJobs,2);assert.equal(result.basis,'workload');assert.deepEqual(result.startsAt,{earliest:now+720000,latest:now+1380000});
 assert.deepEqual(estimateQueue({target,jobs:[a,target,b],analyses:states,slots:2,now:now+15000}).startsAt,result.startsAt);
});
test('queued jobs ahead consume complete pipeline durations across available GPU slots',()=>{
 const a={jobId:'a',status:'RUNNABLE',createdAt:now-5000},b={jobId:'b',status:'RUNNABLE',createdAt:now-4000},later={jobId:'later',status:'RUNNABLE',createdAt:now+1000},failed={jobId:'failed',status:'FAILED',createdAt:now-10000};
 const result=estimateQueue({target,jobs:[target,a,b,later,failed],analyses:new Map([['a',analysis],['b',analysis]]),slots:2,now});
 assert.equal(result.jobsAhead,2);assert.equal(result.activeJobs,0);assert.equal(result.startsAt.earliest,now+(60+3060*.8+60)*1000);assert.equal(result.startsAt.latest,now+(180+3060*1.25+180)*1000);
});
test('unmeasured or overdue jobs do not fabricate a rolling estimate',()=>{
 const busy={jobId:'busy',status:'RUNNING',createdAt:now-10000};
 assert.equal(estimateQueue({target,jobs:[target,busy],slots:1,now}).startsAt,null);
 const late=new Map([['busy',{deep:{status:'running',startedAt:new Date(now-4000000).toISOString(),estimatedSeconds:3000}}]]);
 const r=estimateQueue({target,jobs:[target,busy],analyses:late,slots:1,now});assert.equal(r.state,'busy_unknown');assert.equal(r.startsAt,null);
 assert.equal(estimateQueue({target,jobs:[target],now,complete:false}).state,'unavailable');
 assert.equal(estimateQueue({target:{...target,statusReason:'CAPACITY:INSUFFICIENT_INSTANCE_CAPACITY'},jobs:[target],now}).startsAt,null);
});
test('worker setup estimates anchor to actual Batch start; container STARTING reports allocation without invented timestamps',()=>{
 const started=estimateQueue({target:{...target,status:'RUNNING',startedAt:now-10000},jobs:[],now});assert.equal(started.state,'setup');assert.deepEqual(started.startsAt,{earliest:now+80000,latest:now+170000});
 assert.deepEqual(estimateQueue({target:{...target,status:'RUNNING',startedAt:now-10000},jobs:[],now:now+20000}).startsAt,started.startsAt);
 const starting=estimateQueue({target:{...target,status:'STARTING'},jobs:[],now});assert.equal(starting.state,'starting');assert.equal(starting.startsAt,null);
});
test('pending stage receives the queue range and completion counts down without advancing its timestamps',()=>{
 const status=estimateQueue({target,jobs:[target],now});const state={status:'queued',queueStatus:status,...analysis};const stage=pendingAnalysis(state);
 assert.equal(stage.phase,'quick');assert.equal(stage.queueStatus,status);
 const first=analysisCompletion(stage,321,now),later=analysisCompletion(stage,321,now+30000);assert.deepEqual(first,later);assert.equal(first.windowStart,now+120000);assert.equal(first.timestamp,now+240000);
 assert.equal(analysisCompletion({status:'queued',estimatedSeconds:60},321,now),null);
});
test('a quick-only job ahead (deep limit reached) counts only its quick pass',()=>{
 const a={jobId:'a',status:'RUNNABLE',createdAt:now-5000},quickOnly={quick:{status:'queued',estimatedSeconds:60},deep:{status:'limited',dailyLimit:10}};
 const result=estimateQueue({target,jobs:[target,a],analyses:new Map([['a',quickOnly]]),slots:1,now});
 assert.equal(result.startsAt.earliest,now+(60+60*.8+60)*1000);assert.equal(result.startsAt.latest,now+(180+60*1.25+180)*1000);
});
