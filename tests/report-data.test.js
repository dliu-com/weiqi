import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAiReport} from '../src/report-data.js';
const source='(;SZ[19]PB[Black Test]PW[White Test];B[dd];W[pp])';
const candidate=(move,lead,order=0)=>({move,blackLead:lead,blackWinrate:.5,visits:100,order,pv:[move,'pass']});
const analysis={phase:'deep',visits:3000,positions:[{nodeId:0,move:0,blackLead:0,blackWinrate:.5,candidates:[candidate('Q16',4),candidate('D16',1,1)]},{nodeId:1,move:1,blackLead:1,blackWinrate:.5,candidates:[candidate('D4',-3),candidate('Q4',4,1)]},{nodeId:2,move:2,blackLead:4,blackWinrate:.5,candidates:[]}]};
test('report uses player perspectives, excludes unrated moves and selects largest losses without mutating analysis',()=>{
 const before=JSON.stringify(analysis),r=buildAiReport(source,analysis,{id:'2026100601',name:'Test'},new Date('2026-10-06T00:00:00Z'));
 assert.equal(r.players.B.meanPointLoss,3);assert.equal(r.players.W.meanPointLoss,7);assert.equal(r.players.W.counts.blunder,1);assert.equal(r.problems[0].move,2);assert.equal(r.problems[0].side,'W');assert.equal(r.problems[0].best.move,'D4');assert.equal(r.problems[0].bestLine.moves.length,2);assert.equal(r.generatedAt,'2026-10-06T00:00:00.000Z');assert.equal(JSON.stringify(analysis),before);
});
test('reports require complete deep results; missing searched candidates remain explicitly unrated',()=>{
 assert.throws(()=>buildAiReport(source,{...analysis,phase:'quick'},{id:'x'}),/complete deep/);assert.throws(()=>buildAiReport(source,{...analysis,positions:analysis.positions.slice(1)},{id:'x'}),/complete deep/);
 const r=buildAiReport(source,{...analysis,positions:analysis.positions.map(({candidates,...p})=>p)},{id:'x'});assert.equal(r.players.B.ratedMoves,0);assert.equal(r.players.B.meanPointLoss,null);assert.equal(r.problems.length,0);
});
test('report separates estimated played evaluations from searched candidate values',()=>{
 const sparse={...analysis,positions:analysis.positions.map(p=>({...p,candidates:p.candidates.filter(c=>c.order===0)}))};const r=buildAiReport(source,sparse,{id:'x'});assert.equal(r.players.B.estimatedMoves,1);assert.equal(r.problems[1].playedEvaluation.blackLead,1);assert.equal(r.problems[1].playedLine,null);
});
