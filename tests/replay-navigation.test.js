import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readSgf} from '../src/sgf.js';
import {recommendedLine} from '../src/ai-review.js';
import {play} from '../src/engine.js';
import {stepReplay} from '../src/replay-navigation.js';
const record=()=>readSgf('(;SZ[19];B[dd];W[pp];B[dp];W[pd])');
const candidate={move:'A1',pv:['A1','B1','C1'],order:0};
const state=r=>({selected:1,aiLine:recommendedLine(r,1,candidate),trials:[],trialOffset:0});
test('arrows retain an AI continuation and restore recorded replay at its origin',()=>{
 const r=record(),saved=JSON.stringify(r);let s=state(r);s=stepReplay(r,s,2);assert.equal(s.aiLine.offset,3);
 s=stepReplay(r,s,-1);assert.equal(s.aiLine.offset,2);assert.equal(s.selected,1);
 s=stepReplay(r,s,1);assert.equal(s.aiLine.offset,3);
 s=stepReplay(r,s,-3);assert.equal(s.aiLine,null);assert.equal(s.selected,1);
 s=stepReplay(r,s,1);assert.equal(s.selected,2);assert.equal(s.aiLine,null);assert.equal(JSON.stringify(r),saved);
});
test('manual preview can step backward and forward without jumping to the record',()=>{
 const r=record(),frames=recommendedLine(r,1,candidate).frames.slice(1);let s={selected:1,aiLine:null,trials:frames,trialOffset:3};
 s=stepReplay(r,s,-1);assert.equal(s.trialOffset,2);assert.equal(s.trials.length,3);assert.equal(s.selected,1);
 s=stepReplay(r,s,1);assert.equal(s.trialOffset,3);
 s=stepReplay(r,s,-3);assert.equal(s.trialOffset,0);assert.deepEqual(s.trials,[]);
 s=stepReplay(r,s,1);assert.equal(s.selected,2);
});
test('manual moves added to an AI line are undone before the AI continuation',()=>{
 const r=record();let s=state(r);s.aiLine.offset=2;s.trials=[{board:[],depth:4},{board:[],depth:5}];s.trialOffset=2;
 s=stepReplay(r,s,-1);assert.equal(s.trialOffset,1);assert.equal(s.aiLine.offset,2);
 s=stepReplay(r,s,-1);assert.equal(s.trialOffset,0);assert.equal(s.aiLine.offset,2);
 s=stepReplay(r,s,1);assert.equal(s.trialOffset,1);
 s=stepReplay(r,s,-3);assert.equal(s.aiLine,null);assert.equal(s.selected,1);assert.deepEqual(s.trials,[]);
});
test('ten-move jumps cross the variation origin and clamp to the record boundaries',()=>{
 const r=record();let s=state(r);s.aiLine.offset=3;s=stepReplay(r,s,-10);assert.equal(s.selected,0);assert.equal(s.aiLine,null);
 s=stepReplay(r,s,10);assert.equal(s.selected,r.mainLine.at(-1));
});
function client(){
 const handlers=new Map(),elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',getBoundingClientRect:()=>({height:60}),append(){},insertBefore(){}});return elements.get(id);};
 const context=vm.createContext({readSgf,recommendedLine,stepReplay,play,t:(zh,en)=>en,URLSearchParams,location:{pathname:'/record/2026100620',search:''},sessionStorage:{getItem(){return null;},setItem(){}},localStorage:{getItem(){return null;}},document:{getElementById:get,querySelector:()=>get('layout'),querySelectorAll:()=>[],documentElement:{style:{setProperty(){}}},addEventListener:(name,fn,options)=>handlers.set(name,{fn,options})},window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}},clearInterval(){}});
 let source=readFileSync(new URL('../src/record.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('render();load();','').replace(/\narrangeReplayControls\(\);/g,'');
 vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);run("render=()=>{};record=readSgf('(;SZ[19];B[dd];W[pp];B[dp];W[pd])');selected=1;");
 return {run,key:(key,slider=false)=>{const event={key,target:{closest:selector=>slider&&selector==='[role=slider]'?{}:null},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};handlers.get('keydown').fn(event);return event;},handler:handlers.get('keydown'),get};
}
test('actual record keyboard handler walks preview moves and enables recorded replay afterward',()=>{
 const c=client();c.run('previewMove(342);previewMove(343);previewMove(344)');c.key('ArrowLeft');assert.equal(c.run('trialOffset'),2);assert.equal(c.run('selected'),1);
 c.key('ArrowRight');assert.equal(c.run('trialOffset'),3);c.key('ArrowLeft');c.key('ArrowLeft');c.key('ArrowLeft');assert.equal(c.run('trialOffset'),0);c.key('ArrowRight');assert.equal(c.run('selected'),2);
});
test('actual arrow handler captures chart focus during AI replay and exits AI mode at its origin',()=>{
 const c=client();c.run("showAiCandidate({anchor:1},{move:'A1',pv:['A1','B1','C1']});step(2)");assert.equal(c.handler.options.capture,true);
 const event=c.key('ArrowLeft',true);assert.equal(event.prevented,true);assert.equal(event.stopped,true);assert.equal(c.run('aiLine.offset'),2);
 c.key('ArrowLeft');c.key('ArrowLeft');assert.equal(c.run('aiLine'),null);assert.equal(c.run('selected'),1);
 const normalChart=c.key('ArrowRight',true);assert.equal(normalChart.prevented,undefined);c.key('ArrowRight');assert.equal(c.run('selected'),2);
});
