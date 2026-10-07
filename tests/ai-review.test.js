import test from 'node:test';
import assert from 'node:assert/strict';
import {readSgf,kataCandidates,kataQuery} from '../src/sgf.js';
import {reviewMove,nextMoveSuggestions,nextMoveComparison,recommendedLine,startRecommendedLine,lineContinuations,followLineContinuation,gtpPoint} from '../src/ai-review.js';

const candidate=(move,order,lead,visits=100,pv=[move])=>({move,order,blackLead:lead,blackWinrate:.5,visits,pv});
test('next-move suggestions use the displayed board, retain its stones and alternate players',()=>{
 const r=readSgf('(;SZ[19];B[dd];W[pp])'),original=JSON.stringify(r);
 const a=new Map([[0,{candidates:[candidate('Q16',0,5)]}],[1,{candidates:[candidate('Q4',0,-3),candidate('D4',1,-2.5)]}],[2,{candidates:[candidate('Q16',0,4)]}]]);
 const white=nextMoveSuggestions(r,1,a,'deep');assert.equal(white.anchor,1);assert.equal(white.side,'W');assert.equal(white.best.move,'Q4');assert.deepEqual(white.alternatives.map(c=>c.move),['Q4','D4']);
 const line=recommendedLine(r,white.anchor,white.best);assert.equal(line.frames[1].move.side,'W');assert.equal(line.frames[1].board[gtpPoint('D16')],'B');assert.equal(line.frames[1].board[gtpPoint('Q4')],'W');assert.equal(line.frames[1].depth,2);
 const black=nextMoveSuggestions(r,2,a,'deep');assert.equal(black.side,'B');assert.equal(black.anchor,2);assert.equal(black.best.move,'Q16');
 assert.equal(nextMoveSuggestions(r,0,a,'quick').side,'B');assert.equal(nextMoveSuggestions(r,0,a,'quick').preliminary,true);assert.equal(JSON.stringify(r),original);
});
test('unanalysed branches never borrow next-move candidates from their analysed parent',()=>{
 const r=readSgf('(;SZ[19];B[dd](;W[pp])(;W[dp]))'),selected=r.nodes.length-1;
 const a=new Map([[r.nodes[selected].parent,{candidates:[candidate('Q4',0,-1)]}]]);
 const next=nextMoveSuggestions(r,selected,a,'deep');assert.equal(next.anchor,selected);assert.equal(next.unavailable,true);assert.deepEqual(next.alternatives,[]);
});
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

test('comparison retains and highlights a poor recorded next move with a side-correct fallback estimate',()=>{
 const r=readSgf('(;SZ[19];B[dd];W[pp])');
 const a=new Map([[1,{candidates:[candidate('D4',0,-3),candidate('Q4',4,4,1)]}],[2,{blackLead:4,blackWinrate:.8}]]);
 const original=JSON.stringify(r),next=nextMoveComparison(r,1,a,'deep');
 assert.deepEqual(next.rows.map(row=>row.move),['D4','Q4']);
 const played=next.rows.find(row=>row.actual);assert.equal(played.actualNode,2);assert.equal(played.quality,'blunder');assert.equal(played.loss,7);assert.equal(played.estimated,true);assert.equal(played.blackWinrate,.8);assert.equal(JSON.stringify(r),original);
});
test('a recorded best move is highlighted once, with zero loss, including a pass',()=>{
 const r=readSgf('(;SZ[19];B[])'),a=new Map([[0,{candidates:[candidate('pass',0,2,1)]}],[1,{blackLead:1}]]);
 const next=nextMoveComparison(r,0,a,'quick');assert.equal(next.rows.length,1);assert.equal(next.rows[0].actual,true);assert.equal(next.rows[0].move,'pass');assert.equal(next.rows[0].loss,0);assert.equal(next.rows[0].quality,'best');assert.equal(next.rows[0].estimated,false);
 assert.equal(nextMoveComparison(r,1,a,'deep').rows.length,0);
});
test('comparison follows the displayed SGF branch and leaves an unknown played evaluation unrated',()=>{
 const r=readSgf('(;SZ[19];B[dd](;W[pp])(;W[dp];B[pd]))'),branch=r.nodes[1].children[1];
 const a=new Map([[branch,{candidates:[candidate('D4',0,3)]}]]),next=nextMoveComparison(r,branch,a,'deep');
 const played=next.rows.find(row=>row.actual);assert.equal(played.actualNode,r.nodes[branch].children[0]);assert.equal(played.move,'Q16');assert.equal(played.loss,null);assert.equal(played.quality,null);assert.equal(played.blackWinrate,undefined);
});

