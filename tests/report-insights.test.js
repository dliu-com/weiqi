import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_PHASES,gamePhases,phaseLosses,favouredByPhase,decidedFrom,leadChanges,phaseEndLeads,topLossShare} from '../src/report-insights.js';
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
 assert.deepEqual(phaseEndLeads(chart,6).map(p=>[p.to,p.lead]),[[6,.2]]);
});
test('top losses share uses each side total',()=>{
 const reviews=[5,4,3,2,1,1].map((pointLoss,i)=>({move:i*2+1,side:'B',quality:'mistake',pointLoss})).concat({move:2,side:'W',quality:'best',pointLoss:0});
 assert.deepEqual(topLossShare(reviews,'B'),{total:16,top:15,percent:93.75});
 assert.equal(topLossShare(reviews,'W').percent,null);
});
