import test from 'node:test';
import assert from 'node:assert/strict';
import {chartGeometry} from '../src/evaluation-chart.js';
test('chart maps move numbers and both sides of zero consistently',()=>{
 const rows=[{move:0,nodeId:0,blackLead:-3},{move:1,nodeId:1,blackLead:0},{move:2,nodeId:2,blackLead:55.5}];
 const g=chartGeometry(rows);assert.equal(g.extent,60);assert.equal(g.points[0].x,g.left);assert.equal(g.points[2].x,g.width-g.right);assert.ok(g.points[0].y>g.baseline);assert.equal(g.points[1].y,g.baseline);assert.ok(g.points[2].y<g.baseline);assert.ok(g.points[2].y>=g.top);
});
test('empty and one-position charts have a finite scale',()=>{for(const rows of [[],[{move:0,nodeId:0,blackLead:0}]]){const g=chartGeometry(rows);assert.equal(g.extent,5);assert.ok(Number.isFinite(g.x(0)));assert.ok(Number.isFinite(g.y(0)));}});

test('win rate chart uses Black percentage, with 50% at the centre',()=>{const g=chartGeometry([{move:0,nodeId:0,blackWinrate:0},{move:1,nodeId:1,blackWinrate:.5},{move:2,nodeId:2,blackWinrate:1}],360,150,'win');assert.equal(g.extent,50);assert.equal(g.points[0].y,g.height-g.bottom);assert.equal(g.points[1].y,g.baseline);assert.equal(g.points[2].y,g.top);});

test('chart scrubbing survives redraws and stops on pointer release',async()=>{
 const {drawEvaluationChart}=await import('../src/evaluation-chart.js');
 class Element extends EventTarget{constructor(){super();this.children=[];this.attributes={};this.clientWidth=800;}setAttribute(k,v){this.attributes[k]=String(v);}append(e){this.children.push(e);}replaceChildren(){this.children=[];}getBoundingClientRect(){return {left:0,width:800};}querySelector(){return this.children.find(e=>e.attributes.role==='slider');}focus(){}}
 const previousDocument=globalThis.document,previousWindow=globalThis.window;
 globalThis.document={createElementNS:()=>new Element()};globalThis.window=new EventTarget();
 try{
  const container=new Element(),positions=[0,1,2].map(move=>({move,nodeId:move,blackLead:move,blackWinrate:.5}));let selected=0;
  const render=()=>drawEvaluationChart(container,positions,selected,node=>{selected=node;render();},{chart:'Chart',move:String,variation:'Variation'});render();
  const pointer=(type,x,id=1)=>{const event=new Event(type,{cancelable:true});Object.assign(event,{clientX:x,pointerId:id,button:0});return event;};
  container.querySelector().dispatchEvent(pointer('pointerdown',34));
  window.dispatchEvent(pointer('pointermove',411));assert.equal(selected,1);
  window.dispatchEvent(pointer('pointermove',788,2));assert.equal(selected,1);
  window.dispatchEvent(pointer('pointermove',788));assert.equal(selected,2);
  window.dispatchEvent(pointer('pointerup',788));window.dispatchEvent(pointer('pointermove',34));assert.equal(selected,2);
 }finally{globalThis.document=previousDocument;globalThis.window=previousWindow;}
});
