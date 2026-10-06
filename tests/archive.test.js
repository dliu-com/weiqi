import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createState,transition,GameError} from '../backend/game-service.js';
import {gameTree,gameClock,sgf} from '../src/engine.js';
function api() {
 const items=new Map();
 class GetItemCommand{constructor(input){this.input=input;}}
 class PutItemCommand{constructor(input){this.input=input;}}
 class ScanCommand{constructor(input){this.input=input;}}
 class TransactWriteItemsCommand{constructor(input){this.input=input;}}
 function validate(p){if(p.Item.gameId.S==='mutation-budget')return;const old=items.get(p.Item.gameId.S);if(old && (!p.ExpressionAttributeValues || (+old.revision.N!==+p.ExpressionAttributeValues[':expected'].N || +(old.clockVersion?.N || 0)!==+p.ExpressionAttributeValues[':clockVersion'].N))){const e=new Error();e.name='ConditionalCheckFailedException';throw e;}}
 class DynamoDBClient{async send(c){
  if(c instanceof GetItemCommand)return {Item:structuredClone(items.get(c.input.Key.gameId.S))};
  if(c instanceof ScanCommand)return {Items:[...items.values()]};
  if(c instanceof TransactWriteItemsCommand){for(const p of c.input.TransactItems)validate(p.Put);for(const p of c.input.TransactItems)items.set(p.Put.Item.gameId.S,structuredClone(p.Put.Item));return {};}
  validate(c.input);items.set(c.input.Item.gameId.S,structuredClone(c.input.Item));return {};
 }}
 const exports={};vm.runInNewContext(readFileSync(new URL('../backend/handler.cjs',import.meta.url),'utf8'),{require:()=>({DynamoDBClient,GetItemCommand,PutItemCommand,ScanCommand,TransactWriteItemsCommand}),exports,Buffer,console,process:{env:{}},createState,transition,GameError,gameTree,gameClock});
 return async(path,body)=>{const r=await exports.handler({rawPath:path,requestContext:{http:{method:body?'POST':'GET'}},headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.statusCode,...JSON.parse(r.body)};};
}
test('manual resets cannot discard a live game without saving',async()=>{
 const call=api();let s=(await call('/api/game')).state;s=(await call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:180}})).state;const result=await call('/api/game',{expectedRevision:s.revision,action:{type:'new'}});assert.equal(result.status,400);assert.equal((await call('/api/games')).games.length,0);assert.equal((await call('/api/game')).state.history.length,1);
});
test('clock charges the correct player, excludes pauses, and records move timestamps',t=>{
 let now=100000;t.mock.method(Date,'now',()=>now);
 let s=createState();const act=a=>s=transition(s,{expectedRevision:s.revision,action:a});
 act({type:'move',index:180});now+=5000;act({type:'clock',paused:true});assert.equal(s.clock.white,5000);
 now+=60000;assert.equal(gameClock(s).white,5000);assert.throws(()=>act({type:'pass'}));
 act({type:'clock',paused:false});now+=3000;act({type:'move',index:181});
 assert.equal(s.clock.white,8000);assert.equal(s.tree.nodes[1][4],new Date(now).toISOString());assert.deepEqual(s.tree.nodes[1][5],[0,8000]);
 now+=2000;act({type:'pass'});now+=1000;act({type:'pass'});const end=gameClock(s);now+=99999;assert.deepEqual(gameClock(s),end);
});
test('SGF escapes metadata, excludes undone moves and includes timing',()=>{
 let s=createState();const act=a=>s=transition(s,{expectedRevision:s.revision,action:a});
 act({type:'metadata',name:'A]B\\C',players:{black:'甲',white:'乙'}});act({type:'move',index:0});act({type:'pass'});act({type:'undo'});act({type:'move',index:1});
 const output=sgf(s);assert.ok(output.includes('GN[A\\]B\\\\C]'));assert.ok(output.includes('PB[甲]PW[乙]'));
 assert.ok(!output.includes(';W[]'));assert.ok(output.includes(';W[ba]'));assert.ok(output.includes('Played at:'));assert.ok(output.includes('White total:'));
});

test('heartbeat and a move racing do not overwrite each other or conflict on game revision',async()=>{
 const call=api();
 const first=(await call('/api/game',{expectedRevision:0,action:{type:'move',index:0}})).state;
 const responses=await Promise.all([
  call('/api/game',{action:{type:'heartbeat'}}),
  call('/api/game',{expectedRevision:first.revision,action:{type:'move',index:1}})
 ]);
 assert.ok(responses.every(r=>r.status===200));
 const state=(await call('/api/game')).state;assert.equal(state.revision,2);assert.equal(state.history.length,2);
});