test('table overview shows the full numbered line; board exploration starts with one move',()=>{
 const r=readSgf('(;SZ[19];B[dd])'),c=candidate('A1',0,3,100,['A1','B1','C1','D1','E1','F1']),review={anchor:1,alternatives:[c]},saved=JSON.stringify(r);
 const overview=startRecommendedLine(r,review,c,true),line=startRecommendedLine(r,review,c);
 assert.equal(overview.overview,true);assert.equal(overview.offset,6);assert.equal(line.offset,1);
 let current=line;for(let i=0;i<5;i++){const choices=lineContinuations(r,current,new Map(),'deep');assert.equal(choices.length,1);assert.equal('blackLead' in choices[0],false);current=followLineContinuation(current,choices[0]);}
 assert.equal(current.offset,6);assert.deepEqual(lineContinuations(r,current,new Map(),'deep'),[]);assert.equal(JSON.stringify(r),saved);
});
test('follow-up choices require the complete saved prefix and deduplicate replies',()=>{
 const r=readSgf('(;SZ[19])'),a=candidate('A1',0,2,100,['A1','B1','C1']),b=candidate('A1',1,2,100,['A1','D1','E1']),c=candidate('F1',2,2,100,['F1','G1']);
 let line=startRecommendedLine(r,{anchor:0,alternatives:[a,b,c]},a);
 assert.deepEqual(lineContinuations(r,line,new Map(),'deep').map(c=>c.move),['B1','D1']);
 line=followLineContinuation(line,lineContinuations(r,line,new Map(),'deep')[1]);assert.deepEqual(lineContinuations(r,line,new Map(),'deep').map(c=>c.move),['E1']);
});
test('exact recorded continuations reuse genuine stored analyses, including when the origin PV is short',()=>{
 const r=readSgf('(;SZ[19];B[dd];W[pp])'),a=candidate('D16',0,3),b=candidate('Q4',0,-1,100,['Q4','C3']),analyses=new Map([[1,{candidates:[b]}]]);
 const line=startRecommendedLine(r,{anchor:0,alternatives:[a]},a),choices=lineContinuations(r,line,analyses,'deep');
 assert.equal(choices.length,1);assert.equal(choices[0].searched,true);assert.equal(choices[0].move,'Q4');const extended=followLineContinuation(line,choices[0]);assert.equal(extended.anchor,0);assert.equal(extended.offset,2);assert.equal(extended.frames[2].board[gtpPoint('D16')],'B');
 const offRecord=startRecommendedLine(r,{anchor:0,alternatives:[candidate('A1',0,3)]},candidate('A1',0,3));assert.deepEqual(lineContinuations(r,offRecord,analyses,'deep'),[]);
});
test('missing PVs offer only the searched first move; invalid replies never become suggestions',()=>{
 const r=readSgf('(;SZ[19];B[dd])'),c=candidate('Q4',0,3),review={anchor:1,alternatives:[c]};
 assert.deepEqual(lineContinuations(r,startRecommendedLine(r,review,c),new Map(),'deep'),[]);
 const broken=candidate('Q4',0,3,100,['Q4','D16','A1']);const line=startRecommendedLine(r,{anchor:1,alternatives:[broken]},broken);assert.equal(line.truncated,true);assert.deepEqual(lineContinuations(r,line,new Map(),'deep'),[]);
});
