import test from 'node:test';
import assert from 'node:assert/strict';
import {fullGameRecord} from '../src/report-game-record.js';

test('full game record numbers final stones and lists captured moves and passes',()=>{
 const board=Array(361).fill('.');board[0]='W';board[1]='B';
 const overview={board,numbers:[{index:1,side:'B',label:'1'},{index:0,side:'W',label:'4'},{index:1,side:'B',label:'5'}]};
 const reviews=[{move:1,side:'B',played:'B19'},{move:2,side:'W',played:'A18'},{move:3,side:'B',played:'A19'},{move:4,side:'W',played:'A19'},{move:5,side:'B',played:'B19'},{move:6,side:'W',played:'pass'}];
 const record=fullGameRecord(overview,reviews);
 assert.deepEqual(record.labels.map(m=>[m.index,m.label]).sort(),[[0,'4'],[1,'5']]);
 assert.deepEqual(record.hidden,[{move:1,side:'B',at:'B19'},{move:2,side:'W',at:'A18'},{move:3,side:'B',at:'A19'},{move:6,side:'W',at:'pass'}]);
 assert.equal(fullGameRecord(null,reviews),null);
});
