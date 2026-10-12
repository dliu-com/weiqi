import test from 'node:test';
import assert from 'node:assert/strict';
import {niceTicks,compositionChart} from '../src/report-stat-charts.js';
import {boardDiagram} from '../src/board-diagram.js';
class Element{constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.textContent='';this.style={};}setAttribute(k,v){this.attributes[k]=String(v);}append(...nodes){this.children.push(...nodes);}get className(){return this.attributes.class;}set className(v){this.attributes.class=v;}}
const all=e=>[e,...e.children.flatMap(all)];
const withDocument=run=>{const previous=globalThis.document;globalThis.document={createElementNS:(ns,tag)=>new Element(tag),createElement:tag=>new Element(tag)};try{return run();}finally{globalThis.document=previous;}};
test('axis ticks use round steps that cover the maximum',()=>{
 assert.deepEqual(niceTicks(8.1),[0,2,4,6,8,10]);assert.deepEqual(niceTicks(4.1),[0,1,2,3,4,5]);assert.deepEqual(niceTicks(46.85),[0,10,20,30,40,50]);
 assert.deepEqual(niceTicks(.4).map(v=>+v.toFixed(2)),[0,.1,.2,.3,.4]);
});
test('narrow quality segments are labelled outside the bar',()=>withDocument(()=>{
 const svg=compositionChart('Quality',[{label:'Black',counts:{best:90,good:6,blunder:4}}],{keys:['best','good','blunder'],names:{best:'Best',good:'Good',blunder:'Blunder'}});
 const texts=all(svg).filter(e=>e.tag==='text');
 assert.equal(texts.filter(e=>e.attributes['data-outside-label']).length,2);assert.ok(texts.some(e=>e.textContent==='90%'&&!e.attributes['data-outside-label']));
}));
test('board marks ring stones and empty points with safe colours only',()=>withDocument(()=>{
 const board=Array(361).fill(null);board[0]='B';
 const svg=boardDiagram(board,{marks:[{index:0,colour:'#c8372d',kind:'played'},{index:1,colour:'#17806a',kind:'best'},{index:2,colour:'red;x',kind:'bad'}]});
 const rings=all(svg).filter(e=>e.attributes['data-mark']);
 assert.deepEqual(rings.map(e=>[e.attributes['data-mark'],e.attributes.r]),[['played','11'],['best','7']]);
}));
