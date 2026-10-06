import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {recordingTree,recordingSgf,newRecordingSgf,addRecordingMove,promoteRecordingBranch,deleteRecordingBranch,mainRecordingSgf,RecordingNavigation,recordingTreeLayout,recordingNodeIndex,populateRecordingDetails,deleteRecordingMove,insertRecordingMove,repositionRecordingMove,setRecordingHandicap,defaultRecordingKomi,setRecordingRules} from '../src/recording-tree.js';
import {boardDisplayPoint} from '../src/board-geometry.js';
import {createDraft,draftTransition,draftPublication} from '../backend/draft-service.js';import {readSgf} from '../src/sgf.js';import {createState,transition} from '../backend/game-service.js';import {sgf} from '../src/engine.js';
test('recording branches promote and prune the selected main line without losing setup, captures or passes',()=>{
 const r=recordingTree('(;SZ[19]RU[Japanese]KM[6.5]PL[B]AB[ab][ba][cb]AW[bb];B[bc](;W[dd];B[])(;W[pp];B[qq]))');assert.equal(r.nodes[1].board[20],'.');const alternate=r.nodes[1].children[1];promoteRecordingBranch(r,alternate);assert.equal(readSgf(mainRecordingSgf(recordingSgf(r))).nodes[2].move.index,300);const added=addRecordingMove(r,1,180);assert.equal(r.nodes[1].children.length,3);const deleted=deleteRecordingBranch(r,added);assert.equal(deleted.selected,1);assert.equal(deleted.record.nodes[1].children.length,2);
 const p=addRecordingMove(deleted.record,deleted.record.mainLine.at(-1),null);assert.equal(deleted.record.nodes[p].move.index,null);assert.equal(readSgf(recordingSgf(deleted.record)).nodes.length,deleted.record.nodes.length);
});
test('draft revisions reject stale edits, pending saves lock editing, and publication removes alternatives',()=>{
 let d=createDraft();const r=recordingTree(d.sgf),b=addRecordingMove(r,0,60);addRecordingMove(r,b,300);addRecordingMove(r,b,288);d=draftTransition(d,{expectedRevision:0,sgf:recordingSgf(r),selected:b});assert.throws(()=>draftTransition(d,{expectedRevision:0,sgf:d.sgf,selected:0}),e=>e.statusCode===409);assert.throws(()=>draftTransition(d,{expectedRevision:1,sgf:'(;SZ[9])',selected:0}));const saved=draftPublication(d,{expectedRevision:1,id:'12345678-1234-1234-1234-123456789abc'});assert.equal(readSgf(saved.sgf).nodes.length,3);assert.equal(readSgf(saved.sgf).result,'0');assert.throws(()=>draftTransition(saved,{expectedRevision:2,sgf:saved.sgf,selected:0}),e=>e.statusCode===409);
});
test('finished live results and edited metadata survive publication to SGF',()=>{for(const winner of ['black','white','draw']){let s=createState();s=transition(s,{expectedRevision:0,action:{type:'metadata',name:'Public match',players:{black:'A',white:'B'},date:'2026-10-06',rules:'Japanese',komi:6.5}});s=transition(s,{expectedRevision:s.revision,action:{type:'result',winner}});const r=readSgf(mainRecordingSgf(sgf(s)));assert.equal(r.result,winner==='black'?'B+':winner==='white'?'W+':'0');assert.equal(r.rules,'Japanese');assert.equal(r.komi,6.5);assert.equal(r.date,'2026-10-06');}});
test('pretty routes preserve legacy links and map all new pages',()=>{const c={};vm.runInNewContext(readFileSync(new URL('../src/routes.cjs',import.meta.url),'utf8'),c);for(const [uri,want]of [['/','/'],['/play','/play.html'],['/record','/editor.html'],['/game','/library.html'],['/game/2026100621','/record.html'],['/record/2026100621/report','/report.html'],['/game/2026100621/report','/report.html'],['/cost','/cost.html'],['/security','/security.html']])assert.equal(c.handler({request:{uri,querystring:{}}}).uri,want);const old=c.handler({request:{uri:'/library.html',querystring:{lang:{value:'zh'}}}});assert.equal(old.statusCode,301);assert.equal(old.headers.location.value,'/game?lang=zh');});

