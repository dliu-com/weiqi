import test from 'node:test';
import assert from 'node:assert/strict';
import {createState,transition} from '../backend/game-service.js';
import {gameClock} from '../src/engine.js';

test('one-minute expiry excludes offline time and returning heartbeat resumes automatically',t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);
 let s=createState();const act=a=>s=transition(s,{expectedRevision:s.revision,action:a});
 act({type:'move',index:0});now+=5000;act({type:'heartbeat'});const revision=s.revision;
 now+=59999;assert.equal(gameClock(s).autoPaused,false);
 now+=1;assert.equal(gameClock(s).autoPaused,true);assert.equal(gameClock(s).white,5000);
 now+=3600000;act({type:'heartbeat'});assert.equal(s.clock.white,5000);assert.equal(s.revision,revision);
 now+=5000;act({type:'move',index:1});assert.equal(s.clock.white,10000);
});
test('heartbeats from either device keep the clock alive, but never override manual pause',t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);let s=createState();
 const act=a=>s=transition(s,{expectedRevision:s.revision,action:a});
 act({type:'move',index:0});
 for(let i=0;i<20;i++){now+=5000;act({type:'heartbeat'});}
 assert.equal(s.clock.white,100000);
 act({type:'clock',paused:true});now+=120000;act({type:'heartbeat'});
 assert.equal(s.clock.paused,true);assert.equal(s.clock.white,100000);
 act({type:'clock',paused:false});now+=3000;act({type:'heartbeat'});assert.equal(s.clock.white,103000);
});
