export function chartGeometry(positions,width=360,height=150,mode='score',{left=34,right=12}={}) {
  const top=12,bottom=28,last=Math.max(1,positions.at(-1)?.move || 0);
  const max=Math.max(5,...positions.map(p=>Math.abs(p.blackLead)));
  const extent=mode==='win'?50:Math.ceil(max/5)*5, baseline=(height-bottom+top)/2;
  const x=move=>left+move/last*(width-left-right), y=lead=>baseline-lead/extent*(baseline-top);
  return {width,height,left,right,top,bottom,last,extent,baseline,x,y,points:positions.map(p=>({x:x(p.move),y:y(mode==='win'?p.blackWinrate*100-50:p.blackLead),move:p.move,nodeId:p.nodeId}))};
}
export function drawEvaluationChart(container,positions,selectedNode,onSelect,labels,mode='score') {
  container.replaceChildren();if(!positions.length)return;
  const compact=window.innerWidth>850&&window.innerHeight<=820;
  const mobile=window.innerWidth<=850;
  const height=mobile?Math.min(130,Math.max(96,window.innerHeight*.13)):compact?110:Number.isFinite(window.innerHeight)?Math.min(240,Math.max(140,window.innerHeight*.20)):240;
  const g=chartGeometry(positions,Math.max(360,container.clientWidth),height,mode),ns='http://www.w3.org/2000/svg';
  const element=(tag,attrs={})=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);return e;};
  const selected=positions.find(p=>p.nodeId===selectedNode),svg=element('svg',{viewBox:`0 0 ${g.width} ${g.height}`,role:'slider',tabindex:'0','aria-label':labels.chart,'aria-valuemin':0,'aria-valuemax':positions.at(-1).move,'aria-valuenow':selected?.move || 0,'aria-valuetext':selected?labels.move(selected.move):labels.variation});
  const line=(x1,y1,x2,y2,cls)=>svg.append(element('line',{x1,y1,x2,y2,class:cls}));
  for(const score of [-g.extent,0,g.extent]){line(g.left,g.y(score),g.width-g.right,g.y(score),'chart-grid');const text=element('text',{x:g.left-6,y:g.y(score)+4,'text-anchor':'end',class:'chart-label'});text.textContent=mode==='win'?(score+50)+'%':score>0?'+'+score:score;svg.append(text);}
  const path=g.points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ');
  const defs=element('defs');for(const side of ['black','white']){const clip=element('clipPath',{id:'chart-clip-'+side});clip.append(element('rect',{x:0,y:side==='black'?0:g.baseline,width:g.width,height:side==='black'?g.baseline:g.height-g.baseline}));defs.append(clip);}svg.append(defs);
 for(const side of ['black','white'])svg.append(element('path',{d:`M${g.points[0].x},${g.baseline} ${path.replace(/^M/,'L')} L${g.points.at(-1).x},${g.baseline} Z`,class:'chart-area chart-area-'+side,'clip-path':'url(#chart-clip-'+side+')'}));
  line(g.left,g.baseline,g.width-g.right,g.baseline,'chart-zero');svg.append(element('path',{d:path,class:'chart-line'}));
  const end=positions.at(-1).move,step=end>100?Math.ceil(end/5/10)*10:Math.max(1,Math.ceil(end/5));
  const ticks=new Set([0,end]);for(let n=step;n<end-step/2;n+=step)ticks.add(n);
  for(const n of ticks){line(g.x(n),g.height-g.bottom,g.x(n),g.height-g.bottom+4,'chart-zero');const text=element('text',{x:g.x(n),y:g.height-8,'text-anchor':'middle',class:'chart-label'});text.textContent=n;svg.append(text);}
  if(selected){line(g.x(selected.move),g.top,g.x(selected.move),g.height-g.bottom,'chart-selected');svg.append(element('circle',{cx:g.x(selected.move),cy:g.y(mode==='win'?selected.blackWinrate*100-50:selected.blackLead),r:4,class:'chart-current'}));}
  const selectMove=move=>{const nearest=positions.reduce((best,p)=>Math.abs(p.move-move)<Math.abs(best.move-move)?p:best,positions[0]);onSelect(nearest.nodeId);};
  svg.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();
    const pointerId=event.pointerId,controller=new AbortController();let lastMove=-1;
    const scrub=event=>{if(event.pointerId!==pointerId)return;const rect=container.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*g.width,move=Math.max(0,Math.min(end,Math.round((x-g.left)/(g.width-g.left-g.right)*g.last)));if(move!==lastMove){lastMove=move;selectMove(move);}};
    window.addEventListener('pointermove',scrub,{signal:controller.signal});
    const stop=event=>{if(event.pointerId===pointerId)controller.abort();};
    window.addEventListener('pointerup',stop,{signal:controller.signal});window.addEventListener('pointercancel',stop,{signal:controller.signal});window.addEventListener('blur',()=>controller.abort(),{signal:controller.signal,once:true});
    scrub(event);
  });
  svg.addEventListener('keydown',event=>{let n=selected?.move || 0;if(event.key==='ArrowRight'||event.key==='ArrowUp')n++;else if(event.key==='ArrowLeft'||event.key==='ArrowDown')n--;else if(event.key==='Home')n=0;else if(event.key==='End')n=end;else return;event.preventDefault();selectMove(n);container.querySelector('svg')?.focus();});
  container.append(svg);
}
