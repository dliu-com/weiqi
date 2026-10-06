import {BOARD_COLUMNS,boardGeometry,boardDisplayPoint} from './board-geometry.js';
import {t} from './i18n.js';
export const boardCoordinate=i=>BOARD_COLUMNS[i%19]+(19-Math.floor(i/19));
export class BoardView {
 constructor(element,{onPoint=()=>{},horizontalArrows=true}={}){
  this.element=element;this.rotation=0;element.replaceChildren();
  for(const rail of element.parentElement.querySelectorAll('.coordinates'))rail.remove();
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 190 190');svg.setAttribute('aria-hidden','true');
  const geometry=boardGeometry();for(const attrs of geometry.lines){const line=document.createElementNS(ns,'line');for(const [key,value]of Object.entries({...attrs,stroke:'#634c2b','stroke-width':.4}))line.setAttribute(key,value);svg.append(line);}for(const attrs of geometry.stars){const c=document.createElementNS(ns,'circle');for(const [key,value]of Object.entries({...attrs,r:1.1,fill:'#46351f'}))c.setAttribute(key,value);svg.append(c);}element.append(svg);
  for(const side of ['top','bottom','left','right']){const rail=document.createElement('div');rail.className='coordinates coordinates-'+side;rail.setAttribute('aria-hidden','true');for(let i=0;i<19;i++){const label=document.createElement('span');label.textContent=['top','bottom'].includes(side)?BOARD_COLUMNS[i]:19-i;rail.append(label);}element.parentElement.append(rail);}
  this.points=Array.from({length:361},(_,i)=>{const point=document.createElement('button');point.type='button';point.className='point';point.tabIndex=i===180?0:-1;Object.assign(point.style,{left:(i%19+.5)/19*100+'%',top:(Math.floor(i/19)+.5)/19*100+'%',width:100/19+'%',height:100/19+'%'});point.onclick=()=>onPoint(i);point.onkeydown=e=>{const offset={ArrowUp:-19,ArrowDown:19,...(horizontalArrows?{ArrowLeft:-1,ArrowRight:1}:{})}[e.key];if(!offset)return;e.preventDefault();e.stopPropagation();const displayed=boardDisplayPoint(i,this.rotation),next=displayed+offset;if(next>=0&&next<361&&(Math.abs(offset)===19||Math.floor(next/19)===Math.floor(displayed/19))){point.tabIndex=-1;const target=this.points[boardDisplayPoint(next,-this.rotation)];target.tabIndex=0;target.focus();}};element.append(point);return point;});
 }
 setRotation(quarterTurns){
  this.rotation=((quarterTurns%4)+4)%4;
  this.points.forEach((point,index)=>{const view=boardDisplayPoint(index,this.rotation);point.style.left=(view%19+.5)/19*100+'%';point.style.top=(Math.floor(view/19)+.5)/19*100+'%';});
  for(const rail of this.element.parentElement.querySelectorAll('.coordinates')){
   const horizontal=rail.classList.contains('coordinates-top')||rail.classList.contains('coordinates-bottom');
   [...rail.children].forEach((label,i)=>{const canonical=boardDisplayPoint(horizontal?i:i*19,-this.rotation),column=canonical%19,row=19-Math.floor(canonical/19);label.textContent=horizontal===(this.rotation%2===0)?BOARD_COLUMNS[column]:row;});
  }
 }
 render(board,{last=null,turn='B',interactive=true,numbers=new Map()}={}){this.element.dataset.preview=interactive?(turn==='B'?'black':'white'):'';this.points.forEach((p,i)=>{p.className='point'+(board[i]==='B'?' black':board[i]==='W'?' white':'')+(last===i?' last':'');p.textContent=numbers.get(i)||'';p.disabled=!interactive;p.setAttribute('aria-label',boardCoordinate(i)+' '+(board[i]==='B'?t('黑子','Black stone'):board[i]==='W'?t('白子','White stone'):t('空点','Empty')));});}
}
