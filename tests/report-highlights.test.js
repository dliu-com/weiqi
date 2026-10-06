import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReportHighlights} from '../src/report-highlights.js';
test('three bad moves per side drive both diagrams and loss concentration without changing cached data',()=>{
 const problems=['W','B'].flatMap(side=>[2,10,6,8,4].map((pointLoss,i)=>({side,move:i+1,pointLoss,quality:'mistake'})));
 const report={problems,players:{B:{totalPointLoss:40},W:{totalPointLoss:60}}},original=JSON.stringify(report),view=selectReportHighlights(report);
 assert.deepEqual(view.problems.filter(m=>m.side==='B').map(m=>m.pointLoss),[10,8,6]);
 assert.deepEqual(view.problems.filter(m=>m.side==='W').map(m=>m.pointLoss),[10,8,6]);
 assert.equal(view.players.B.highlightLossPercent,60);assert.equal(view.players.W.highlightLossPercent,40);
 assert.equal(JSON.stringify(report),original);
});
test('fewer qualifying moves and a zero-loss side do not invent highlights or percentages',()=>{
 const view=selectReportHighlights({problems:[{side:'B',move:2,pointLoss:1,quality:'inaccuracy'},{side:'B',move:1,pointLoss:.2,quality:'good'},{side:'W',move:3,pointLoss:NaN,quality:'mistake'}],players:{B:{totalPointLoss:1.2},W:{totalPointLoss:0}}});
 assert.equal(view.problems.length,1);assert.equal(view.problems[0].move,2);assert.ok(Math.abs(view.players.B.highlightLossPercent-100/1.2)<1e-10);assert.equal(view.players.W.highlightLossPercent,null);
});
