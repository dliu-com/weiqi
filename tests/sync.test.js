import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createState, transition } from '../backend/game-service.js';
import { play, opposite, score, gameTree, reviewPosition, gameClock, sgf } from '../src/engine.js';

// Exercise the actual client with an isolated DOM/network/clock, never the live game.
async function client() {
  const elements = new Map(), intervals = [], calls = [];
  class Element {
    parentElement = {append(){},querySelectorAll(){return [];}}; style = {}; dataset = {}; children = []; attrs = {}; hidden = false; checked = true;
    classList = { toggle() {}, contains() { return false; } };
    setAttribute(k,v) { this.attrs[k]=v; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; }
    addEventListener() {} focus() {} showModal() {this.open=true;} close() {this.open=false;}
  }
  const get = id => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  let remote = createState(), failAfterSave = false, failGet = false, now = Date.now();
  const context = vm.createContext({
    localTimestamp:()=> 'test · UTC+1', play, opposite, score, gameTree, reviewPosition, gameClock, sgf, language:'en', t: (zh,en)=>en, translateError:s=>s, setLanguage(){},
    location:{search:'',assign(){}},URLSearchParams,
    document: {querySelector:()=>new Element(),getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),
      createDocumentFragment:()=>new Element(),querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible',body:new Element()},
    window:{addEventListener(){}},setInterval(fn,ms){intervals.push({fn,ms});},setTimeout(){},clearTimeout(){},
    Date:class extends Date { static now(){return now;} },AbortSignal,TextEncoder,crypto:webcrypto,
    fetch:async (url,options)=>{
      calls.push(options.method === 'POST' && JSON.parse(options.body).action.type === 'heartbeat' ? 'HEARTBEAT' : options.method);
      if(options.method==='GET') {if(failGet)throw new Error('Offline');return {ok:true,json:async()=>({state:structuredClone(remote)})};}
      const request=JSON.parse(options.body);
      remote=transition(remote,request);
      if(failAfterSave)throw new Error('Response lost');
      return {ok:true,json:async()=>({state:structuredClone(remote)})};
    }
  });
  vm.runInContext(readFileSync(new URL('../src/board-geometry.js',import.meta.url),'utf8').replace(/^export /gm,''),context);
  vm.runInContext(readFileSync(new URL('../src/board-view.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
  vm.runInContext(readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  const run = code=>vm.runInContext(code,context);
  while(run('polling')) await new Promise(resolve=>setImmediate(resolve));
  return {run,get,calls,intervals,remote:()=>remote,move:i=>{remote=transition(remote,{expectedRevision:remote.revision,action:{type:'move',index:i}});},
    loseResponse:()=>{failAfterSave=true;},offline:()=>{failGet=true;},online:()=>{failGet=false;failAfterSave=false;},advance:ms=>{now+=ms;}};
}
test('visible idle page polls every 5 seconds without a focus event',async()=>{
 const c=await client();assert.equal(c.intervals.find(i=>i.ms===5000).ms,5000);c.move(180);
 c.intervals.find(i=>i.ms===5000).fn();while(c.run('polling'))await new Promise(r=>setImmediate(r));
 assert.equal(c.run('state.board[180]'),'B');assert.match(c.get('turn').textContent,/White/);
});
test('preflight rejects a stale move without submitting POST',async()=>{
 const c=await client();c.move(180);await c.run("action({type:'move',index:181})");
 assert.equal(c.remote().history.length,1);assert.ok(!c.calls.includes('POST'));assert.equal(c.run('state.revision'),1);
});
test('a lost POST response recovers state without replaying the move',async()=>{
 const c=await client();c.loseResponse();await c.run("action({type:'move',index:180})");
 assert.equal(c.remote().history.length,1);assert.equal(c.run('state.revision'),1);assert.equal(c.calls.filter(x=>x==='POST').length,1);
});
test('failed preflight never changes the board',async()=>{
 const c=await client();c.offline();await c.run("action({type:'move',index:180})");
 assert.equal(c.remote().revision,0);assert.equal(c.run('busy'),false);assert.ok(!c.calls.includes('POST'));
});
test('10 minutes idle switches polling off, and hidden tabs do not poll',async()=>{
 const c=await client();c.run("document.visibilityState='hidden'");const before=c.calls.length;
 c.intervals.find(i=>i.ms===5000).fn();assert.equal(c.calls.length,before);c.advance(600001);c.intervals.find(i=>i.ms===5000).fn();
 assert.equal(c.get('auto').checked,false);assert.equal(c.run('automatic'),false);
});
test('review stays selected while live moves sync and cannot submit moves',async()=>{
 const c=await client();c.move(180);await c.run('sync()');c.run('selectReview(-1)');
 const count=c.calls.length;await c.run("action({type:'move',index:181})");assert.equal(c.calls.length,count);
 c.move(182);await c.run('sync()');assert.equal(c.run('reviewing'),-1);
 assert.equal(c.get('turn').textContent,'Review · Move 0');
 c.get('review-live').onclick();assert.equal(c.run('reviewing'),null);assert.equal(c.run('state.history.length'),2);
});
test('background polling never disables otherwise available controls',async()=>{
 const c=await client();const changes=[];
 for(const id of ['pass','new','resign-black','resign-white']) {
  let value=c.get(id).disabled;
  Object.defineProperty(c.get(id),'disabled',{get:()=>value,set:v=>{changes.push([id,v]);value=v;}});
 }
 await c.run('sync()');
 assert.ok(changes.length>0);assert.ok(changes.every(([,disabled])=>disabled===false));
});
test('submitting label is visible while a move is in flight, then clears on success',async()=>{
 const c=await client();const saving=c.run("action({type:'move',index:180})");
 assert.equal(c.get('turn').textContent,'Black · Submitting…');await saving;
 assert.equal(c.get('turn').textContent,'To play: White');
});
test('network errors show not sent and later sync recovers a saved move',async()=>{
 const before=await client();before.offline();await before.run("action({type:'move',index:180})");
 assert.equal(before.get('turn').textContent,'Black · Not sent');
 const after=await client();after.loseResponse();const saving=after.run("action({type:'move',index:180})");after.offline();await saving;
 assert.equal(after.get('turn').textContent,'Black · Not sent');
 assert.equal(after.remote().history.length,1);
 after.online();await after.run('sync()');assert.equal(after.get('turn').textContent,'To play: White');
});
test('background sync failure shows a persistent inline warning and successful retry clears it',async()=>{
 const c=await client();c.run("automatic=false");c.offline();await c.run('sync()');
 assert.equal(c.get('sync-warning').hidden,false);assert.match(c.get('sync-warning').textContent,/out of date/);
 c.online();await c.run('sync()');assert.equal(c.get('sync-warning').hidden,true);
});

test('both resignation buttons select their own side regardless of whose turn it is',async()=>{
 for(const side of ['black','white']) {
  const c=await client();assert.equal(c.get('resign-'+side).textContent,side==='black'?'Black resigns':'White resigns');
  c.get('resign-'+side).onclick();assert.equal(c.get('confirm-title').textContent,side==='black'?'Black resigns?':'White resigns?');
  c.run('pendingConfirmation()');while(c.run('busy'))await new Promise(r=>setImmediate(r));
  assert.equal(c.remote().result.winner,side==='black'?'white':'black');
 }
});

test('preview moves are local, survive sync, undo and clear without changing saved history',async()=>{
 const c=await client();c.move(180);await c.run('sync()');c.run('selectReview(-1)');
 const calls=c.calls.length, original=JSON.stringify(c.remote());
 c.run('previewMove(0)');c.run('previewMove(1)');
 assert.equal(c.run('trialMoves.at(-1).board.slice(0,2)'), 'BW');
 assert.equal(c.calls.length,calls);assert.equal(JSON.stringify(c.remote()),original);
 await c.run('sync()');assert.equal(c.run('trialMoves.length'),2);
 c.get('trial-undo').onclick();assert.equal(c.run('trialMoves.length'),1);
 c.get('trial-reset').onclick();assert.equal(c.run('trialMoves.length'),0);
 c.run('previewMove(0)');c.run('selectReview(0)');assert.equal(c.run('trialMoves.length'),0);
 c.run('previewMove(1)');c.get('review-live').onclick();assert.equal(c.run('trialMoves.length'),0);
 assert.equal(c.run('state.history.length'),1);
});

test('live tree hides legacy abandoned variations and navigation stays on the active sequence',async()=>{
 const c=await client();c.move(180);c.move(181);await c.run('sync()');
 c.run("state.tree.nodes.push([0,'white',0,[[0,'W']]]);treeRenderKey='';renderTree();");
 assert.equal(c.get('history').children[0].children.length,3);
 c.run('selectReview(0)');c.get('review-next').onclick();assert.equal(c.run('reviewing'),1);
 c.run('selectReview(-1)');c.get('review-next').onclick();assert.equal(c.run('reviewing'),0);
});

test('End game recovers stale finished state instead of showing disabled result choices',async()=>{
 const c=await client();c.run("state.phase='ended'");c.get('new').onclick();
 while(c.run('polling'))await new Promise(r=>setImmediate(r));
 assert.equal(c.run('state.phase'),'play');assert.ok(c.calls.includes('HEARTBEAT'));
});

test('New game and Confirm dead stones share the result picker and automatic count',async()=>{
 const c=await client();c.move(180);await c.run('sync()');
 assert.equal(c.get('new').textContent,'New game');assert.equal(c.get('edit-game').textContent,'Edit game info');
 c.get('new').onclick();assert.equal(c.get('end-game-dialog').open,true);
 assert.match(c.get('result-count-summary').textContent,/Automatic count: Black/);
 c.get('end-game-cancel').onclick();assert.equal(c.get('end-game-dialog').open,false);
 await c.run("action({type:'pass'})");await c.run("action({type:'pass'})");
 c.get('confirm-score').onclick();assert.equal(c.get('end-game-dialog').open,true);
 for(const side of ['black','white','draw'])assert.equal(c.get('result-'+side).disabled,false);
 c.get('result-counted').onclick();assert.equal(c.get('confirm-dialog').open,true);
 c.get('accept-confirm').onclick();while(c.run('busy'))await new Promise(r=>setImmediate(r));
 assert.equal(c.remote().result.reason,'score');assert.equal(c.remote().phase,'ended');
});
