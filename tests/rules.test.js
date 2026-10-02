import test from 'node:test';
import assert from 'node:assert/strict';
import { play, score, gameTree, reviewPosition } from '../src/engine.js';
import { createState, transition } from '../backend/game-service.js';
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
 assert.equal(act(undone,{type:'new',size:9}).size,19);
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
test('history limit still allows passing to finish, item remains below DynamoDB limit',()=>{
 let s=createState();s.history=Array.from({length:600},()=>({board:s.board,side:'black',captures:{black:0,white:0},passes:0,type:'move',index:0}));
 assert.throws(()=>act(s,{type:'move',index:1}),/600/);s=act(act(s,{type:'pass'}),{type:'pass'});assert.equal(s.phase,'scoring');assert.ok(Buffer.byteLength(JSON.stringify(s))<390000);
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
test('undo retains branches and every node reconstructs its original board',()=>{
 let s=createState(), positions=[];
 for(const index of [180,181,182]){s=act(s,{type:'move',index});positions.push(s.board);}
 s=act(s,{type:'undo'});s=act(s,{type:'move',index:200});
 assert.equal(s.tree.nodes.length,4);assert.equal(s.tree.nodes[3][0],1);
 for(let i=0;i<3;i++)assert.equal(reviewPosition(s,i).board,positions[i]);
 assert.equal(reviewPosition(s,3).board,s.board);
 assert.equal(reviewPosition(s,-1).board,createState().board);
 const restored=JSON.parse(JSON.stringify(s));assert.equal(reviewPosition(restored,2).board,positions[2]);
});
test('legacy games migrate without losing moves, captures or current position',()=>{
 let s=createState();for(const index of [0,1,19])s=act(s,{type:'move',index});
 delete s.tree;
 assert.equal(reviewPosition(s,2).board,s.board);
 const previous=s.board;s=act(s,{type:'undo'});assert.equal(reviewPosition(s,2).board,previous);
 s=act(s,{type:'new'});assert.equal(gameTree(s).nodes.length,0);
});
test('single result confirmation finishes scoring and rejects stale results',()=>{
 let s=act(createState(),{type:'move',index:180});
 s=act(act(s,{type:'pass'}),{type:'pass'});const oldRevision=s.revision;
 s=act(s,{type:'dead',index:180});
 assert.throws(()=>transition(s,{expectedRevision:oldRevision,action:{type:'finish'}}),e=>e.statusCode===409);
 s=act(s,{type:'finish'});assert.equal(s.phase,'ended');assert.equal(s.result.winner,'white');
 assert.throws(()=>act(s,{type:'move',index:181}));assert.throws(()=>act(s,{type:'finish'}));
});
