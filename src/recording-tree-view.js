import {boardCoordinate} from './board-view.js';

import {recordingTreeLayout} from './recording-tree.js';

export class RecordingTreeView{
 constructor(container,onSelect){this.container=container;this.onSelect=onSelect;this.selected=null;}
 render(record,selected,t,continuations){
  const {positions,edges,lanes,columns}=recordingTreeLayout(record,selected,continuations),main=new Set(record.mainLine),byId=new Map(positions.map(p=>[p.id,p])),pitch=40,row=44,pad=24;
  const canvas=document.createElement('div');canvas.className='editor-tree-canvas';canvas.style.width=(columns-1)*pitch+pad*2+'px';canvas.style.height=Math.max(132,(lanes-1)*row+pad*2)+'px';
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('editor-tree-links');svg.setAttribute('aria-hidden','true');svg.setAttribute('width',(columns-1)*pitch+pad*2);svg.setAttribute('height',Math.max(132,(lanes-1)*row+pad*2));
  const ancestors=new Set(positions.filter(p=>p.lane===0).map(p=>p.id));
  for(const {parent,child}of edges){const a=byId.get(parent),b=byId.get(child),x=pad+a.column*pitch,y=pad+a.lane*row,nx=pad+b.column*pitch,ny=pad+b.lane*row,path=document.createElementNS(ns,'path');path.setAttribute('d',y===ny?`M${x},${y} H${nx}`:`M${x},${y} C${x+pitch/2},${y} ${nx-pitch/2},${ny} ${nx},${ny}`);path.setAttribute('class',ancestors.has(child)?'selected-path':main.has(child)?'main-path':'');svg.append(path);}
  canvas.append(svg);let active;
  for(const p of positions){const n=record.nodes[p.id],button=document.createElement('button');button.type='button';button.className='editor-tree-stone '+(n.move?.side==='B'?'tree-black':n.move?'tree-white':'tree-root')+(main.has(p.id)?' main-path':'');button.style.left=pad+p.column*pitch+'px';button.style.top=pad+p.lane*row+'px';button.dataset.node=p.id;button.setAttribute('aria-pressed',String(p.id===selected));const description=(n.move?t('第 '+n.depth+' 手','Move '+n.depth)+' · '+(n.move.side==='B'?t('黑','Black'):t('白','White'))+' '+(n.move.index===null?t('停一手','Pass'):boardCoordinate(n.move.index)):t('初始局面','Initial position'))+(main.has(p.id)?' · '+t('主分支','Main branch'):'');button.setAttribute('aria-label',description);button.title=description;button.textContent=n.depth;button.onclick=()=>this.onSelect(p.id);canvas.append(button);if(p.id===selected)active=button;}
  const left=this.container.scrollLeft,top=this.container.scrollTop,focused=this.container.contains(document.activeElement);this.container.replaceChildren(canvas);this.container.scrollLeft=left;this.container.scrollTop=top;
  // Keep the active stone visible without moving the controls panel or page.
  if(active&&selected!==this.selected){const p=byId.get(selected),x=pad+p.column*pitch,y=pad+p.lane*row,w=this.container.clientWidth,h=this.container.clientHeight;if(x-20<left)this.container.scrollLeft=Math.max(0,x-36);else if(x+20>left+w)this.container.scrollLeft=x+36-w;if(y-20<top)this.container.scrollTop=Math.max(0,y-36);else if(y+20>top+h)this.container.scrollTop=y+36-h;}
  if(focused)active?.focus({preventScroll:true});this.selected=selected;
 }
}
