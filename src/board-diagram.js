import {boardGeometry} from './board-geometry.js';
// SVGs contain only validated board values, numeric labels and Go coordinates.
export function boardDiagram(board,{labels=[],last=null}={}){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 440 440');svg.setAttribute('role','img');svg.setAttribute('aria-label','19 × 19 Go diagram');
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 add('rect',{width:440,height:440,fill:'#f3e0bb'});const geometry=boardGeometry(40,20);for(const attrs of geometry.lines)add('line',{...attrs,stroke:'#6d5d43','stroke-width':.65});for(const {position:p,column,row}of geometry.labels){for(const y of [20,425])add('text',{x:p,y,'text-anchor':'middle',fill:'#51473a','font-size':12},column);for(const x of [19,420])add('text',{x,y:p+3,'text-anchor':'middle',fill:'#51473a','font-size':12},row);}for(const attrs of geometry.stars)add('circle',{...attrs,r:2.3,fill:'#4d432f'});
 for(let i=0;i<361;i++)if(board[i]==='B'||board[i]==='W')add('circle',{cx:40+i%19*20,cy:40+Math.floor(i/19)*20,r:9.3,fill:board[i]==='B'?'#202629':'white',stroke:'#545b5e','stroke-width':.7});
 const numbered=new Map();for(const m of labels)if(Number.isInteger(m.index)&&m.index>=0&&m.index<361&&(!m.side||board[m.index]===m.side))numbered.set(m.index,m);
 for(const [index,m] of numbered){const x=40+index%19*20,y=40+Math.floor(index/19)*20;if(m.colour)add('circle',{cx:x,cy:y,r:9.6,fill:m.colour,stroke:'white','stroke-width':1});add('text',{x,y:y+3.2,'text-anchor':'middle','font-size':String(m.label).length>2?6.5:9,'font-weight':700,fill:m.colour?'white':board[index]==='B'?'white':'#202629'},m.label);}
 if(Number.isInteger(last))add('circle',{cx:40+last%19*20,cy:40+Math.floor(last/19)*20,r:6.5,fill:'none',stroke:'#ce692a','stroke-width':1.8});
 return svg;
}
