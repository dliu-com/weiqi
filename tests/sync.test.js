import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createState, transition } from '../backend/game-service.js';
import { score } from '../src/engine.js';

// Exercise the actual client with an isolated DOM/network/clock, never the live game.
async function client() {
  const elements = new Map(), intervals = [], calls = [];
  class Element {
    parentElement = {append(){}}; style = {}; dataset = {}; children = []; attrs = {}; hidden = false; checked = true;
    classList = { toggle() {}, contains() { return false; } };
    setAttribute(k,v) { this.attrs[k]=v; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=nodes; }
    addEventListener() {} focus() {} showModal() {} close() {}
  }
  const get = id => { if(!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  let remote = createState(), failAfterSave = false, failGet = false, now = Date.now();
  const context = vm.createContext({
    score, t: (zh,en)=>en, translateError:s=>s, setLanguage(){},
    document: {getElementById:get,createElement:()=>new Element(),createElementNS:()=>new Element(),
      createDocumentFragment:()=>new Element(),querySelectorAll:()=>[],addEventListener(){},visibilityState:'visible',body:new Element()},
    window:{addEventListener(){}},setInterval(fn,ms){intervals.push({fn,ms});},setTimeout(){},clearTimeout(){},
    Date:class extends Date { static now(){return now;} },AbortSignal,TextEncoder,crypto:webcrypto,
    fetch:async (url,options)=>{
      calls.push(options.method);
      if(options.method==='GET') {if(failGet)throw new Error('Offline');return {ok:true,json:async()=>({state:structuredClone(remote)})};}
      const request=JSON.parse(options.body);
      remote=transition(remote,request);
      if(failAfterSave)throw new Error('Response lost');
      return {ok:true,json:async()=>({state:structuredClone(remote)})};
    }
  });
  vm.runInContext(readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
  const run = code=>vm.runInContext(code,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {run,get,calls,intervals,remote:()=>remote,move:i=>{remote=transition(remote,{expectedRevision:remote.revision,action:{type:'move',index:i}});},
    loseResponse:()=>{failAfterSave=true;},offline:()=>{failGet=true;},advance:ms=>{now+=ms;}};
}
test('visible idle page polls every 5 seconds without a focus event',async()=>{
 const c=await client();assert.equal(c.intervals[0].ms,5000);c.move(180);
 await c.intervals[0].fn();await new Promise(r=>setImmediate(r));
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
 c.intervals[0].fn();assert.equal(c.calls.length,before);c.advance(600001);c.intervals[0].fn();
 assert.equal(c.get('auto').checked,false);assert.equal(c.run('automatic'),false);
});
