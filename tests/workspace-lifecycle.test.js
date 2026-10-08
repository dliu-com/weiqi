import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createState,transition,GameError,freshLiveGame} from '../backend/game-service.js';
import {createDraft,draftTransition,draftPublication,freshSavedDraft} from '../backend/draft-service.js';
import {mainRecordingSgf,newRecordingSgf} from '../src/recording-tree.js';
import {sgf,score,MIN_LIBRARY_MOVES} from '../src/engine.js';
import {readSgf} from '../src/sgf.js';
function api(){
 const rows=new Map(),saved=new Map();let fail=false;
 class GetItemCommand{constructor(input){this.input=input;}}
 class PutItemCommand{constructor(input){this.input=input;}}
 class DynamoDBClient{async send(c){
  if(c instanceof GetItemCommand)return {Item:structuredClone(rows.get(c.input.Key.gameId.S))};
  const p=c.input,key=p.Item.gameId.S,old=rows.get(key),v=p.ExpressionAttributeValues;
  if(key!=='mutation-budget'&&old&&(Number(old.revision.N)!==Number((v[':expected']||v[':r']).N)||(v[':clockVersion']||v[':c'])&&Number(old.clockVersion?.N||0)!==Number((v[':clockVersion']||v[':c']).N))){const e=new Error();e.name='ConditionalCheckFailedException';throw e;}
  rows.set(key,structuredClone(p.Item));return {};
 }}
 const exports={};vm.runInNewContext(readFileSync(new URL('../backend/client-limit.cjs',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../backend/handler.cjs',import.meta.url),'utf8'),{exports,require:()=>({DynamoDBClient,GetItemCommand,PutItemCommand}),Buffer,console,process:{env:{}},createState,transition,GameError,freshLiveGame,MIN_LIBRARY_MOVES,createDraft,draftTransition,draftPublication,freshSavedDraft,mainRecordingSgf,newRecordingSgf,sgf,reportHash:createHash,libraryStore:{},uploadRecord:async(store,source,name,id)=>{if(fail)throw Error('Save failed');if(!saved.has(id))saved.set(id,{id:'2026100601',sgf:source});return saved.get(id);},enqueueSavedRecord:async()=>{}});
 async function call(path,body){const r=await exports.handler({rawPath:path,requestContext:{http:{method:body?'POST':'GET'}},headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.statusCode,...JSON.parse(r.body)};}
 // Stones on rows 0, 2 and 4 keep a liberty below, so the seed never captures.
 const seed=async(s,n=MIN_LIBRARY_MOVES)=>{for(let k=0;k<n;k++)s=(await call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:38*Math.floor(k/19)+k%19}})).state;return s;};
 return {call,seed,rows,saved,fail:value=>{fail=value;}};
}
test('finish saves the live game, then starts a clean game with a new revision',async()=>{
 const {call,seed,saved}=api();let s=(await call('/api/game')).state;
 s=(await call('/api/game',{expectedRevision:s.revision,action:{type:'metadata',name:'Completed game',players:{black:'A',white:'B'}}})).state;
 s=await seed(s);s=(await call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:60}})).state;
 const revision=s.revision,done=await call('/api/game',{expectedRevision:revision,action:{type:'result',winner:'white'}});
 assert.equal(done.status,200);assert.equal(done.state.phase,'play');assert.equal(done.state.history.length,0);assert.equal(done.state.board,'.'.repeat(361));assert.equal(done.state.gameName,null);assert.equal(done.state.players.black,'');assert.equal(done.state.players.white,'');assert.equal(done.state.result,null);assert.equal(done.state.libraryId,undefined);assert.ok(done.state.revision>revision);assert.ok(done.state.generation>0);
 assert.equal(done.state.lastSavedGame.id,'2026100601');assert.equal(done.state.lastSavedGame.generation,0);
 const record=readSgf([...saved.values()][0].sgf);assert.equal(record.name,'Completed game');assert.equal(record.result,'W+');assert.equal(record.nodes.length,MIN_LIBRARY_MOVES+2);
 const stale=await call('/api/game',{expectedRevision:revision,action:{type:'result',winner:'white'}});assert.equal(stale.status,409);assert.equal(saved.size,1);assert.equal((await call('/api/game')).state.history.length,0);
});
test('failed live publication preserves the finished board until a retry saves it',async()=>{
 const a=api();let s=await a.seed((await a.call('/api/game')).state);s=(await a.call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:60}})).state;a.fail(true);
 assert.equal((await a.call('/api/game',{expectedRevision:s.revision,action:{type:'resign',side:'black'}})).status,500);
 assert.equal(JSON.parse(a.rows.get('current').state.S).phase,'ended');assert.equal(JSON.parse(a.rows.get('current').state.S).history.length,MIN_LIBRARY_MOVES+1);
 a.fail(false);const next=await a.call('/api/game');assert.equal(next.state.phase,'play');assert.equal(next.state.history.length,0);assert.equal(a.saved.size,1);
});
test('saving clears the draft, and a repeated save returns the same library record',async()=>{
 const a=api(),id='12345678-1234-1234-1234-123456789abc';let d=(await a.call('/api/draft')).draft;
 d=(await a.call('/api/draft',{action:'update',expectedRevision:d.revision,sgf:'(;SZ[19]GN[Test]PB[A];B[dd](;W[pp])(;W[dp]))',selected:1})).draft;
 const finished=await a.call('/api/draft',{action:'save',expectedRevision:d.revision,id});assert.equal(finished.status,200);
 const blank=readSgf(finished.draft.sgf);assert.equal(blank.nodes.length,1);assert.equal(blank.name,'Recorded game');assert.equal(blank.players.black,'');assert.equal(finished.draft.selected,0);assert.ok(finished.draft.revision>d.revision);
 const replay=await a.call('/api/draft',{action:'save',expectedRevision:d.revision,id});assert.equal(replay.status,200);assert.equal(replay.id,finished.id);assert.equal(a.saved.size,1);assert.equal(readSgf([...a.saved.values()][0].sgf).nodes.length,3);
 const edited=await a.call('/api/draft',{action:'update',expectedRevision:finished.draft.revision,sgf:'(;SZ[19];B[pp])',selected:1});assert.equal(edited.status,200);assert.equal((await a.call('/api/draft',{action:'save',expectedRevision:d.revision,id})).status,409);assert.equal(readSgf((await a.call('/api/draft')).draft.sgf).nodes.length,2);
});
test('failed draft publication remains locked and recoverable, then clears on retry',async()=>{
 const a=api(),id='12345678-1234-1234-1234-123456789abc';let d=(await a.call('/api/draft',{action:'update',expectedRevision:0,sgf:'(;SZ[19];B[dd])',selected:1})).draft;a.fail(true);
 assert.equal((await a.call('/api/draft',{action:'save',expectedRevision:d.revision,id})).status,500);d=(await a.call('/api/draft')).draft;assert.equal(d.publication.status,'pending');assert.equal(readSgf(d.sgf).nodes.length,2);
 a.fail(false);const retry=await a.call('/api/draft',{action:'save',expectedRevision:d.revision,id});assert.equal(retry.status,200);assert.equal(readSgf(retry.draft.sgf).nodes.length,1);assert.equal(a.saved.size,1);
});

