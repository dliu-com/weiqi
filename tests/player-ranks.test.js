import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,transition} from '../backend/game-service.js';
import {sgf} from '../src/engine.js';
import {readSgf} from '../src/sgf.js';

test('live game rank changes are optional, validated and exported as SGF ranks',()=>{
 const initial=createState(),before=structuredClone(initial),players={black:'Alice',white:'Bob'};
 const update=(state,extra={})=>transition(state,{expectedRevision:state.revision,action:{type:'metadata',name:'Ranked game',players,...extra}});
 const ranked=update(initial,{playerRanks:{black:' 3d ',white:'1k'}});
 assert.deepEqual(readSgf(sgf(ranked)).playerRanks,{black:'3d',white:'1k'});
 assert.deepEqual(update(ranked).playerRanks,ranked.playerRanks);
 const cleared=update(ranked,{playerRanks:{black:'',white:''}});
 assert.deepEqual(readSgf(sgf(cleared)).playerRanks,{black:'',white:''});
 assert.deepEqual(initial,before);
 for(const playerRanks of [null,{black:3,white:''},{black:'x'.repeat(201),white:''}])assert.throws(()=>update(ranked,{playerRanks}));
});