test('changed sequences share their prefix and nested branches have distinct aligned lanes',()=>{
 const record=recordingTree('(;SZ[19];B[dd](;W[pp](;B[qq])(;B[dp];W[dc]))(;W[dp];B[pd]))');
 const layout=recordingTreeLayout(record),position=new Map(layout.positions.map(p=>[p.id,p]));
 assert.equal(layout.positions.length,record.nodes.length);
 assert.equal(new Set(layout.positions.map(p=>p.column+':'+p.lane)).size,record.nodes.length);
 for(const id of record.mainLine)assert.equal(position.get(id).lane,0);
 for(const p of layout.positions)assert.equal(p.column,record.nodes[p.id].depth);
 const fork=record.nodes[1].children;assert.equal(position.get(fork[0]).column,position.get(fork[1]).column);assert.ok(position.get(fork[1]).lane>position.get(fork[0]).lane);
 promoteRecordingBranch(record,fork[1]);const promoted=new Map(recordingTreeLayout(record).positions.map(p=>[p.id,p]));for(const id of record.mainLine)assert.equal(promoted.get(id).lane,0);
});
test('back and forward retrace the selected variation, including through the shared prefix',()=>{
 const record=recordingTree('(;SZ[19];B[dd](;W[pp];B[qq])(;W[dp];B[pd]))'),nav=new RecordingNavigation(),branch=record.nodes[1].children[1],leaf=record.nodes[branch].children[0];
 nav.remember(record,leaf);assert.equal(nav.step(record,leaf,-2),1);assert.equal(nav.step(record,1,2),leaf);assert.equal(nav.step(record,0,10),leaf);
 nav.remember(record,record.mainLine.at(-1));assert.equal(nav.step(record,1,2),record.mainLine.at(-1));
 record.nodes[1].children=record.nodes[1].children.slice(0,1);assert.equal(nav.next(record,1),record.nodes[1].children[0]);
});

test('the active sequence stays uninterrupted on one row, without changing the saved main branch',()=>{
 const record=recordingTree('(;SZ[19];B[dd](;W[pp](;B[qq];W[qp])(;B[dp];W[dq]))(;W[dp](;B[pd])(;B[cc];W[cd])))'),nav=new RecordingNavigation(),main=record.mainLine.slice(),leaf=record.nodes.length-1;
 nav.remember(record,leaf);let ids=[];for(let id=leaf;id!==null;id=record.nodes[id].parent)ids.push(id);
 for(const selected of [leaf,1,0]){const layout=recordingTreeLayout(record,selected,nav.continuations);for(const id of ids)assert.equal(layout.positions.find(p=>p.id===id).lane,0);assert.deepEqual(record.mainLine,main);assert.equal(new Set(layout.positions.map(p=>p.column+':'+p.lane)).size,record.nodes.length);}
});

test('saving and reopening a promoted branch preserves the actual selected board',()=>{
 const record=recordingTree('(;SZ[19];B[dd](;W[pp];B[])(;W[dp];B[pd]))'),leaf=record.nodes.length-1;
 promoteRecordingBranch(record,leaf);const saved=recordingTree(recordingSgf(record)),index=recordingNodeIndex(record,leaf);
 assert.equal(saved.nodes[index].board,record.nodes[leaf].board);assert.deepEqual(saved.nodes[index].move,record.nodes[leaf].move);
});


test('missing recording details are populated while imported metadata is preserved',()=>{
 const r=recordingTree('(;SZ[19];B[dd];W[pp])');assert.equal(populateRecordingDetails(r,new Date(2026,9,6)),true);
 assert.equal(r.name,'Recorded game');assert.deepEqual(r.players,{black:'Unnamed black player',white:'Unnamed white player'});assert.equal(r.date,'2026-10-06');assert.equal(r.komi,6.5);assert.equal(r.rules,'Japanese');assert.equal(r.result,'0');
 const saved=recordingTree(recordingSgf(r));assert.equal(populateRecordingDetails(saved),false);assert.equal(saved.nodes.length,3);
 const imported=recordingTree('(;SZ[19]GN[Match]PB[A]PW[B]DT[2020-01-02]RU[Chinese]KM[7.5]RE[W+R];B[dd])');assert.equal(populateRecordingDetails(imported),false);assert.equal(imported.name,'Match');assert.equal(imported.komi,7.5);
 const server=recordingTree(mainRecordingSgf('(;SZ[19];B[dd])'));assert.equal(server.players.black,'Unnamed black player');assert.match(server.date,/^\d{4}-\d{2}-\d{2}$/);assert.equal(server.komi,6.5);
});
test('single-move deletion and insertion retain following moves and both branches',()=>{
 const r=recordingTree('(;SZ[19];B[dd];W[pp](;B[qq];W[qp])(;B[dp];W[dc]))');
 const deleted=deleteRecordingMove(r,2);assert.equal(deleted.selected,1);assert.equal(deleted.record.nodes.length,r.nodes.length-1);assert.equal(deleted.record.nodes[1].children.length,2);assert.equal(deleted.record.nodes[2].move.side,'B');assert.equal(deleted.record.nodes[2].board[300],'.');
 const inserted=insertRecordingMove(r,1,180);assert.equal(inserted.record.nodes.length,r.nodes.length+1);assert.equal(inserted.record.nodes[inserted.selected].move.index,180);assert.equal(inserted.record.nodes[inserted.selected].move.side,'W');assert.equal(inserted.record.nodes[3].move.side,'W');assert.equal(inserted.record.nodes[3].children.length,2);assert.equal(inserted.record.nodes.at(-1).board[180],'W');
 assert.equal(r.nodes.length,7);assert.equal(r.nodes[1].children[0],2);
 const passed=insertRecordingMove(r,1,null);assert.equal(passed.record.nodes[passed.selected].move.index,null);
});
test('illegal corrections are atomic and do not delete later moves',()=>{
 const r=recordingTree('(;SZ[19];B[dd];W[pp])'),before=recordingSgf(r);assert.throws(()=>insertRecordingMove(r,1,300),/later move illegal/);assert.equal(recordingSgf(r),before);
 const capture=recordingTree('(;SZ[19]AB[ab][ba][cb]AW[bb];B[bc];B[bb])'),captured=recordingSgf(capture);assert.throws(()=>deleteRecordingMove(capture,1),/later move illegal/);assert.equal(recordingSgf(capture),captured);
});
test('fixed handicap sets setup stones and White to move, then locks once recording begins',()=>{
 for(const count of [0,1,2,3,4,5,6,7,8,9]){const r=setRecordingHandicap(recordingTree(newRecordingSgf()),count),saved=recordingTree(recordingSgf(r));assert.equal([...saved.nodes[0].board].filter(s=>s==='B').length,count);assert.equal(saved.initialPlayer,count?'W':'B');assert.equal(saved.komi,count?0.5:6.5);assert.equal(Number(saved.rootProperties.HA[0]),count);}
 const r=setRecordingHandicap(recordingTree(newRecordingSgf()),2);addRecordingMove(r,0,180);assert.throws(()=>setRecordingHandicap(r,4),/before recording/);
 const one=setRecordingHandicap(recordingTree(newRecordingSgf()),1);assert.equal(one.nodes[0].board[180],'B');assert.throws(()=>setRecordingHandicap(recordingTree(newRecordingSgf()),10),/0–9/);
});

