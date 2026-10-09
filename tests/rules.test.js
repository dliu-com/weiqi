import test from 'node:test';
import assert from 'node:assert/strict';
import { play, score, gameTree, reviewPosition, sgf, MAX_GAME_MOVES } from '../src/engine.js';
import { readSgf } from '../src/sgf.js';
import { createState, transition, freshLiveGame } from '../backend/game-service.js';
const act = (s,action) => transition(s,{expectedRevision:s.revision,action});
test('capture removes a group with its last liberty filled',()=>{
 const b=['.B.','BWB','...'].join(''); const m=play(b,7,'black',3); assert.equal(m.board[4],'.');assert.deepEqual(m.captured,[4]);
});
test('suicide and occupied points are rejected',()=>{
 assert.throws(()=>play('.B.B.B.B.',4,'white',3),/禁入/);assert.throws(()=>play('B........',0,'white',3),/空/);
});
test('ko / repeated board position rejected',()=>{
 const board=['.....','.BW..','BW.W.','.BW..','.....'].join('');
 const move=play(board,12,'black',5);assert.equal(move.board[11],'.');
 assert.throws(()=>play(move.board,11,'white',5,[board]),/同形/);
});
test('area scoring counts stones and territory, mixed boundaries neutral',()=>{
 const s=score('BBBB.BBBB',3,[],7.5);assert.equal(s.black,9);assert.equal(s.white,0);assert.equal(s.margin,1.5);
 const mixed=score('B.......W',3,[],0);assert.equal(mixed.black,1);assert.equal(mixed.white,1);
});
test('shared game enforces revisions, fixed 19 board, undo restores state',()=>{
 const initial=createState();assert.equal(initial.board.length,361);
 const moved=act(initial,{type:'move',index:180});assert.equal(moved.turn,'white');
 assert.throws(()=>transition(moved,{expectedRevision:0,action:{type:'move',index:181}}),e=>e.statusCode===409);
 const undone=act(moved,{type:'undo'});assert.equal(undone.board,initial.board);assert.equal(undone.turn,'black');assert.equal(undone.revision,2);
 assert.throws(()=>act(undone,{type:'new',size:9}));assert.equal(freshLiveGame(act(undone,{type:'result',winner:'draw'})).size,19);
});
test('two passes enter scoring; changes clear agreement; both sides must confirm',()=>{
 let s=act(createState(),{type:'move',index:180});s=act(s,{type:'pass'});s=act(s,{type:'pass'});assert.equal(s.phase,'scoring');
 assert.throws(()=>act(s,{type:'move',index:181}));
 s=act(s,{type:'agree',side:'black'});s=act(s,{type:'dead',index:180});assert.deepEqual(s.agreed,[]);
 s=act(s,{type:'agree',side:'black'});assert.equal(s.phase,'scoring');s=act(s,{type:'agree',side:'white'});assert.equal(s.phase,'ended');assert.equal(s.result.winner,'white');
});
test('resume and resignation work',()=>{
 let s=act(act(createState(),{type:'pass'}),{type:'pass'});s=act(s,{type:'resume'});assert.equal(s.passes,0);
 s=act(s,{type:'resign',side:'white'});assert.equal(s.result.winner,'black');assert.throws(()=>act(s,{type:'pass'}));
});
test('games stop at the 400-move hard limit, can still record a result, and stay below the DynamoDB limit',()=>{
 assert.equal(MAX_GAME_MOVES,400);
 let s=createState();s.history=Array.from({length:MAX_GAME_MOVES},()=>({board:s.board,side:'black',captures:{black:0,white:0},passes:0,type:'move',index:0}));
 assert.throws(()=>act(s,{type:'move',index:1}),/400/);assert.throws(()=>act(s,{type:'pass'}),/400/);
 const ended=act(s,{type:'result',winner:'black',reason:'resign'});assert.equal(ended.phase,'ended');assert.equal(ended.history.length,MAX_GAME_MOVES);assert.ok(Buffer.byteLength(JSON.stringify(s))<390000);
 s.history.pop();s=act(s,{type:'pass'});assert.equal(s.history.length,MAX_GAME_MOVES);assert.throws(()=>act(s,{type:'pass'}),/400/);
});
test('undo restores captured stones and prisoner counts',()=>{
 let s=createState();const b=s.board.split('');
 for(const i of [1,19,21])b[i]='B';b[20]='W';s.board=b.join('');
 const captured=act(s,{type:'move',index:39});assert.equal(captured.board[20],'.');assert.equal(captured.captures.black,1);
 const undone=act(captured,{type:'undo'});assert.equal(undone.board,s.board);assert.equal(undone.captures.black,0);
});
test('marking dead stones does not destroy board and resume clears scoring',()=>{
 let s=act(createState(),{type:'move',index:180});s=act(act(s,{type:'pass'}),{type:'pass'});
 const before=s.board;s=act(s,{type:'dead',index:180});assert.equal(s.board,before);
 s=act(s,{type:'resume'});assert.equal(s.board,before);assert.deepEqual(s.dead,[]);assert.equal(s.phase,'play');
});
test('undo removes the withdrawn move and keeps earlier positions',()=>{
 let s=createState(), positions=[];
 for(const index of [180,181,182]){s=act(s,{type:'move',index});positions.push(s.board);}
 s=act(s,{type:'undo'});s=act(s,{type:'move',index:200});
 assert.equal(s.tree.nodes.length,3);assert.equal(s.tree.nodes[2][0],1);
 for(let i=0;i<2;i++)assert.equal(reviewPosition(s,i).board,positions[i]);
 assert.equal(reviewPosition(s,2).board,s.board);
 assert.equal(reviewPosition(s,-1).board,createState().board);
 const restored=JSON.parse(JSON.stringify(s));assert.equal(reviewPosition(restored,2).board,s.board);
});
test('legacy games migrate without losing moves, captures or current position',()=>{
 let s=createState();for(const index of [0,1,19])s=act(s,{type:'move',index});
 delete s.tree;
 assert.equal(reviewPosition(s,2).board,s.board);
 s=act(s,{type:'undo'});assert.equal(s.tree.nodes.length,2);assert.equal(reviewPosition(s,1).board,s.board);
 s=freshLiveGame(act(s,{type:'result',winner:'draw'}));assert.equal(gameTree(s).nodes.length,0);
 assert.deepEqual(s.lastResult,{generation:0,winner:null,reason:'agreed'});assert.deepEqual(freshLiveGame(act(s,{type:'resign',side:'white'}),'2026100601').lastResult,{generation:s.generation,winner:'black',reason:'resign'});
});
test('single result confirmation finishes scoring and rejects stale results',()=>{
 let s=act(createState(),{type:'move',index:180});
 s=act(act(s,{type:'pass'}),{type:'pass'});const oldRevision=s.revision;
 s=act(s,{type:'dead',index:180});
 assert.throws(()=>transition(s,{expectedRevision:oldRevision,action:{type:'finish'}}),e=>e.statusCode===409);
 s=act(s,{type:'finish'});assert.equal(s.phase,'ended');assert.equal(s.result.winner,'white');
 assert.throws(()=>act(s,{type:'move',index:181}));assert.throws(()=>act(s,{type:'finish'}));
});

