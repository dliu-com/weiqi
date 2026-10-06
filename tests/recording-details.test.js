import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingTree,recordingSgf,newRecordingSgf,populateRecordingDetails,recordingResultFields,recordingResultValue,setRecordingHandicap} from '../src/recording-tree.js';
import {draftPublication} from '../backend/draft-service.js';
import {gameResult} from '../src/game-result.js';
const request={expectedRevision:0,id:'12345678-1234-1234-1234-123456789abc'};

test('result options round-trip points, reasons, unspecified wins and other SGF outcomes',()=>{
 for(const [choice,margin,result]of [['Bpoints','1.5','B+1.5'],['Wpoints','12','W+12'],['BR','','B+R'],['WR','','W+R'],['BT','','B+T'],['WT','','W+T'],['BF','','B+F'],['WF','','W+F'],['B+','','B+'],['W+','','W+'],['0','','0'],['?','','?'],['Void','','Void']]){
  assert.equal(recordingResultValue(choice,margin),result);assert.equal(recordingResultFields(result).choice,choice);
  const record=recordingTree(newRecordingSgf());populateRecordingDetails(record);record.result=result;
  const saved=draftPublication({revision:0,sgf:recordingSgf(record)},request);assert.equal(recordingTree(saved.sgf).result,result);
 }
 assert.equal(recordingResultFields('W+Resign').choice,'WR');assert.equal(recordingResultFields('B+Time').choice,'BT');
 assert.equal(recordingResultFields('B+ Res').choice,'BR');assert.equal(recordingResultFields('W+unfamiliar').choice,'W+');assert.equal(recordingResultFields('unrecognized').choice,'?');
 assert.equal(recordingResultFields('W+Forfeit').choice,'WF');assert.equal(recordingResultFields('B+1.5').margin,'1.5');
 assert.match(gameResult('B+1.5').en,/1.5 points/);assert.match(gameResult('B+T').en,/on time/);assert.equal(gameResult('B+').en,'Black won');
 for(const margin of ['',0,-1,'1e10',Infinity,1001])assert.throws(()=>recordingResultValue('Bpoints',margin),/winning margin/);
});
test('venue is optional and survives imports, escaping, cloud publication and omission',()=>{
 const record=recordingTree('(;SZ[19]PC[Dublin Go Club];B[dd])');populateRecordingDetails(record);assert.equal(record.venue,'Dublin Go Club');
 record.venue='Room [A] \\ Dublin';const saved=draftPublication({revision:0,sgf:recordingSgf(record)},request);assert.equal(recordingTree(saved.sgf).venue,record.venue);
 record.venue='';const noVenue=recordingSgf(record);assert.equal(recordingTree(noVenue).venue,'');assert.ok(!noVenue.includes('PC['));
});
test('cloud publication requires valid game details and does not alter invalid drafts',()=>{
 const record=recordingTree(newRecordingSgf());populateRecordingDetails(record);record.date='2026-02-30';
 const current={revision:0,sgf:recordingSgf(record)},before=structuredClone(current);assert.throws(()=>draftPublication(current,request),e=>e.statusCode===400&&/date/.test(e.message));assert.deepEqual(current,before);
 record.date='2026-10-06';record.rootProperties.HA=['1.5'];assert.throws(()=>draftPublication({revision:0,sgf:recordingSgf(record)},request),/handicap/);
 record.rootProperties.HA=['10'];assert.throws(()=>draftPublication({revision:0,sgf:recordingSgf(record)},request),/handicap/);
});
test('changing integer handicap resets komi appropriately for the chosen rules',()=>{
 for(const rules of ['Japanese','Chinese','Korean','AGA'])for(const count of [0,1,9]){
  const record=recordingTree('(;SZ[19]RU['+rules+']KM[3.5])');populateRecordingDetails(record);
  const changed=setRecordingHandicap(setRecordingHandicap(record,count===0?1:0),count);
  assert.equal(changed.komi,count?0.5:['Chinese','AGA'].includes(rules)?7.5:6.5);
 }
 for(const count of [-1,1.5,10,'2'])assert.throws(()=>setRecordingHandicap(recordingTree(newRecordingSgf()),count),/0–9/);
});

test('optional player ranks survive import, edits, cloud publication and removal',()=>{
 const record=recordingTree('(;SZ[19]BR[5d]WR[2k];B[dd])');populateRecordingDetails(record);
 assert.deepEqual(record.playerRanks,{black:'5d',white:'2k'});
 record.playerRanks={black:'Professional [3] \\ rank',white:'1 dan'};
 const published=draftPublication({revision:0,sgf:recordingSgf(record)},request);
 assert.deepEqual(recordingTree(published.sgf).playerRanks,record.playerRanks);
 record.playerRanks={black:'',white:''};const source=recordingSgf(record);
 assert.ok(!source.includes('BR['));assert.ok(!source.includes('WR['));
 assert.deepEqual(recordingTree(source).playerRanks,{black:'',white:''});
});
