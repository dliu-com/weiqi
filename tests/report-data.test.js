import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiReport,summariseLosses} from '../src/report-data.js';
const source='(;SZ[19]PB[Black Test]PW[White Test];B[dd];W[pp])';
const candidate=(move,lead,order=0)=>({move,blackLead:lead,blackWinrate:.5,visits:100,order,pv:[move,'pass']});
const analysis={phase:'deep',visits:3000,positions:[{nodeId:0,move:0,blackLead:0,blackWinrate:.5,candidates:[candidate('Q16',4),candidate('D16',1,1)]},{nodeId:1,move:1,blackLead:1,blackWinrate:.5,candidates:[candidate('D4',-3),candidate('Q4',4,1)]},{nodeId:2,move:2,blackLead:4,blackWinrate:.5,candidates:[]}]};
test('report uses player perspectives, excludes unrated moves and selects largest losses without mutating analysis',()=>{
 const before=JSON.stringify(analysis),r=buildAiReport(source,analysis,{id:'2026100601',name:'Test'},new Date('2026-10-06T00:00:00Z'));
 assert.equal(r.players.B.meanPointLoss,3);assert.equal(r.players.W.meanPointLoss,7);assert.equal(r.players.W.counts.blunder,1);assert.equal(r.problems[0].move,2);assert.equal(r.problems[0].side,'W');assert.equal(r.problems[0].best.move,'D4');assert.equal(r.problems[0].bestLine.moves.length,2);assert.equal(r.generatedAt,'2026-10-06T00:00:00.000Z');assert.equal(JSON.stringify(analysis),before);
});
test('reports require complete deep results; missing searched candidates remain explicitly unrated',()=>{
 assert.throws(()=>buildAiReport(source,{...analysis,phase:'quick'},{id:'x'}),/complete deep/);assert.throws(()=>buildAiReport(source,{...analysis,positions:analysis.positions.slice(1)},{id:'x'}),/complete deep/);
 const r=buildAiReport(source,{...analysis,positions:analysis.positions.map(({candidates,...p})=>p)},{id:'x'});assert.equal(r.players.B.ratedMoves,0);assert.equal(r.players.B.moves,1);assert.equal(r.players.W.moves,1);assert.equal(r.players.B.unratedMoves,1);assert.equal(r.players.W.unratedMoves,1);assert.equal(r.players.B.meanPointLoss,null);assert.equal(r.problems.length,0);
});
test('report separates estimated played evaluations from searched candidate values',()=>{
 const sparse={...analysis,positions:analysis.positions.map(p=>({...p,candidates:p.candidates.filter(c=>c.order===0)}))};const r=buildAiReport(source,sparse,{id:'x'});assert.equal(r.players.B.estimatedMoves,1);assert.equal(r.problems[1].playedEvaluation.blackLead,1);assert.equal(r.problems[1].playedLine,null);
});
test('report selects the five largest losses independently for each player',()=>{
 const source='(;SZ[19]'+Array.from({length:24},(_,n)=>';'+(n%2?'W':'B')+'[]').join('')+')';
 const positions=Array.from({length:25},(_,n)=>({nodeId:n,move:n,blackLead:0,blackWinrate:.5,candidates:n<24?[candidate('Q16',(n%2?-1:1)*(n+1)),candidate('pass',0,1)]:[]}));
 const report=buildAiReport(source,{...analysis,positions},{id:'x'});
 assert.equal(report.schemaVersion,5);
 assert.deepEqual(report.problems.filter(m=>m.side==='B').map(m=>m.move),[23,21,19,17,15]);
 assert.deepEqual(report.problems.filter(m=>m.side==='W').map(m=>m.move),[24,22,20,18,16]);
 assert.equal(report.problems.length,10);
});
test('loss statistics exclude unrated moves and compute severity, percentiles and win-rate drops',()=>{
 const values=[.25,1,3,6,12],ratings=['good','inaccuracy','mistake','blunder','blunder'],wins=[0,5,15,25,null];
 const items=values.map((pointLoss,n)=>({move:n+1,side:'B',quality:ratings[n],pointLoss,winrateLoss:wins[n],estimated:n===2||n===4,bestEvaluation:{blackLead:2,blackWinrate:n===3?.6:.5},playedEvaluation:{blackLead:n>=2?-2:1,blackWinrate:n===3?.35:.5}}));
 items.push({quality:null,pointLoss:99},{quality:'mistake',pointLoss:NaN});
 const s=summariseLosses(items);
 assert.equal(s.moves,7);assert.equal(s.ratedMoves,5);assert.equal(s.unratedMoves,2);assert.equal(s.badMoves,4);assert.equal(s.badPercent,80);assert.equal(s.totalBadPointLoss,22);assert.equal(s.meanPointLoss,4.45);assert.equal(s.meanBadPointLoss,5.5);assert.equal(s.medianBadPointLoss,4.5);assert.ok(Math.abs(s.p90BadPointLoss-10.2)<1e-9);assert.equal(s.maxBadPointLoss,12);assert.equal(s.worstPointLossMove,5);assert.equal(s.topFiveLossPercent,100);assert.deepEqual(s.counts,{inaccuracy:1,mistake:1,blunder:2});assert.deepEqual(s.lossBuckets.map(b=>b.count),[1,1,1,1]);assert.equal(s.meanBadWinrateLoss,15);assert.equal(s.winrateDrops10pp,2);assert.equal(s.winrateDrops20pp,1);assert.equal(s.availableLeadsLost,3);assert.equal(s.availableWinningChancesLost,1);assert.equal(s.badEstimatedMoves,2);assert.equal('goodMatchPercent' in s,false);
});
test('empty loss summaries use null for undefined averages; White opportunity counts use White perspective',()=>{
 const empty=summariseLosses([]);assert.equal(empty.meanBadPointLoss,null);assert.equal(empty.badPercent,null);assert.equal(empty.topFiveLossPercent,null);assert.equal(empty.maxBadWinrateLoss,null);
 const white=summariseLosses([{move:10,side:'W',quality:'mistake',pointLoss:4,winrateLoss:50,bestEvaluation:{blackLead:-1,blackWinrate:.2},playedEvaluation:{blackLead:3,blackWinrate:.7}}]);assert.equal(white.availableLeadsLost,1);assert.equal(white.availableWinningChancesLost,1);
});
