import test from 'node:test';
import assert from 'node:assert/strict';
import {selectReportHighlights} from '../src/report-highlights.js';
const even=Array.from({length:30},(_,move)=>({move,blackLead:0,blackWinrate:.5}));
test('key moments need both point and win-chance loss and three per side get board reviews without changing cached data',()=>{
 const problems=['W','B'].flatMap(side=>[[3,10],[10,20],[6,30],[8,5],[4,40],[1.5,60]].map(([pointLoss,winrateLoss],i)=>({side,move:i+1+(side==='W'?10:0),pointLoss,winrateLoss,quality:'mistake'})));
 const report={problems,chart:even,players:{B:{},W:{}}},original=JSON.stringify(report),view=selectReportHighlights(report);
 assert.deepEqual(view.keyMoves.B.map(m=>m.pointLoss),[10,6,4,8,3]);
 assert.deepEqual(view.problems.filter(m=>m.side==='W').map(m=>m.pointLoss),[10,6,4]);
 assert.equal(view.keyScope.mode,'open');assert.equal(view.keyScope.decided,null);
 assert.equal(JSON.stringify(report),original);
});
test('fewer qualifying moves do not invent highlights; a missing chart is treated as undecided',()=>{
 const view=selectReportHighlights({problems:[{side:'B',move:2,pointLoss:2.5,winrateLoss:9,quality:'mistake'},{side:'B',move:1,pointLoss:.2,winrateLoss:9,quality:'good'},{side:'W',move:3,pointLoss:NaN,winrateLoss:9,quality:'mistake'}],players:{B:{},W:{}}});
 assert.equal(view.problems.length,1);assert.equal(view.problems[0].move,2);assert.deepEqual(view.keyMoves.W,[]);assert.equal(view.keyScope.mode,'open');
});
