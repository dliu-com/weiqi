import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {readSgf,parseSgf} from '../src/sgf.js';
import {PositionError,cloudPosition} from '../src/position-api.js';
import * as helpers from '../src/analysis-position.js';

class Element {
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.attributes={};this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.classList={add(){},remove(){},toggle(){},contains:()=>false};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 addEventListener(){}
 scrollIntoView(){}
 click(){this.onclick?.();}
 querySelector(){return null;}
 contains(){return false;}
 get rows(){return this.children;}
 get lastElementChild(){return this.last??=new Element('span');}
}
class BoardView {
 constructor(element,{onPoint}){this.element=element;this.onPoint=onPoint;this.points=Array.from({length:361},()=>new Element('button'));}
 render(board,options){this.board=board;this.options=options;}
}
function page(saved){
 const elements=new Map(),storage=new Map(),requests=[],replies=[];
 if(saved)storage.set('weiqi.local-analysis.v1',JSON.stringify(saved));
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 get('rules').value='japanese';get('komi').value='6.5';
 const positionRequest=async(kind,body)=>{requests.push({kind,body});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;};
 const context=vm.createContext({
  ...helpers,language:'en',t:(zh,en)=>en,BoardView,readSgf,parseSgf,PositionError,positionRequest,cloudPosition,
  document:{getElementById:get,querySelectorAll:()=>[],querySelector:()=>new Element(),createElement:tag=>new Element(tag),documentElement:{},addEventListener(){}},
  window:{addEventListener(){}},matchMedia:()=>({matches:false}),performance:{now:()=>Date.now()},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},URL:{createObjectURL:()=>'blob:photo',revokeObjectURL(){}},AbortController
 });
 const source=readFileSync(new URL('../src/analysis.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(source,context);
 return {run:code=>vm.runInContext(code,context),get,storage,requests,replies};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const result={rootScoreLead:2.5,rootWinRate:.62,rootVisits:40,moves:[{x:3,y:15,pv:['D4','Q16'],scoreLead:2.5,winRate:.62,visits:30,relativePointsLost:0},{x:15,y:3,pv:['Q16'],scoreLead:1.8,winRate:.58,visits:10,relativePointsLost:.7}]};

test('a new visitor starts at the photo step with nothing saved',()=>{
 const p=page();assert.equal(p.run('stage'),'start');assert.equal(p.get('upload-box').hidden,false);assert.equal(p.get('check-card').hidden,true);assert.equal(p.get('photo-stage').dataset.mode,'drop');assert.equal(p.storage.size,0);
});
test('one local sequence replaces only the continuation and survives refresh without analysis or photos',()=>{
 const p=page();p.run("stage='play';board=emptyBoard();resetFrames();playMove(60);playMove(72);navigate(cursor-1);playMove(288)");
 assert.equal(p.run('frames.length'),3);assert.equal(p.run('board[72]'),'.');assert.equal(p.run('board[288]'),'W');assert.equal(p.run('side'),'B');
 p.run("photo='blob:secret';analysis={secret:true};saveLocal()");
 const saved=JSON.parse(p.storage.get('weiqi.local-analysis.v1'));assert.deepEqual(Object.keys(saved).sort(),['cursor','editing','sgf','side']);assert.equal(saved.sgf.includes('secret'),false);
 const restored=page(saved);assert.equal(restored.run('stage'),'play');assert.equal(restored.run('cursor'),2);assert.equal(restored.run('board[60]'),'B');assert.equal(restored.run('board[288]'),'W');assert.equal(restored.run('side'),'B');
 assert.equal(page({...saved,side:'white'}).run('side'),'W');
});
test('checking stones uses a smart tap, undo and rotation that keeps review rings on their stones',()=>{
 const p=page();p.get('manual-button').onclick();assert.equal(p.run('stage'),'check');
 p.run('pointClicked(0)');assert.equal(p.run('board[0]'),'B');p.run('pointClicked(0)');assert.equal(p.run('board[0]'),'.');
 p.get('tool-W').onclick();p.run('pointClicked(0);pointClicked(60)');assert.equal(p.run('board[0]+board[60]'),'WW');
 p.get('tool-B').onclick();p.run('pointClicked(0)');assert.equal(p.run('board[0]'),'B');
 p.get('undo').onclick();assert.equal(p.run('board[0]'),'W');
 p.run('review=new Set([60])');p.get('rotate').onclick();assert.equal(p.run('board[rotatePoint(60)]'),'W');assert.equal(p.run('review.has(rotatePoint(60))'),true);
 p.get('tool-E').onclick();p.run('pointClicked(rotatePoint(60))');assert.equal(p.run('board[rotatePoint(60)]'),'.');assert.equal(p.run('review.size'),0);
 assert.equal(JSON.parse(p.storage.get('weiqi.local-analysis.v1')).editing,true);
});
test('analysis is one request per action, blocks stones without liberties and re-analyses after a played move',async()=>{
 const p=page();p.run("stage='check';board=setPoint(setPoint(setPoint(emptyBoard(),0,'W'),1,'B'),19,'B');resetFrames()");
 await p.run('analyse()');assert.equal(p.requests.length,0);assert.equal(p.run('status.tone'),'error');assert.match(p.get('status').textContent,/A19/);
 p.run("board=setPoint(board,0,'.');resetFrames()");p.replies.push(result);await p.run('analyse()');
 assert.equal(p.requests.length,1);assert.equal(p.requests[0].kind,'analyze');assert.equal(p.requests[0].body.side,'B');assert.equal(p.requests[0].body.initialBoard[1],'B');
 assert.equal(p.run('stage'),'play');assert.equal(p.run('autoAnalyse'),true);assert.equal(p.get('result-card').hidden,false);assert.equal(p.get('suggestions').children.length,2);
 p.run('pointClicked(288)');assert.equal(p.run('pinned'),0);assert.equal(p.requests.length,1);
 p.run('pointClicked(0)');assert.equal(p.run('pinned'),null);
 p.replies.push(result);p.get('play-preview').onclick();p.run('pointClicked(288)');p.get('play-preview').onclick();await settle();
 assert.equal(p.run('frames.length'),2);assert.equal(p.run('board[288]'),'B');assert.equal(p.requests.length,2);assert.equal(JSON.stringify(p.requests[1].body.moves),JSON.stringify([{side:'B',index:288}]));
});
test('server refusals are shown in plain language and leave the position editable',async()=>{
 const p=page();p.run("stage='check';board=setPoint(emptyBoard(),60,'B');resetFrames()");
 p.replies.push(new PositionError('Two positions are being processed. Wait a few seconds and try again.',429));await p.run('analyse()');
 assert.equal(p.run('stage'),'check');assert.equal(p.run('busy'),null);assert.match(p.get('status').textContent,/Wait a few seconds/);assert.equal(p.get('analyse').disabled,false);
});
test('numbered preview captures legally, handles passes and leaves the original position intact',()=>{
 const b=helpers.setPoint(helpers.setPoint(helpers.emptyBoard(),0,'W'),1,'B'),preview=helpers.previewSequence(b,'B',['A18','pass','D16']);
 assert.equal(b[0],'W');assert.equal(preview.board[0],'.');assert.equal(preview.numbers.get(19),1);assert.equal(preview.numbers.get(60),3);
});
test('rotation, SGF setup and sequences preserve the intended position',()=>{
 const b=helpers.setPoint(helpers.setPoint(helpers.emptyBoard(),60,'B'),288,'W'),turned=helpers.rotateBoard(b);
 assert.equal(turned[helpers.rotatePoint(60)],'B');assert.equal(turned[helpers.rotatePoint(288)],'W');assert.deepEqual(helpers.stoneCounts(turned),{black:1,white:1});
 let rotated=b;for(let n=0;n<4;n++)rotated=helpers.rotateBoard(rotated);assert.equal(rotated,b);
 const record=readSgf(helpers.setupSgf(b,{side:'W',rules:'chinese',komi:7.5}));assert.equal(record.nodes[0].board,b);assert.equal(record.initialPlayer,'W');assert.equal(record.komi,7.5);assert.equal(helpers.rulesName(record.rules),'chinese');
 const frames=[{board:b,turn:'W',move:null},{board:helpers.setPoint(b,72,'W'),turn:'B',move:{side:'W',index:72}},{board:helpers.setPoint(b,72,'W'),turn:'W',move:{side:'B',index:null}}];
 const again=helpers.framesFromRecord(readSgf(helpers.sequenceSgf(frames,{rules:'japanese',komi:6.5})));assert.deepEqual(again,frames);
 assert.deepEqual(helpers.invalidStones(helpers.setPoint(helpers.setPoint(helpers.setPoint(helpers.emptyBoard(),0,'W'),1,'B'),19,'B')),[0]);
});
