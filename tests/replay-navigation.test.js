import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readSgf} from '../src/sgf.js';
import {recommendedLine,startRecommendedLine,lineContinuations,followLineContinuation,gtpPoint,reviewMove,nextMoveComparison} from '../src/ai-review.js';
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
 const handlers=new Map(),elements=new Map(),element=(tag='div')=>({tag,children:[],dataset:{},attrs:{},textContent:'',classList:{values:new Set(),add(...values){for(const value of values)this.values.add(value);},remove(...values){for(const value of values)this.values.delete(value);},toggle(value,on){if(on)this.values.add(value);else this.values.delete(value);}},getBoundingClientRect:()=>({height:60}),append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},insertBefore(){},setAttribute(key,value){this.attrs[key]=value;},getAttribute(key){return this.attrs[key];},removeAttribute(key){delete this.attrs[key];}}),get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const context=vm.createContext({mountStoneSound(){},prepareStoneSound(){},playStoneSound(){},readSgf,recommendedLine,startRecommendedLine,lineContinuations,followLineContinuation,gtpPoint,reviewMove,nextMoveComparison,stepReplay,play,t:(zh,en)=>en,URLSearchParams,location:{pathname:'/record/2026100620',search:''},sessionStorage:{getItem(){return null;},setItem(){}},localStorage:{getItem(){return null;}},document:{createTextNode:value=>({textContent:value}),createElement:element,createElementNS:(_,tag)=>element(tag),getElementById:get,querySelector:()=>get('layout'),querySelectorAll:()=>[],documentElement:{style:{setProperty(){}}},addEventListener:(name,fn,options)=>handlers.set(name,{fn,options})},window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}},clearInterval(){}});
 let source=readFileSync(new URL('../src/record.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('render();load();','').replace(/\narrangeReplayControls\(\);/g,'');
 vm.runInContext(readFileSync(new URL('../src/move-label.js',import.meta.url),'utf8').replace(/^export /gm,''),context);vm.runInContext(source,context);const run=code=>vm.runInContext(code,context);run("render=()=>{};record=readSgf('(;SZ[19];B[dd];W[pp];B[dp];W[pd])');data={analysis:{phase:'deep'}};selected=1;");
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

test('actual continuation renderer labels every alternative with the next sequence step, then advances it',()=>{
 const c=client();c.run(`
  const makeElement=()=>({textContent:'',dataset:{},children:[],classList:{values:new Set(),add(...values){for(const value of values)this.values.add(value);}},setAttribute(){},append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];}});
  document.createElement=makeElement;points=Array.from({length:361},makeElement);
  $('ai-alternatives').append=function(...nodes){this.children.push(...nodes);};$('ai-alternatives').replaceChildren=function(){this.children=[];};
  record=readSgf('(;SZ[19];B[aa];W[ba];B[ca];W[da];B[ea];W[fa])');selected=0;
  aiLine=startRecommendedLine(record,{anchor:0},{move:'A19',pv:['A19','B19','C19','D19','E19','F19']});aiLine.offset=6;
  analyses=new Map([[6,{candidates:[{move:'G19',order:0,visits:100,blackLead:2,blackWinrate:.5,pv:['G19','J19']},{move:'H19',order:1,visits:100,blackLead:1.8,blackWinrate:.5,pv:['H19','K19']}]}]]);
  renderContinuations();
 `);
 assert.deepEqual(Array.from(c.run("$('ai-alternatives').children.slice(1).map(button=>button.textContent)")),['7 · G19','7 · H19']);
 assert.equal(c.run("points[gtpPoint('G19')].textContent"),'7');assert.equal(c.run("points[gtpPoint('H19')].textContent"),'7');
 assert.equal(c.run("points[gtpPoint('G19')].classList.values.has('ai-best')"),true);assert.equal(c.run("points[gtpPoint('H19')].classList.values.has('ai-good')"),true);
 c.run("$('ai-alternatives').children[1].onclick();renderContinuations()");assert.equal(c.run('aiLine.offset'),7);assert.equal(c.run("points[gtpPoint('J19')].textContent"),'8');assert.equal(c.run("$('ai-alternatives').children[1].textContent"),'8 · J19');
});
function previewRows(c){c.run(`
 renderAiTable=()=>{};
 const firstCandidate={move:'A1',pv:['A1','B1','C1']},secondCandidate={move:'D1',pv:['D1','E1','F1']};
 const rowReview={anchor:1,alternatives:[firstCandidate,secondCandidate]},firstRow={candidate:firstCandidate},secondRow={candidate:secondCandidate};
`);}
test('clicking the selected table row again returns to the original recorded board',()=>{
 const c=client();previewRows(c);c.run('chooseAiRow(rowReview,firstRow)');assert.equal(c.run('aiLine.overview'),true);assert.equal(c.run('aiLine.offset'),3);
 c.run('chooseAiRow(rowReview,firstRow)');assert.equal(c.run('aiLine'),null);assert.equal(c.run('selected'),1);assert.equal(c.run('trialOffset'),0);
});
test('row hover restores the original or pinned preview when the pointer leaves',()=>{
 const c=client();previewRows(c);c.run('hoverAiRow(rowReview,firstRow)');assert.equal(c.run('aiLine.rootCandidate.move'),'A1');c.run('leaveAiRow()');assert.equal(c.run('aiLine'),null);
 c.run('chooseAiRow(rowReview,firstRow);hoverAiRow(rowReview,secondRow)');assert.equal(c.run('aiLine.rootCandidate.move'),'D1');c.run('leaveAiRow()');assert.equal(c.run('aiLine.rootCandidate.move'),'A1');assert.equal(c.run('aiLine.overview'),true);
});
test('a first click during hover pins the preview, while a second click suppresses hover until leave',()=>{
 const c=client();previewRows(c);c.run('hoverAiRow(rowReview,firstRow);chooseAiRow(rowReview,firstRow);leaveAiRow()');assert.equal(c.run('aiLine.rootCandidate.move'),'A1');assert.equal(c.run('aiHover'),null);
 c.run('hoverAiRow(rowReview,firstRow);chooseAiRow(rowReview,firstRow)');assert.equal(c.run('aiLine'),null);assert.equal(c.run('aiHoverBlocked'),true);
 c.run('hoverAiRow(rowReview,firstRow)');assert.equal(c.run('aiLine'),null);
 c.run('leaveAiRow();hoverAiRow(rowReview,secondRow)');assert.equal(c.run('aiLine.rootCandidate.move'),'D1');c.run('leaveAiRow()');assert.equal(c.run('aiLine'),null);
});

test('actual comparison table shows leader-coloured absolute points and both winning probabilities',()=>{
 const c=client();c.run(`
 record=readSgf('(;SZ[19];B[aa])');selected=0;points=Array.from({length:361},()=>document.createElement('button'));data={analysis:{schemaVersion:2,phase:'deep'}};
 analyses=new Map([[0,{candidates:[{move:'D16',order:0,visits:100,blackLead:2,blackWinrate:.7,pv:['D16']},{move:'A19',order:1,visits:1,blackLead:-3,blackWinrate:.2,pv:['A19']}]}],[1,{blackLead:-4,blackWinrate:.25}]]);renderSuggestions();
 const tableRows=$('ai-alternatives').children.find(e=>e.tag==='table').children[1].children;
 `);
 assert.equal(c.run("tableRows[0].children[0].children[0].dataset.side"),'B');assert.equal(c.run("tableRows[0].children[0].children[0].children.some(x=>/stone/.test(x?.className||''))"),false);assert.equal(c.run("tableRows[0].children[1].children[0].className"),'quality-pill');assert.equal(c.run("tableRows[0].children[1].children[0].dataset.quality"),'best');assert.equal(c.run("tableRows[0].children[1].children[0].textContent"),'Best');
 assert.equal(c.run("tableRows[0].children[2].children[0].textContent"),'2.0');assert.equal(c.run("tableRows[0].children[2].children[0].className"),'ai-score-badge ai-score-black');
 assert.equal(c.run("tableRows[0].children[2].attrs['aria-label']"),'Black leads by 2.0 points');
 assert.deepEqual(Array.from(c.run("tableRows[0].children[3].children[0].children.map(e=>e.textContent)")),['70.0','30.0']);assert.equal(c.run("tableRows[0].children[3].attrs['aria-label']"),'Black 70.0%, White 30.0%');
 assert.equal(c.run("tableRows[1].children[2].children[0].textContent"),'≈ 4.0');assert.equal(c.run("tableRows[1].children[2].children[0].className"),'ai-score-badge ai-score-white');assert.equal(c.run("tableRows[1].children[2].attrs['aria-label']"),'White leads by 4.0 points (estimated)');
 assert.deepEqual(Array.from(c.run("tableRows[1].children[3].children[1].children.map(e=>e.textContent)")),['25.0','75.0']);
 c.run("analyses.delete(1);renderSuggestions()");const cells=c.get('ai-alternatives').children.find(e=>e.tag==='table').children[1].children[1].children;assert.equal(cells[2].textContent,'—');assert.equal(cells[3].textContent,'—');
});
test('White-to-play comparison keeps Black-perspective scores and paired percentages, with zero neutral',()=>{
 const c=client();c.run(`
 record=readSgf('(;SZ[19]PL[W])');selected=0;points=Array.from({length:361},()=>document.createElement('button'));data={analysis:{schemaVersion:2,phase:'deep'}};
 analyses=new Map([[0,{candidates:[{move:'D16',order:0,visits:100,blackLead:-3.5,blackWinrate:.2,pv:['D16']}]}]]);renderSuggestions();
 `);
 let cells=c.get('ai-alternatives').children.find(e=>e.tag==='table').children[1].children[0].children;assert.equal(cells[2].children[0].textContent,'3.5');assert.equal(cells[2].children[0].className,'ai-score-badge ai-score-white');assert.deepEqual(cells[3].children[0].children.map(e=>e.textContent),['20.0','80.0']);
 c.run("analyses.get(0).candidates[0].blackLead=0;renderSuggestions()");cells=c.get('ai-alternatives').children.find(e=>e.tag==='table').children[1].children[0].children;assert.equal(cells[2].children[0].className,'ai-score-badge ai-score-even');assert.equal(cells[2].children[0].textContent,'0.0');assert.equal(cells[2].attrs['aria-label'],'Even position');
});
