import test from 'node:test';
import assert from 'node:assert/strict';
import {readSgf,withGameInfo,sgfWithGameInfo} from '../src/sgf.js';
import {buildAiReport} from '../src/report-data.js';
// Admin game-info edits live in metadata.json (infoEditedAt); the saved SGF is never rewritten.
const source='(;GM[1]FF[4]SZ[19]KM[6.5]RU[Japanese]GN[Old name]PB[Old black]PW[Old white]BR[1d]DT[2026-10-01]PC[Club]RE[W+0.5]C[root comment];B[dd]C[first];W[pp](;B[dp])(;B[qd]))';
const edit={infoEditedAt:'2026-11-08T10:00:00.000Z',name:'Final ]\\ match',players:{black:'Ke Jie',white:'Old white'},playerRanks:{black:'9p',white:'7d'},date:'2026-11-01',venue:'',result:'B+R'};

test('without an edit the SGF and the record are returned unchanged',()=>{
 const record=readSgf(source);
 assert.equal(withGameInfo(record,{name:'Ignored'}),record);
 assert.equal(sgfWithGameInfo(source,{name:'Ignored'}),source);
 assert.equal(sgfWithGameInfo(source,null),source);
});

test('edited info is shown and downloaded; moves, komi, rules, comments and branches are kept',()=>{
 const before=readSgf(source),shown=withGameInfo(before,edit);
 assert.equal(shown.name,'Final ]\\ match');assert.deepEqual(shown.players,{black:'Ke Jie',white:'Old white'});
 assert.deepEqual(shown.playerRanks,{black:'9p',white:'7d'});assert.equal(shown.date,'2026-11-01');assert.equal(shown.venue,'');assert.equal(shown.result,'B+R');
 assert.equal(before.name,'Old name','the original record is not changed');
 const downloaded=sgfWithGameInfo(source,edit),after=readSgf(downloaded);
 for(const key of ['name','players','playerRanks','date','venue','result'])assert.deepEqual(after[key],shown[key],key);
 for(const key of ['size','komi','rules','mainLine'])assert.deepEqual(after[key],before[key],key);
 assert.equal(after.nodes.length,before.nodes.length);
 assert.match(downloaded,/C\[root comment\]/);assert.match(downloaded,/;B\[dd\]C\[first\];W\[pp\]\(;B\[dp\]\)\(;B\[qd\]\)\)$/);
 assert.doesNotMatch(downloaded,/PC\[/,'a cleared venue is removed');
 assert.equal((downloaded.match(/GN\[/g)||[]).length,1,'no duplicated properties');
 assert.equal(sgfWithGameInfo(downloaded,edit),downloaded,'applying the same edit again changes nothing');
});

test('an info edit can never inject SGF properties or moves',()=>{
 const hostile={...edit,name:'x]AB[dd][ee]C[',players:{black:'a\\]B[aa]',white:'w'}};
 const after=readSgf(sgfWithGameInfo(source,hostile)),before=readSgf(source);
 assert.equal(after.name,hostile.name);assert.equal(after.players.black,hostile.players.black);
 assert.deepEqual(after.mainLine,before.mainLine);assert.equal(after.nodes.length,before.nodes.length);
 assert.deepEqual(after.nodes[0].board,before.nodes[0].board,'no stones were added');
});

test('the AI report uses the edited game info',()=>{
 const game='(;SZ[19]GN[Old]PB[Old black]PW[Old white]RE[W+0.5];B[dd];W[pp])';
 const analysis={phase:'deep',visits:3000,positions:[0,1,2].map(n=>({nodeId:n,move:n,blackLead:0,blackWinrate:.5,candidates:[]}))};
 const plain=buildAiReport(game,analysis,{id:'2026110801',name:'Old'}),edited=buildAiReport(game,analysis,{id:'2026110801',...edit});
 assert.equal(plain.players.B.name,'Old black');assert.equal(plain.game.result,'W+0.5');
 assert.equal(edited.name,edit.name);assert.equal(edited.players.B.name,'Ke Jie');assert.equal(edited.game.result,'B+R');assert.equal(edited.game.date,'2026-11-01');
});
