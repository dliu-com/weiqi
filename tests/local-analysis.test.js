import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readSgf,parseSgf} from '../photo-analysis/vendor/dl/sgf.js';
import {play as playFlat} from '../photo-analysis/vendor/dl/engine.js';
import * as helpers from '../photo-analysis/src/position.js';
function workspace(){
 const elements=new Map(),storage=new Map();const element=()=>({children:[],dataset:{},style:{},classList:{toggle(){}},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},scrollIntoView(){},reportValidity:()=>true,requestSubmit(){}});const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};get('next-player').value='black';get('rules').value='japanese';get('komi').value='6.5';get('photo-canvas').getContext=()=>({});
 const context=vm.createContext({language:'en',t:(zh,en)=>en,clearTimeout(){},setTimeout(){},...helpers,readSgf,parseSgf,playFlat,document:{getElementById:get,querySelectorAll:()=>[],createElement:element,createElementNS:element,documentElement:{}},window:{addEventListener(){}},navigator:{language:'en'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},matchMedia:()=>({matches:false})});
 const source=readFileSync(new URL('../photo-analysis/src/main.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace("new URL('./recognition-worker.js',import.meta.url)","'worker.js'");vm.runInContext(source,context);const run=s=>vm.runInContext(s,context);return {run,get,storage};
}
test('one local sequence replaces only the continuation and survives refresh without analysis or photos',()=>{
 const c=workspace();c.run('playMove(60);playMove(72);navigate(-1);playMove(288)');assert.equal(c.run('frames.length'),3);assert.equal(c.run('board[72]'),null);assert.equal(c.run('board[288]'),'white');c.run('photo={large:true};analysis={secret:true};saveLocal()');const saved=JSON.parse(c.storage.get('weiqi.local-analysis.v1'));assert.deepEqual(Object.keys(saved).sort(),['cursor','editing','sgf','side']);assert.equal(saved.sgf.includes('secret'),false);c.run('frames=[];board=emptyBoard();restoreLocal()');assert.equal(c.run('cursor'),2);assert.equal(c.run('board[60]'),'black');assert.equal(c.run('board[288]'),'white');
});
test('numbered preview captures legally, handles passes and leaves the original position intact',()=>{
 const b=helpers.emptyBoard();b[0]='white';b[1]='black';const result=helpers.previewSequence(b,'black',['A18','pass','D16']);assert.equal(b[0],'white');assert.equal(result.board[0],null);assert.equal(result.numbers.get(19),1);assert.equal(result.numbers.get(60),3);
});
test('rotation, photo corners and SGF setup preserve the intended position',()=>{
 const b=helpers.emptyBoard();b[60]='black';b[288]='white';const turned=helpers.rotateBoard(b);assert.equal(turned[helpers.rotatePoint(60)],'black');assert.equal(turned[helpers.rotatePoint(288)],'white');assert.equal(turned.filter(Boolean).length,2);let rotated=b;for(let n=0;n<4;n++)rotated=helpers.rotateBoard(rotated);assert.deepEqual(rotated,b);assert.equal(helpers.validCorners([[10,10],[90,10],[90,90],[10,90]],100,100),true);assert.equal(helpers.validCorners([[10,10],[10,90],[90,90],[90,10]],100,100),false);const sgf=helpers.setupSgf(b,{side:'white',rules:'chinese',komi:7.5}),record=readSgf(sgf);assert.equal(record.nodes[0].board[60],'B');assert.equal(record.nodes[0].turn,'W');assert.equal(record.komi,7.5);
});
