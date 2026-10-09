import test from 'node:test';
import assert from 'node:assert/strict';
import {timeControlFields,timeControlValue,timeControlSummary} from '../src/time-control.js';
import {recordingTree,recordingSgf,populateRecordingDetails} from '../src/recording-tree.js';
import {draftPublication} from '../backend/draft-service.js';
import {readSgf} from '../src/sgf.js';
import {createState,transition} from '../backend/game-service.js';
import {withMoves} from './fixtures/long-game.js';
import {sgf} from '../src/engine.js';

test('optional absolute, Japanese byo-yomi and Fischer controls round-trip through the cloud and SGF',()=>{
 for(const fields of [{type:''},{type:'absolute',minutes:60},{type:'byoyomi',minutes:30,periods:5,seconds:30},{type:'byoyomi',minutes:0,periods:3,seconds:10},{type:'fischer',minutes:10,increment:5}]){
  const value=timeControlValue(fields),record=recordingTree(withMoves('(;SZ[19];B[dd])',50,'W'));populateRecordingDetails(record);record.timeControl=value;
  const published=draftPublication({revision:0,sgf:recordingSgf(record)},{expectedRevision:0,id:'12345678-1234-1234-1234-123456789abc'});
  assert.deepEqual(readSgf(published.sgf).timeControl,value);
  const parsed=timeControlFields(value);assert.equal(parsed.type,fields.type);assert.deepEqual(timeControlValue(parsed),value);
 }
 assert.equal(timeControlSummary({mainSeconds:1800,overtime:'5x30 byo-yomi'}),'Japanese byo-yomi: 30 min + 5 × 30 sec');
 assert.equal(timeControlSummary({mainSeconds:600,overtime:'Fischer: 5 seconds increment'}),'Fischer: 10 min + 5 sec per move');
 assert.equal(timeControlSummary({mainSeconds:3600,overtime:''}),'Absolute time: 60 min');
});
test('unknown imported overtime is preserved until explicitly replaced or cleared',()=>{
 const record=recordingTree('(;SZ[19]TM[1800]OT[25 moves / 10 min])'),before=record.timeControl;
 assert.deepEqual(timeControlValue(timeControlFields(before)),before);
 record.name='Changed title';assert.deepEqual(readSgf(recordingSgf(record)).timeControl,before);
 record.timeControl=null;const cleared=recordingSgf(record);assert.ok(!cleared.includes('TM['));assert.ok(!cleared.includes('OT['));
 for(const source of ['(;SZ[19]TM[NaN])','(;SZ[19]TM[-1])','(;SZ[19]TM[999999999])'])assert.throws(()=>readSgf(source),/main time/);
 for(const fields of [{type:'byoyomi',minutes:30,periods:1.5,seconds:30},{type:'fischer',minutes:10,increment:-1},{type:'absolute',minutes:Infinity}])assert.throws(()=>timeControlValue(fields));
});
test('live game accepts optional time-control metadata without changing its running clock',()=>{
 const initial=createState(),value={mainSeconds:1800,overtime:'5x30 byo-yomi'};
 const next=transition(initial,{expectedRevision:0,action:{type:'metadata',name:'Test',players:{black:'A',white:'B'},timeControl:value}});
 assert.deepEqual(readSgf(sgf(next)).timeControl,value);assert.equal(next.phase,'play');assert.equal(next.history.length,0);
 for(const timeControl of [{mainSeconds:-1,overtime:''},{mainSeconds:10,overtime:3},{mainSeconds:Infinity,overtime:''}])assert.throws(()=>transition(initial,{expectedRevision:0,action:{type:'metadata',name:'Test',players:{black:'A',white:'B'},timeControl}}));
});
