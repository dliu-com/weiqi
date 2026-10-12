import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_PHASES,gamePhases,phaseLosses,favouredByPhase,decidedFrom,leadChanges,phaseLeads,topLossShare,keyMoments} from '../src/report-insights.js';
test('game phases use fixed move numbers and stop at the last move',()=>{
 assert.deepEqual(GAME_PHASES.map(p=>[p.key,p.from,p.to]),[['opening',1,60],['middle',61,150],['endgame',151,Infinity]]);
 assert.deepEqual(gamePhases(272).map(p=>[p.from,p.to]),[[1,60],[61,150],[151,272]]);
 assert.deepEqual(gamePhases(120).map(p=>[p.key,p.to]),[['opening',60],['middle',120]]);
 assert.deepEqual(gamePhases(30).map(p=>[p.key,p.to]),[['opening',30]]);
});
test('phase losses average rated moves and count mistakes and blunders per side',()=>{
 const reviews=[{move:1,side:'B',quality:'best',pointLoss:0},{move:2,side:'W',quality:'mistake',pointLoss:3},{move:61,side:'B',quality:'blunder',pointLoss:6},{move:62,side:'W',quality:'good',pointLoss:.2},{move:63,side:'B',quality:'inaccuracy',pointLoss:1},{move:64,side:'W',quality:null,pointLoss:null}];
 const [opening,middle]=phaseLosses(reviews,64);
 assert.equal(opening.B.meanPointLoss,0);assert.equal(opening.W.errors,1);assert.equal(opening.W.totalPointLoss,3);
 assert.equal(middle.B.meanPointLoss,3.5);assert.equal(middle.B.errors,1);assert.equal(middle.W.moves,1);assert.equal(middle.W.meanPointLoss,.2);
});
test('winning-chance facts count favoured positions and the decisive move',()=>{
 const chart=[0,.4,.4,.6,.3,.95,.92,.97].map((blackWinrate,move)=>({move,blackWinrate,blackLead:0}));
 const [opening]=favouredByPhase(chart,7);
 assert.equal(opening.side,'B');assert.equal(Math.round(opening.percent),57);
 assert.deepEqual(decidedFrom(chart),{side:'B',move:5});
 assert.equal(decidedFrom(chart.slice(0,5)),null);
 assert.equal(favouredByPhase([{move:1,blackWinrate:.6},{move:2,blackWinrate:.4}],2)[0].side,null);
});
test('lead changes ignore leads of one point or less',()=>{
 const chart=[-5,2,.5,-.8,-3,4,0.2].map((blackLead,move)=>({move,blackLead,blackWinrate:.5}));
 assert.deepEqual(leadChanges(chart),{changes:2,leader:'B',since:5});
 assert.deepEqual(leadChanges(chart.map(p=>({...p,blackLead:p.blackLead/10}))),{changes:0,leader:null,since:null});
 const [phase]=phaseLeads(chart,6);
 assert.equal(phase.end,.2);assert.equal(phase.change.toFixed(1),'5.2');assert.deepEqual(phase.peak,{move:5,lead:4});
});
test('top losses share uses each side total',()=>{
 const reviews=[5,4,3,2,1,1].map((pointLoss,i)=>({move:i*2+1,side:'B',quality:'mistake',pointLoss})).concat({move:2,side:'W',quality:'best',pointLoss:0});
 assert.deepEqual(topLossShare(reviews,'B'),{total:16,top:15,percent:93.75});
 assert.equal(topLossShare(reviews,'W').percent,null);
});
test('key moments stop at the decided move and need both point and win-chance loss',()=>{
 const chart=Array.from({length:201},(_,move)=>({move,blackWinrate:move>=150?.95:.5}));
 const moves=[{move:100,side:'B',pointLoss:1.5,winrateLoss:40},{move:110,side:'B',pointLoss:12,winrateLoss:2},{move:120,side:'B',pointLoss:3,winrateLoss:10},{move:130,side:'B',pointLoss:6,winrateLoss:8},{move:150,side:'W',pointLoss:4,winrateLoss:30},{move:170,side:'W',pointLoss:20,winrateLoss:5}];
 const key=keyMoments(moves,chart);
 assert.equal(key.scope.mode,'decided');assert.equal(key.scope.decided.move,150);
 assert.deepEqual(key.B.map(m=>m.move),[130,120]);assert.deepEqual(key.W.map(m=>m.move),[150]);
});
test('key moments use point loss alone when the game was decided in the opening',()=>{
 const chart=Array.from({length:201},(_,move)=>({move,blackWinrate:move>=20?.97:.6}));
 const key=keyMoments([{move:100,side:'W',pointLoss:3,winrateLoss:0},{move:150,side:'W',pointLoss:9,winrateLoss:1},{move:90,side:'B',pointLoss:1,winrateLoss:0}],chart);
 assert.equal(key.scope.mode,'early');assert.deepEqual(key.W.map(m=>m.move),[150,100]);assert.deepEqual(key.B,[]);
});
