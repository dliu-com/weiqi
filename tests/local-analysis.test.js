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
 prepend(...nodes){this.children.unshift(...nodes);}
 before(){}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 getAttribute(key){return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 addEventListener(){}
 scrollIntoView(){}
 click(){this.onclick?.();}
 querySelector(){return this.child??=new Element('button');}
 contains(){return false;}
 get rows(){return this.children;}
 get lastElementChild(){return this.last??=new Element('span');}
}
class BoardView {
 constructor(element,{onPoint}){this.element=element;this.onPoint=onPoint;this.points=Array.from({length:361},()=>new Element('button'));}
 render(board,options={}){this.board=board;this.options=options;this.element.dataset.preview=options.interactive===false?'':options.turn==='B'?'black':'white';}
}
function page(saved){
 const elements=new Map(),storage=new Map(),requests=[],replies=[];
 if(saved)storage.set('weiqi.local-analysis.v1',JSON.stringify(saved));
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const positionRequest=async(kind,body)=>{requests.push({kind,body});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;};
 const context=vm.createContext({
  ...helpers,language:'en',t:(zh,en)=>en,BoardView,readSgf,parseSgf,PositionError,positionRequest,cloudPosition,
  document:{getElementById:get,querySelectorAll:()=>[],querySelector:()=>new Element(),createElement:tag=>new Element(tag),documentElement:{},addEventListener(){}},
  window:{addEventListener(){}},matchMedia:()=>({matches:false}),performance:{now:()=>Date.now()},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},URL:{createObjectURL:()=>'blob:photo',revokeObjectURL(){}},AbortController
 });
 const source=readFileSync(new URL('../src/analysis.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 vm.runInContext(source,context);
 return {run:code=>vm.runInContext(code,context),get,storage,requests,replies};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const result={rootScoreLead:2.5,rootWinRate:.62,rootVisits:40,moves:[{x:3,y:15,pv:['D4','Q16'],scoreLead:2.5,winRate:.62,visits:30,relativePointsLost:0},{x:15,y:3,pv:['Q16'],scoreLead:1.8,winRate:.58,visits:10,relativePointsLost:.7}]};

test('a new visitor starts on step 1 with an editable empty board, the upload box above it and nothing saved',()=>{
 const p=page();assert.equal(p.run('stage'),'check');assert.equal(p.get('upload-box').hidden,false);assert.equal(p.get('check-card').hidden,false);assert.equal(p.get('analysis-settings').hidden,false);assert.equal(p.get('file-actions').hidden,true);
 assert.equal(p.get('photo-stage').dataset.mode,'none');assert.equal(p.run('view.options.interactive'),true);assert.equal(p.storage.size,0);
 p.run('pointClicked(60)');assert.equal(p.run('board[60]'),'B');assert.equal(JSON.parse(p.storage.get('weiqi.local-analysis.v1')).editing,true);
 p.run('pointClicked(60)');assert.equal(p.run('board[60]'),'B');
 p.get('tool-E').onclick();p.run('pointClicked(60)');assert.equal(p.storage.size,0);
});
test('one local sequence replaces only the continuation and survives refresh without analysis or photos',()=>{
 const p=page();p.run("stage='play';board=emptyBoard();resetFrames();playMove(60);playMove(72);navigate(cursor-1);playMove(288)");
 assert.equal(p.run('frames.length'),3);assert.equal(p.run('board[72]'),'.');assert.equal(p.run('board[288]'),'W');assert.equal(p.run('side'),'B');
 p.run("photo='blob:secret';analysis={secret:true};saveLocal()");
 const saved=JSON.parse(p.storage.get('weiqi.local-analysis.v1'));assert.deepEqual(Object.keys(saved).sort(),['cursor','editing','sgf','side']);assert.equal(saved.sgf.includes('secret'),false);
 const restored=page(saved);assert.equal(restored.run('stage'),'play');assert.equal(restored.run('cursor'),2);assert.equal(restored.run('board[60]'),'B');assert.equal(restored.run('board[288]'),'W');assert.equal(restored.run('side'),'B');
 assert.equal(page({...saved,side:'white'}).run('side'),'W');
});
test('checking stones alternates black and white, a tap on a stone does nothing outside erase, and undo and rotation keep review rings',()=>{
 const p=page();assert.equal(p.run('stage'),'check');assert.equal(p.get('tool-B').attributes['aria-pressed'],'true');
 p.run('pointClicked(0);pointClicked(1);pointClicked(2)');assert.equal(p.run('board.slice(0,3)'),'BWB');assert.equal(p.run('tool'),'W');
 assert.equal(p.get('tool-W').attributes['aria-pressed'],'true');assert.equal(p.get('tool-B').attributes['aria-pressed'],'false');assert.equal(p.get('board').dataset.preview,'white');
 const edits=p.run('undo.length');p.run('pointClicked(2);pointClicked(1)');assert.equal(p.run('board.slice(0,3)+tool'),'BWBW');assert.equal(p.run('undo.length'),edits);
 p.get('undo').onclick();assert.equal(p.run('board.slice(0,3)+tool'),'BW.B');
 p.get('tool-W').onclick();p.run('pointClicked(60)');assert.equal(p.run('board[60]+tool'),'WB');
 p.run('review=new Set([60])');p.get('rotate').onclick();assert.equal(p.run('board[rotatePoint(60)]'),'W');assert.equal(p.run('review.has(rotatePoint(60))'),true);
 p.get('tool-E').onclick();assert.equal(p.get('board').dataset.preview,'erase');assert.equal(p.get('tool-B').attributes['aria-pressed'],'false');
 p.run('pointClicked(rotatePoint(60))');assert.equal(p.run('board[rotatePoint(60)]+tool'),'.E');assert.equal(p.run('review.size'),0);
 const undos=p.run('undo.length');p.run('pointClicked(rotatePoint(60))');assert.equal(p.run('undo.length'),undos);
 assert.equal(JSON.parse(p.storage.get('weiqi.local-analysis.v1')).editing,true);
});
test('analysis is one request per action, blocks stones without liberties and re-analyses after a played move',async()=>{
 const p=page();p.run("stage='check';board=setPoint(setPoint(setPoint(emptyBoard(),0,'W'),1,'B'),19,'B');resetFrames()");
 await p.run('analyse()');assert.equal(p.requests.length,0);assert.equal(p.run('status.tone'),'error');assert.match(p.get('status').textContent,/A19/);
 p.run("board=setPoint(board,0,'.');resetFrames()");p.replies.push(result);await p.run('analyse()');
 assert.equal(p.requests.length,1);assert.equal(p.requests[0].kind,'analyze');assert.equal(p.requests[0].body.side,'B');assert.equal(p.requests[0].body.rules,'chinese');assert.equal(p.requests[0].body.komi,7.5);assert.equal(p.requests[0].body.initialBoard[1],'B');
 assert.equal(p.run('stage'),'play');assert.equal(p.run('autoAnalyse'),true);assert.equal(p.get('result-card').hidden,false);assert.equal(p.get('suggestions').children.length,2);
 assert.equal(p.run('view.points[288].dataset.candidateQuality'),'best');assert.equal(p.run('view.points[72].dataset.candidateQuality'),'inaccuracy');
 p.run('togglePreview(0)');assert.equal(p.run('pinned'),0);assert.equal(p.requests.length,1);
 p.run('pointClicked(0)');assert.equal(p.run('pinned'),null);assert.equal(p.run('frames.length'),1);
 p.replies.push(result);p.get('play-preview').onclick();p.run('pointClicked(288)');await settle();
 assert.equal(p.run('frames.length'),2);assert.equal(p.run('board[288]'),'B');assert.equal(p.requests.length,2);assert.equal(JSON.stringify(p.requests[1].body.moves),JSON.stringify([{side:'B',index:288}]));
});
test('an empty board can be analysed, and Next to play defaults to Black after a cleared board',async()=>{
 const p=page();p.replies.push(result);await p.run('analyse()');
 assert.equal(p.requests.length,1);assert.equal(p.requests[0].body.initialBoard,'.'.repeat(361));assert.equal(p.requests[0].body.side,'B');assert.equal(p.run('stage'),'play');
 p.get('edit-stones').onclick();p.run("board=setPoint(emptyBoard(),60,'B');resetFrames()");p.get('side-W').onclick();assert.equal(p.run('side'),'W');
 p.get('clear').onclick();assert.equal(p.run('side+tool'),'BB');assert.equal(p.get('side-B').attributes['aria-pressed'],'true');
});
test('komi can be 7.5 or 0.5; changing it clears the result and it is saved with the position',async()=>{
 const p=page();assert.equal(p.get('komi-7.5').attributes['aria-pressed'],'true');assert.equal(p.get('komi-0.5').attributes['aria-pressed'],'false');
 p.run("board=setPoint(emptyBoard(),60,'B');resetFrames();render()");p.replies.push(result);await p.run('analyse()');assert.equal(p.requests[0].body.komi,7.5);
 assert.equal(p.get('analysis-settings').hidden,true);
 p.get('edit-stones').onclick();assert.equal(p.run('stage'),'check');assert.equal(p.get('analysis-settings').hidden,false);assert.equal(p.get('settings-fields').hidden,false);
 p.get('komi-0.5').onclick();assert.equal(p.run('komi'),0.5);assert.equal(p.run('analysis'),null);assert.equal(p.get('komi-0.5').attributes['aria-pressed'],'true');
 p.replies.push(result);await p.run('analyse()');assert.equal(p.requests[1].body.komi,0.5);assert.match(p.get('analysis-time').textContent,/komi 0\.5/);
 const saved=JSON.parse(p.storage.get('weiqi.local-analysis.v1'));assert.match(saved.sgf,/KM\[0\.5\]/);assert.equal(page(saved).run('komi'),0.5);
 assert.equal(p.run('nearestKomi(0)'),0.5);assert.equal(p.run('nearestKomi(6.5)'),7.5);
});
test('two steps: step 1 sets up the board with the upload box, and step 1 can be reopened from the analysis',async()=>{
 const p=page(),step=n=>p.get('step-'+n).querySelector('button');
 assert.equal(p.get('step-1').dataset.state,'current');assert.equal(step(1).disabled,true);assert.equal(step(2).disabled,true);
 p.run("board=setPoint(emptyBoard(),60,'B');resetFrames();render()");
 p.replies.push(result);await p.run('analyse()');assert.equal(p.run('stage'),'play');
 assert.equal(p.get('upload-box').hidden,true);assert.equal(p.get('check-card').hidden,true);assert.equal(p.get('file-actions').hidden,false);
 assert.equal(p.get('step-1').dataset.state,'done');assert.equal(p.get('step-2').dataset.state,'done');assert.equal(step(1).disabled,false);assert.equal(step(2).disabled,true);
 step(1).onclick();assert.equal(p.run('stage'),'check');assert.equal(p.run('analysis'),null);assert.equal(p.run('board[60]'),'B');assert.equal(p.get('upload-box').hidden,false);assert.equal(p.requests.length,1);
 p.run("stage='play';busy='analysing';render()");assert.equal(step(1).disabled,true);p.run("busy=null");
});
test('a photo that cannot be read keeps the board, stays on step 1 and shows the photo for placing stones by hand',async()=>{
 const p=page();p.run("board=setPoint(emptyBoard(),60,'B');resetFrames();render()");
 p.run("encodePhoto=async()=>'aW1n'");p.replies.push(new PositionError('Could not reliably detect the whole board. Try a closer photo with every grid edge visible.',422));
 await p.run("openPhoto({name:'board.jpg',size:1000})");await settle();
 assert.equal(p.run('stage'),'check');assert.equal(p.run('busy'),null);assert.equal(p.run('board[60]'),'B');assert.equal(p.run('failed'),true);
 assert.equal(p.get('photo-stage').dataset.mode,'photo');assert.equal(p.get('photo-button').textContent,'Try another photo');assert.match(p.get('status').textContent,/place the stones on the board/);
 p.get('hide-photo').onclick();assert.equal(p.get('photo-stage').dataset.mode,'none');assert.equal(p.get('photo-thumb').hidden,false);
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
 const record=readSgf(helpers.setupSgf(b,{side:'W',rules:'chinese',komi:7.5}));assert.equal(record.nodes[0].board,b);assert.equal(record.initialPlayer,'W');assert.equal(record.komi,7.5);assert.match(String(record.rules),/chinese/i);
 const frames=[{board:b,turn:'W',move:null},{board:helpers.setPoint(b,72,'W'),turn:'B',move:{side:'W',index:72}},{board:helpers.setPoint(b,72,'W'),turn:'W',move:{side:'B',index:null}}];
 const again=helpers.framesFromRecord(readSgf(helpers.sequenceSgf(frames,{rules:'chinese',komi:7.5})));assert.deepEqual(again,frames);
 assert.deepEqual(helpers.invalidStones(helpers.setPoint(helpers.setPoint(helpers.setPoint(helpers.emptyBoard(),0,'W'),1,'B'),19,'B')),[0]);
});