test('an already-published legacy draft clears once without deleting the library record',async()=>{
 const a=api(),id='12345678-1234-1234-1234-123456789abc',legacy={revision:12,sgf:'(;SZ[19]GN[Already saved];B[dd])',selected:1,publication:{id,status:'ready',gameId:'2026100601'}};
 a.rows.set('record-draft',{gameId:{S:'record-draft'},revision:{N:'12'},state:{S:JSON.stringify(legacy)}});
 const first=await a.call('/api/draft'),second=await a.call('/api/draft');assert.equal(first.draft.sgf,newRecordingSgf());assert.equal(first.draft.revision,13);assert.equal(second.draft.revision,13);assert.equal(a.saved.size,0);
});

test('auto-sync recovers an ended game after a failed save and resets exactly once',async()=>{
 const a=api();let s=await a.seed((await a.call('/api/game')).state);
 s=(await a.call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:60}})).state;
 a.fail(true);
 assert.equal((await a.call('/api/game',{expectedRevision:s.revision,action:{type:'result',winner:'white'}})).status,500);
 assert.equal(JSON.parse(a.rows.get('current').state.S).phase,'ended');
 assert.equal((await a.call('/api/game',{action:{type:'heartbeat'}})).status,500);
 a.fail(false);
 const next=await a.call('/api/game',{action:{type:'heartbeat'}});
 assert.equal(next.status,200);assert.equal(next.state.phase,'play');assert.equal(next.state.history.length,0);
 assert.equal(a.saved.size,1);
 await a.call('/api/game',{action:{type:'heartbeat'}});
 assert.equal(a.saved.size,1);
});

test('counted result selected from New game saves the score and starts a blank game',async()=>{
 const a=api();let s=await a.seed((await a.call('/api/game')).state);s=(await a.call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:60}})).state;
 s=(await a.call('/api/game',{expectedRevision:s.revision,action:{type:'move',index:300}})).state;
 const counted=score(s.board,19,[],s.komi),done=await a.call('/api/game',{expectedRevision:s.revision,action:{type:'finish'}});
 assert.equal(done.status,200);assert.equal(done.state.phase,'play');assert.equal(done.state.history.length,0);
 const record=readSgf([...a.saved.values()][0].sgf);assert.equal(record.result,(counted.winner==='black'?'B+':'W+')+counted.margin);assert.equal(a.saved.size,1);
});

test('games under 50 moves end and reset without saving to the library',async()=>{
 const a=api();let s=await a.seed((await a.call('/api/game')).state,MIN_LIBRARY_MOVES-1);
 const done=await a.call('/api/game',{expectedRevision:s.revision,action:{type:'resign',side:'black'}});
 assert.equal(done.status,200);assert.equal(done.state.phase,'play');assert.equal(done.state.history.length,0);
 assert.equal(done.state.lastSavedGame,undefined);assert.equal(a.saved.size,0);
});

test('result dialog reasons are validated and written to the SGF result',()=>{
 let base=createState();for(const index of [60,300])base=transition(base,{expectedRevision:base.revision,action:{type:'move',index}});
 const finish=action=>transition(base,{expectedRevision:base.revision,action});
 const re=action=>readSgf(sgf(finish(action))).result;
 assert.equal(re({type:'result',winner:'black',reason:'score',margin:3.5}),'B+3.5');
 assert.equal(re({type:'result',winner:'white',reason:'resign'}),'W+R');
 assert.equal(re({type:'result',reason:'unfinished'}),'Void');
 assert.equal(re({type:'result',reason:'draw'}),'0');
 assert.equal(re({type:'result',winner:'white'}),'W+');
 for(const margin of [0,-1,3.3,400.5,'3',null])assert.throws(()=>finish({type:'result',winner:'black',reason:'score',margin}),GameError);
 assert.throws(()=>finish({type:'result',winner:'nobody',reason:'resign'}),GameError);
});
