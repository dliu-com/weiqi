import test from 'node:test';
import assert from 'node:assert/strict';
import {RecordingSequenceEdit} from '../src/recording-sequence-edit.js';
import {recordingTree,recordingSgf} from '../src/recording-tree.js';
import {createDraft,draftTransition} from '../backend/draft-service.js';

test('a missing pair can be inserted together, retaining colours, comments and variations',()=>{
 const source='(;SZ[19];B[dd];W[pp](;B[qq]C[Keep this];W[qp])(;B[dp];W[dc]))',original=recordingTree(source),edit=new RecordingSequenceEdit(original,1);
 edit.insert(1,180);edit.insert(edit.selected,181);
 const next=draftTransition({...createDraft(),sgf:source},{expectedRevision:0,...edit.submission()});
 const saved=recordingTree(next.sgf);assert.equal(saved.nodes.length,original.nodes.length+2);
 assert.deepEqual(saved.mainLine.slice(1).map(id=>saved.nodes[id].move.side),['B','W','B','W','B','W']);
 assert.equal(saved.nodes[4].children.length,2);assert.equal(saved.nodes[5].comment,'Keep this');assert.equal(recordingSgf(original),recordingSgf(recordingTree(source)));
});
test('temporarily illegal corrections are not locally rejected; cloud rejects without changing its draft',()=>{
 const source='(;SZ[19];B[dd];W[pp];B[qq])',cloud={...createDraft(),sgf:source},before=structuredClone(cloud),edit=new RecordingSequenceEdit(recordingTree(source),1);
 edit.insert(1,300);assert.ok(edit.previewIssues.length);const invalid=edit.submission();
 assert.throws(()=>draftTransition(cloud,{expectedRevision:0,...invalid}),/Illegal move at SGF position 3/);assert.deepEqual(cloud,before);
 // Repair the conflicting later move inside the same workspace.
 edit.reposition(2,288);edit.insert(4,181);const next=draftTransition(cloud,{expectedRevision:0,...edit.submission()});assert.equal(next.revision,1);assert.equal(recordingTree(next.sgf).nodes.length,6);
});
test('deleting a pair and repositioning it preserves the later continuation without re-entry',()=>{
 const source='(;SZ[19];B[dd];W[dp];B[pd];W[pp];B[qq])',edit=new RecordingSequenceEdit(recordingTree(source),3);
 edit.delete(3);edit.delete(2);const next=draftTransition({...createDraft(),sgf:source},{expectedRevision:0,...edit.submission()});
 const saved=recordingTree(next.sgf);assert.deepEqual(saved.mainLine.slice(1).map(id=>saved.nodes[id].move),[{side:'B',index:60},{side:'W',index:300},{side:'B',index:320}]);
});
test('cancel or refreshing from the cloud discards all local sequence changes',()=>{
 const source='(;SZ[19];B[dd];W[pp])',original=recordingTree(source),edit=new RecordingSequenceEdit(original,1);edit.insert(1,null);edit.reposition(2,180);
 assert.equal(edit.cancel().selected,1);assert.equal(recordingSgf(edit.cancel().record),recordingSgf(original));assert.equal(recordingSgf(recordingTree(source)),recordingSgf(original));
});
test('cloud checks every variation and refuses a stale Apply without overwriting another device',()=>{
 const source='(;SZ[19];B[dd](;W[pp])(;W[dp]))',edit=new RecordingSequenceEdit(recordingTree(source),1),cloud={...createDraft(),sgf:source};edit.reposition(3,60);
 assert.throws(()=>draftTransition(cloud,{expectedRevision:0,...edit.submission(2)}),/Illegal move/);assert.equal(cloud.sgf,source);
 edit.reposition(3,180);cloud.revision=1;assert.throws(()=>draftTransition(cloud,{expectedRevision:0,...edit.submission(2)}),e=>e.statusCode===409);assert.equal(cloud.sgf,source);
});

test('cloud rejects a single deleted move until alternation is repaired, including passes and other branches',()=>{
 const source='(;SZ[19];B[dd];W[dp];B[pd];W[pp])',cloud={...createDraft(),sgf:source},edit=new RecordingSequenceEdit(recordingTree(source),2);
 edit.delete(2);assert.ok(edit.previewIssues.length);assert.throws(()=>draftTransition(cloud,{expectedRevision:0,...edit.submission()}),e=>e.statusCode===400&&/alternate/.test(e.message));assert.equal(cloud.sgf,source);
 edit.delete(3);assert.equal(edit.previewIssues.length,0);const next=draftTransition(cloud,{expectedRevision:0,...edit.submission()});assert.deepEqual(recordingTree(next.sgf).mainLine.slice(1).map(id=>recordingTree(next.sgf).nodes[id].move.side),['B','W']);
 for(const sgf of ['(;SZ[19];B[];B[dd])','(;SZ[19];B[dd](;W[pp])(;B[pd]))'])assert.throws(()=>draftTransition(cloud,{expectedRevision:0,sgf,selected:1}),/alternate/);
});
