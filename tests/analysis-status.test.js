import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatedAnalysisSeconds,analysisWait} from '../src/analysis-status.js';
test('queued estimate excludes queue delay, running estimate decreases and overdue does not show zero',()=>{
 const now=Date.parse('2026-10-05T12:00:00Z');
 assert.deepEqual(analysisWait({status:'queued'},139,now),{phase:'queued',seconds:26});
 assert.deepEqual(analysisWait({status:'running',estimatedSeconds:26,startedAt:'2026-10-05T11:59:50Z'},139,now),{phase:'running',seconds:16});
 assert.equal(analysisWait({status:'running',estimatedSeconds:10,startedAt:'2026-10-05T11:59:00Z'},139,now).phase,'overdue');
 assert.equal(analysisWait({status:'running',startedAt:'bad'},139,now).phase,'overdue');
 assert.ok(estimatedAnalysisSeconds(140,100)>estimatedAnalysisSeconds(140,10));
});

import {pendingAnalysis} from '../src/analysis-status.js';
test('pending phases remain visible until deep results are ready',()=>{
 assert.equal(pendingAnalysis({status:'running',available:'quick',quick:{status:'ready'},deep:{status:'running'}}).phase,'deep');
 assert.equal(pendingAnalysis({status:'ready',available:'deep',quick:{status:'running'},deep:{status:'ready'}}),null);
 assert.equal(pendingAnalysis({status:'running',quick:{status:'failed'},deep:{status:'queued'}}).phase,'deep');
 assert.equal(pendingAnalysis({status:'ready',available:'quick',quick:{status:'ready'},deep:{status:'failed'}}),null);
});

import {shouldPollQuick} from '../src/analysis-status.js';
test('only pending quick results are checked automatically; deep requires a page refresh',()=>{
 assert.equal(shouldPollQuick({status:'queued'}),true);
 assert.equal(shouldPollQuick({status:'running',quick:{status:'running'},deep:{status:'running'}}),true);
 assert.equal(shouldPollQuick({status:'running',available:'quick',quick:{status:'ready'},deep:{status:'running'}}),false);
 assert.equal(shouldPollQuick({status:'running',quick:{status:'failed'},deep:{status:'running'}}),false);
 assert.equal(shouldPollQuick({status:'ready',available:'deep',quick:{status:'running'},deep:{status:'ready'}}),false);
 assert.equal(shouldPollQuick({status:'running'},{queueKind:'deep'}),false);
});

import {analysisCompletion} from '../src/analysis-status.js';
test('running completion timestamp stays fixed while remaining time decreases; queued timestamp is only an earliest estimate',()=>{
 const now=Date.parse('2026-10-05T23:00:00Z'),a={status:'running',startedAt:'2026-10-05T22:59:00Z',estimatedSeconds:180};
 assert.equal(analysisCompletion(a,321,now).timestamp,Date.parse('2026-10-05T23:02:00Z'));
 assert.equal(analysisCompletion(a,321,now+30000).timestamp,analysisCompletion(a,321,now).timestamp);
 assert.equal(analysisWait(a,321,now+30000).seconds,90);
 assert.deepEqual(analysisCompletion({status:'queued',estimatedSeconds:180},321,now),{timestamp:now+180000,earliest:true});
 assert.equal(analysisCompletion({...a,startedAt:'bad'},321,now),null);
});

import {analysisTotalMillis} from '../src/analysis-status.js';
test('total clock begins at SQS enqueue, includes capacity/setup and is fixed after completion',()=>{
 const metadata={analysis:{enqueuedAt:'2026-10-06T00:00:00Z'}};
 assert.equal(analysisTotalMillis(null,metadata,Date.parse('2026-10-06T00:03:30Z')),210000);
 assert.equal(analysisTotalMillis({completedAt:'2026-10-06T00:05:30Z'},metadata),330000);
 assert.equal(analysisTotalMillis({endToEndMs:330100},metadata,Date.parse('2026-10-06T01:00:00Z')),330100);
 assert.equal(analysisTotalMillis(null,{analysis:{}}),null);
});

test('scheduled retries keep quick polling active while deep retries require manual refresh',()=>{
 const waiting={status:'retry_wait',attempt:1,retryAt:'2026-10-06T05:00:00Z',quick:{status:'retry_wait'},deep:{status:'retry_wait'}};
 assert.equal(pendingAnalysis(waiting).phase,'quick');assert.equal(shouldPollQuick(waiting),true);
 const deep={...waiting,available:'quick',quick:{status:'ready'}};assert.equal(pendingAnalysis(deep).phase,'deep');assert.equal(shouldPollQuick(deep),false);
 assert.equal(pendingAnalysis({...waiting,status:'failed',quick:{status:'failed'},deep:{status:'failed'}}),null);
});
