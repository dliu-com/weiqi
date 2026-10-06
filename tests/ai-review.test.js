import test from 'node:test';
import assert from 'node:assert/strict';
import {readSgf,kataCandidates,kataQuery} from '../src/sgf.js';
import {reviewMove,recommendedLine,gtpPoint} from '../src/ai-review.js';

const candidate=(move,order,lead,visits=100,pv=[move])=>({move,order,blackLead:lead,blackWinrate:.5,visits,pv});
test('Black and White move losses use their own perspective, with engine order selecting the best',()=>{
 const r=readSgf('(;SZ[19];B[dd];W[pp])');
 const a=new Map([[0,{candidates:[candidate('Q16',0,5),candidate('D16',1,1),candidate('A1',2,100,1)]}],[1,{blackLead:1,candidates:[candidate('D4',0,-3),candidate('Q4',1,4)]}],[2,{blackLead:4}]]);
 const black=reviewMove(r,1,a,'deep'),white=reviewMove(r,2,a,'deep');
 assert.equal(black.loss,4);assert.equal(black.quality,'mistake');assert.equal(black.best.move,'Q16');assert.deepEqual(black.alternatives.map(c=>c.move),['Q16']);
 assert.equal(white.loss,7);assert.equal(white.quality,'blunder');assert.equal(white.alternatives[0].move,'D4');
});
test('best move, quick uncertainty, unexplored played moves and older analyses are handled honestly',()=>{
 const r=readSgf('(;SZ[19];B[dd])'),a=new Map([[0,{candidates:[candidate('D16',0,4)]}],[1,{blackLead:3}]]);
 assert.equal(reviewMove(r,1,a,'deep').quality,'best');assert.equal(reviewMove(r,1,a,'quick').preliminary,true);
 a.set(0,{candidates:[candidate('Q16',0,4)]});const estimated=reviewMove(r,1,a,'deep');assert.equal(estimated.estimated,true);assert.equal(estimated.loss,1);assert.equal(estimated.quality,'inaccuracy');
 assert.equal(reviewMove(r,1,new Map([[0,{blackLead:4}]]),'deep').unavailable,true);
});
test('suggestions use actual parent IDs in SGF branches, rather than depth indexes',()=>{
 const r=readSgf('(;SZ[19];B[dd](;W[pp];B[qq])(;W[dp];B[pd]))'),node=r.nodes.at(-1),selected=r.nodes.length-1;
 const a=new Map([[node.parent,{candidates:[candidate('Q16',0,1)]}]]);
 assert.equal(reviewMove(r,selected,a,'deep').anchor,node.parent);assert.equal(reviewMove(r,selected,a,'deep').quality,'best');
});
test('PV replay captures, alternates sides, passes and leaves the record unchanged',()=>{
 const r=readSgf('(;SZ[19]AB[ba]AW[aa]PL[B])'),original=JSON.stringify(r);
 const line=recommendedLine(r,0,candidate('A18',0,3,100,['A18','pass','D16']));
 assert.equal(line.frames.length,4);assert.equal(line.frames[1].board[0],'.');assert.equal(line.frames[1].board[19],'B');assert.equal(line.frames[2].move.index,null);assert.equal(line.frames[3].move.side,'B');assert.equal(line.frames[3].board[60],'B');assert.equal(JSON.stringify(r),original);
});
test('illegal or malformed PV stops safely; pass and I-column coordinates are checked',()=>{
 const r=readSgf('(;SZ[19];B[dd])');const line=recommendedLine(r,1,candidate('Q16',0,0,100,['Q16','D16','Q4']));
 assert.equal(line.frames.length,2);assert.equal(line.truncated,true);assert.equal(gtpPoint('pass'),null);assert.equal(gtpPoint('J19'),8);assert.throws(()=>gtpPoint('I19'));
});
test('Japanese simple ko blocks immediate recapture but allows recapture after passes; Chinese superko remains enforced',()=>{
 const root='(;SZ[19]AB[ab][cb][ba]AW[bb][ac][cc][bd]PL[B]';
 const japanese=readSgf(root+'RU[Japanese])'),chinese=readSgf(root+'RU[Chinese])');
 assert.equal(recommendedLine(japanese,0,candidate('B17',0,0,100,['B17','B18'])).truncated,true);
 assert.equal(recommendedLine(japanese,0,candidate('B17',0,0,100,['B17','pass','pass','B18'])).frames.length,5);
 assert.equal(recommendedLine(chinese,0,candidate('B17',0,0,100,['B17','pass','pass','B18'])).truncated,true);
});
test('candidate storage is bounded, preserves an otherwise omitted played move and stops at bad PV coordinates',()=>{
 const moves=['A1','B1','C1','D1','E1','F1','G1','H1','J1','K1'];
 const raw=moves.map((move,order)=>({move,order,scoreLead:order,winrate:.5,visits:10,pv:[move,'pass','I19','Q4']})).reverse();
 const saved=kataCandidates(raw,'K1');assert.equal(saved.length,9);assert.equal(saved[0].move,'A1');assert.equal(saved.at(-1).move,'K1');assert.deepEqual(saved[0].pv,['A1','pass']);assert.equal(kataQuery(readSgf('(;SZ[19])'),'test').analysisPVLen,11);
});