test('legacy live branches are pruned and undo permanently removes the active move',()=>{
 let s=createState();for(const index of [0,1,2])s=act(s,{type:'move',index});
 const abandoned=structuredClone(s.tree.nodes[2]);
 s=act(s,{type:'undo'});s=act(s,{type:'move',index:3});
 const played=structuredClone(s.tree.nodes[2]);
 s.tree.nodes.splice(2,0,abandoned);s.tree.head=3;
 const original=JSON.stringify(s);
 const cleaned=act(s,{type:'heartbeat'});
 assert.equal(JSON.stringify(s),original);
 assert.deepEqual(cleaned.tree.nodes.map(n=>n[2]),[0,1,3]);
 assert.deepEqual(cleaned.tree.nodes[2].slice(4),played.slice(4));
 assert.equal(reviewPosition(cleaned,cleaned.tree.head).board,s.board);
 s=act(s,{type:'undo'});
 assert.deepEqual(s.tree.nodes.map(n=>n[2]),[0,1]);
 s=act(s,{type:'move',index:19});
 assert.deepEqual(s.tree.nodes.map(n=>n[0]),[-1,0,1]);
 assert.deepEqual(s.tree.nodes.map(n=>n[2]),[0,1,19]);
 assert.equal(reviewPosition(s,s.tree.head).board,s.board);
});

test('live handicap sets stones and fixed komi before the first move only',()=>{
 const meta=(s,extra)=>act(s,{type:'metadata',name:'Handicap game',players:{black:'',white:''},...extra});
 let s=meta(createState(),{rules:'Japanese',handicap:3,komi:99});
 assert.equal(s.handicap,3);assert.equal(s.komi,0.5);assert.equal(s.turn,'white');
 assert.deepEqual([...s.board].flatMap((c,i)=>c==='B'?[i]:[]),[3*19+15,15*19+3,15*19+15].sort((a,b)=>a-b));
 let record=readSgf(sgf(s));assert.equal(record.nodes[0].board,s.board);assert.equal(record.initialPlayer,'W');assert.match(sgf(s),/HA\[3\]/);
 s=meta(s,{rules:'Chinese',handicap:0});assert.equal(s.board,'.'.repeat(361));assert.equal(s.turn,'black');assert.equal(s.komi,7.5);assert.ok(!sgf(s).includes('HA['));
 s=meta(s,{rules:'Japanese',handicap:1});assert.equal(s.board,'.'.repeat(361));assert.equal(s.turn,'black');assert.equal(s.komi,0.5);assert.match(sgf(s),/HA\[1\]/);
 s=meta(s,{handicap:2});const setup=s.board;s=act(s,{type:'move',index:60});assert.equal(s.history[0].side,'white');
 assert.throws(()=>meta(s,{handicap:0}),/第一手/);
 s=meta(s,{rules:'Chinese',handicap:2,komi:7.5});assert.equal(s.komi,0.5);s=meta(s,{rules:'Chinese'});assert.equal(s.handicap,2);
 record=readSgf(sgf(s));assert.equal(record.nodes[0].board,setup);assert.equal(record.nodes.length,2);
 s=act(s,{type:'undo'});assert.equal(s.board,setup);assert.equal(s.turn,'white');
 for(const handicap of [-1,10,1.5,'2'])assert.throws(()=>meta(createState(),{handicap}));
 assert.equal(meta(createState(),{rules:'Japanese',komi:3}).komi,6.5);
});