test('four board views preserve canonical coordinates and round-trip every intersection',()=>{
 assert.equal(boardDisplayPoint(0,1),18);assert.equal(boardDisplayPoint(0,2),360);assert.equal(boardDisplayPoint(0,3),342);
 for(let rotation=0;rotation<4;rotation++){const displayed=Array.from({length:361},(_,i)=>boardDisplayPoint(i,rotation));assert.equal(new Set(displayed).size,361);for(let i=0;i<361;i++)assert.equal(boardDisplayPoint(displayed[i],-rotation),i);}
 assert.equal(boardDisplayPoint(60,4),60);assert.equal(boardDisplayPoint(180,3),180);
});

test('repositioning changes only the selected coordinate and replays later branches',()=>{
 const r=recordingTree('(;SZ[19];B[dd](;W[pp];B[qq])(;W[dp];B[pd]))'),before=recordingSgf(r),changed=repositionRecordingMove(r,1,180);
 assert.equal(changed.record.nodes.length,r.nodes.length);assert.equal(changed.record.nodes[1].move.index,180);assert.equal(changed.record.nodes[1].move.side,'B');assert.equal(changed.record.nodes[1].children.length,2);assert.equal(changed.record.nodes.at(-1).board[60],'.');assert.equal(changed.record.nodes.at(-1).board[180],'B');assert.equal(recordingSgf(r),before);
 assert.throws(()=>repositionRecordingMove(r,1,300),/later move illegal/);assert.equal(recordingSgf(r),before);
});


test('komi defaults follow rules and handicap while preserving explicitly supplied custom values',()=>{
 for(const [rules,komi]of [['Japanese',6.5],['Korean',6.5],['Chinese',7.5],['AGA',7.5]]){
  const r=recordingTree('(;SZ[19]RU['+rules+'])');populateRecordingDetails(r);assert.equal(r.komi,komi);assert.equal(defaultRecordingKomi(rules,2),0.5);
  const handicap=setRecordingHandicap(r,2);assert.equal(handicap.komi,0.5);assert.equal(setRecordingHandicap(handicap,0).komi,komi);
 }
 const changed=setRecordingRules(recordingTree(newRecordingSgf()),'Chinese');assert.equal(changed.komi,7.5);assert.equal(setRecordingRules(changed,'Japanese').komi,6.5);
 const custom=recordingTree('(;SZ[19]RU[Japanese]KM[0])');populateRecordingDetails(custom);assert.equal(custom.komi,0);assert.equal(setRecordingRules(custom,'Chinese').komi,0);assert.equal(setRecordingHandicap(custom,2).komi,0.5);
 const sgf=recordingTree('(;SZ[19]RU[Chinese]KM[6.5])');populateRecordingDetails(sgf);assert.equal(sgf.komi,6.5);
 assert.equal(recordingTree(mainRecordingSgf('(;SZ[19]RU[Chinese];B[dd])')).komi,7.5);
});
