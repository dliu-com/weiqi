import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
import {reportPagination} from './report-document.js';
import {selectReportHighlights} from './report-highlights.js';
import {fullGameRecord} from './report-game-record.js';
import {comparisonChart,compositionChart,qualityLegend,reportChartColours,niceTicks} from './report-stat-charts.js';
import {REPORT_VERSION} from './report-version.js';
import {timeControlSummary} from './time-control.js';
import {texToMathML} from './report-math.js';
import {gamePhases,phaseLosses,favouredByPhase,decidedFrom,leadChanges,phaseLeads,topLossShare} from './report-insights.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/game\/([^/]+)\/report\/?$/)?.[1]||new URLSearchParams(location.search).get('game');
let report=null,reportLanguage=new URLSearchParams(location.search).get('lang')==='zh'?'zh':'en';
// The report font draws curly quotes full-width, so English text uses straight quotes.
const plain=text=>typeof text==='string'?text.replace(/[‘’]/g,"'").replace(/[“”]/g,'"'):text;
const t=(zh,en)=>reportLanguage==='zh'?zh:plain(en);
const markColours={played:'#c8372d',best:'#17806a'};
let anchors={};
const locale=()=>reportLanguage==='zh'?'zh-CN':'en-GB';
const timestamp=value=>{const parts=new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'medium'}).format(new Date(value)),zone=new Intl.DateTimeFormat(locale(),{timeZoneName:'longOffset'}).formatToParts(new Date(value)).find(p=>p.type==='timeZoneName')?.value;return parts+' · '+zone+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
const qualities=()=>({inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')});
const qualityName=key=>key==='good'?t('好棋','Good'):qualities()[key];
const rulesName=value=>({japanese:t('日本规则','Japanese rules'),chinese:t('中国规则','Chinese rules'),aga:t('AGA 规则','AGA rules'),korean:t('韩国规则','Korean rules')})[value?.toLowerCase()]||value;
function table(headers,rows){const e=node('table',undefined,'report-table'),head=node('thead'),h=node('tr');for(const text of headers)h.append(node('th',text));head.append(h);e.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const text of cells)row.append(node('td',text));body.append(row);}e.append(body);return e;}
function diagram(board,caption,{labels=[],marks=[]}={}){const f=node('figure',undefined,'report-board');const svg=boardDiagram(board,{labels,marks});svg.setAttribute('aria-label',t('十九路围棋图','19 × 19 Go diagram'));f.append(svg,node('figcaption',caption));return f;}
const sideName=side=>side==='B'?t('黑方','Black'):t('白方','White');
const sideBadge=(text,side)=>{const e=node('span',text,'report-side-badge report-side-'+side);e.setAttribute('aria-label',(side==='even'?t('均势','Even'):sideName(side==='black'?'B':'W'))+' '+text);return e;};
const leadBadge=v=>Math.abs(v)<.05?sideBadge('0.0','even'):sideBadge(number(Math.abs(v)),v>0?'black':'white');
const winBadge=v=>{const black=Math.max(0,Math.min(1,v))*100;return Math.abs(black-50)<.05?sideBadge('50.0%','even'):sideBadge(number(Math.max(black,100-black))+'%',black>50?'black':'white');};
const sideChange=(before,after)=>{const e=node('span',undefined,'report-side-change');e.append(before,document.createTextNode(' → '),after);return e;};
function reportPlot(label,series,{xMax=report.game.moves,yMax=1,decided=null}={}){
 const wrap=node('div',undefined,'report-chart'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 760 300');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);svg.setAttribute('class','report-plot');
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 const left=58,right=20,ticks=niceTicks(yMax),max=ticks.at(-1),step=ticks[1]-ticks[0],decimals=Math.max(0,-Math.floor(Math.log10(step)+1e-9)),x=v=>left+v/Math.max(1,xMax)*(760-left-right);
 // Every reviewed move gets a label; labels in a row are spread apart and joined to their stems.
 const half=42,gap=6,minX=left+half,maxX=740-half,reviewed=[...report.problems].sort((a,b)=>a.move-b.move),rows=Math.max(1,Math.ceil(reviewed.length*(2*half+gap)/(maxX-minX+2*half))),labels=reviewed.map((move,i)=>({move,pointX:x(move.move),row:i%rows}));
 for(let row=0;row<rows;row++){
  const items=labels.filter(l=>l.row===row);
  items.forEach((l,i)=>{l.labelX=Math.max(minX,l.pointX,i?items[i-1].labelX+2*half+gap:-Infinity);});
  for(let i=items.length-1;i>=0;i--)items[i].labelX=Math.min(items[i].labelX,maxX,i<items.length-1?items[i+1].labelX-2*half-gap:Infinity);
  for(const l of items)l.labelY=50+row*24;
 }
 const top=50+rows*24+10,y=v=>252-v/max*(252-top);
 for(const value of ticks){add('line',{x1:left,y1:y(value),x2:740,y2:y(value),stroke:value===0?reportChartColours.axis:reportChartColours.grid,'stroke-width':value===0?1:.7});add('text',{x:left-7,y:y(value)+3,'text-anchor':'end','font-size':10,fill:reportChartColours.ink},value.toFixed(decimals));}
 for(const value of [0,Math.round(xMax/4),Math.round(xMax/2),Math.round(xMax*3/4),xMax])add('text',{x:x(value),y:274,'text-anchor':'middle','font-size':10,fill:reportChartColours.ink},value);
 for(const entry of series){
  const colour=entry.side==='B'?reportChartColours.black:reportChartColours.white;
  for(const point of entry.points){
   const stem={x1:x(point.x),x2:x(point.x),y1:252,y2:y(point.y)};
   if(entry.side==='W')add('line',{...stem,stroke:reportChartColours.line,'stroke-width':2.8});
   add('line',{...stem,stroke:colour,'stroke-width':1.4});
   const dot=add('circle',{cx:x(point.x),cy:y(point.y),r:report.problems.some(m=>m.move===point.x)?3.5:1.5,fill:colour,stroke:reportChartColours.line,'stroke-width':.7});
   const title=document.createElementNS(ns,'title');title.textContent=sideName(entry.side)+' · '+t('第 ','Move ')+point.x+' · '+number(point.y);dot.append(title);
  }
 }
 if(decided){
  // The key sits in the title row so it never collides with move labels.
  const dx=x(decided.move),dash={stroke:reportChartColours.axis,'stroke-width':1.2,'stroke-dasharray':'5 4'};
  add('line',{x1:dx,x2:dx,y1:top,y2:252,...dash,'data-decided':decided.move});
  add('line',{x1:560,x2:584,y1:18,y2:18,...dash});
  add('text',{x:590,y:22,'font-size':12,fill:reportChartColours.ink},t('胜负已定 · 第 '+decided.move+' 手','Decided · move '+decided.move));
 }
 add('text',{x:left,y:22,'font-size':14,'font-weight':600,fill:reportChartColours.ink},t('损失目数 · 越低越好','Points lost · lower is better'));
 for(const {move,pointX,labelX,labelY} of labels){
  add('line',{x1:pointX,x2:labelX,y1:y(move.pointLoss)-6,y2:labelY+6,stroke:reportChartColours.line,'stroke-width':.8,'stroke-dasharray':'3 3'});
  add('rect',{x:labelX-half,y:labelY-16,width:2*half,height:23,rx:3,fill:move.side==='B'?reportChartColours.black:reportChartColours.white,stroke:reportChartColours.line,'stroke-width':.7});
  add('text',{x:labelX,y:labelY,'text-anchor':'middle','font-size':12,fill:move.side==='B'?'white':reportChartColours.ink,'data-review-label':move.move},sideName(move.side)+' · '+move.move);
 }
 add('text',{x:400,y:295,'text-anchor':'middle','font-size':13,fill:reportChartColours.ink},t('实战手数 →','Recorded move →'));
 wrap.append(svg,chartLegend(sideName('B'),sideName('W')));return wrap;
}
function chartLegend(black,white){
 const legend=node('div',undefined,'report-chart-legend');
 for(const [side,label] of [['black',black],['white',white]]){const item=node('span'),swatch=node('i',undefined,'report-swatch-'+side);swatch.setAttribute('aria-hidden','true');item.append(swatch,document.createTextNode(label));legend.append(item);}
 return legend;
}
function contextChart(mode){
 const ns='http://www.w3.org/2000/svg',wrap=node('div',undefined,'report-chart'),base=chartGeometry(report.chart,760,260,mode,{left:108,right:20}),g={...base,height:320,top:base.top+32,baseline:base.baseline+32,y:v=>base.y(v)+32,points:base.points.map(p=>({...p,y:p.y+32}))},svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 760 320');svg.setAttribute('role','img');svg.setAttribute('class','report-plot');svg.setAttribute('data-chart-mode',mode);svg.setAttribute('aria-label',mode==='win'?t('黑方胜率走势','Black win probability'):t('黑方目差','Black point advantage'));
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 for(const value of [-g.extent,0,g.extent]){add('line',{x1:g.left,y1:g.y(value),x2:g.width-g.right,y2:g.y(value),stroke:reportChartColours.grid,'stroke-width':.7});add('text',{x:g.left-6,y:g.y(value)+3,'text-anchor':'end','font-size':10,fill:reportChartColours.ink},mode==='win'?(value+50)+'%':(value>0?'+':'')+value);}
 const path=g.points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' ');
 if(g.points.length){
  const defs=document.createElementNS(ns,'defs');
  for(const side of ['black','white']){
   const clip=document.createElementNS(ns,'clipPath');clip.setAttribute('id','report-clip-'+mode+'-'+side);
   const rect=document.createElementNS(ns,'rect');
   for(const [key,value] of Object.entries({x:g.left,y:side==='black'?g.top:g.baseline,width:g.width-g.left-g.right,height:side==='black'?g.baseline-g.top:base.height-base.bottom+32-g.baseline}))rect.setAttribute(key,value);
   clip.append(rect);defs.append(clip);
  }
  svg.append(defs);
  const area='M'+g.points[0].x+','+g.baseline+' '+path.replace(/^M/,'L')+' L'+g.points.at(-1).x+','+g.baseline+' Z';
  for(const side of ['black','white'])add('path',{d:area,fill:reportChartColours[side],'clip-path':'url(#report-clip-'+mode+'-'+side+')','data-leader':side});
 }
 add('line',{x1:g.left,y1:g.baseline,x2:g.width-g.right,y2:g.baseline,stroke:reportChartColours.axis,'stroke-width':1});add('path',{d:path,fill:'none',stroke:reportChartColours.line,'stroke-width':1.2});
 for(const value of [...new Set([0,Math.round(g.last/4),Math.round(g.last/2),Math.round(g.last*3/4),g.last])])add('text',{x:g.x(value),y:296,'text-anchor':'middle','font-size':13,fill:reportChartColours.ink},value);
 for(const move of report.problems){const point=g.points.find(p=>p.nodeId===move.nodeId);if(point)add('circle',{cx:point.x,cy:point.y,r:3.5,fill:move.side==='B'?reportChartColours.black:reportChartColours.white,stroke:move.side==='B'?reportChartColours.white:reportChartColours.line,'stroke-width':1});}
 add('text',{x:g.left,y:23,'font-size':14,'font-weight':600,fill:reportChartColours.ink},mode==='win'?t('黑方获胜机会 (%)','Black winning chance (%)'):t('预计目差（目）','Estimated point lead'));
 for(const [side,y] of [['B',88],['W',220]]){
  add('rect',{x:6,y:y-22,width:92,height:42,rx:4,fill:side==='B'?reportChartColours.black:reportChartColours.white,stroke:reportChartColours.line,'stroke-width':.8});
  add('text',{x:52,y:y-5,'text-anchor':'middle','font-size':14,'font-weight':600,fill:side==='B'?'white':reportChartColours.ink},sideName(side));
  add('text',{x:52,y:y+12,'text-anchor':'middle','font-size':12,fill:side==='B'?'white':reportChartColours.ink},mode==='win'?t('胜算更高','favoured'):t('领先','ahead'));
 }
 add('rect',{x:614,y:g.baseline-10,width:124,height:20,rx:3,fill:'#cbd2d6','fill-opacity':.95});
 add('text',{x:676,y:g.baseline+4,'text-anchor':'middle','font-size':12,fill:reportChartColours.ink},mode==='win'?t('机会均等 · 50%','Equal chances · 50%'):t('持平 · 0 目','Even · 0 points'));
 add('text',{x:424,y:315,'text-anchor':'middle','font-size':13,fill:reportChartColours.ink},t('实战手数 →','Recorded move →'));
 wrap.append(svg,chartLegend(t('黑方关键时刻 · 后文详解','Black key moment · reviewed later'),t('白方关键时刻 · 后文详解','White key moment · reviewed later')));return wrap;
}
function graphTakeaway(title){
 const guides=[
  ['各类着法占比','Share of each move quality','先看橙色和红色：这些失误最值得复盘。','Start with orange and red: these decisions deserve review.'],
  ['典型损失与较大失误','Typical loss and bigger errors','条形越短，损失越小。平均值明显高于中位数时，优先复盘大失误。','Shorter bars mean less loss. A high average beside a low median points to a few costly mistakes.'],
  ['各阶段的平均目数损失','Average point loss in each phase','最长的条形提示最值得复盘的阶段。','Your longest bar shows the phase to review first.'],
  ['每手损失在哪里发生？','Where did each move lose points?','尖峰越高，损失越大。标出的手数是关键时刻，后文有棋盘详解。','Taller spikes mean bigger losses. Labelled moves are key moments with board reviews later.'],
  ['目差：正为黑方领先，负为白方领先','Point advantage: positive Black, negative White','穿过零线表示预计领先方改变。','Crossing zero changes the estimated leader.']
 ];
 const entry=guides.find(g=>g[0]===title||g[1]===title);return entry?t(entry[2],entry[3]):'';
}
function statisticGraph(key,title,visual,insight){
 const figure=node('figure',undefined,'report-stat-card'),caption=node('figcaption',undefined,'report-graph-maths');
 figure.append(node('h3',title),...[visual].flat());const reading=graphTakeaway(title);if(reading)figure.append(node('p',reading,'report-graph-reading'));if(insight){caption.append(node('h4',t('AI 分析','AI analysis'),'report-insight-heading'),insight);figure.append(caption);}
 // The calculation appendix links back to the pages that use each method.
 anchors[key]=figure;return figure;
}
function addStatistics(sheet){
 const keys=['best','good','inaccuracy','mistake','blunder'],names={best:t('AI 首选','AI first choice'),good:t('好棋','Good'),...qualities()},sides={B:sideName('B'),W:sideName('W')};
 const rows=definitions=>definitions.map(([key,zh,en])=>({key,label:t(zh,en),values:['B','W'].map(side=>report.players[side][key])}));
 const compare=(title,definitions,options={})=>comparisonChart(title,rows(definitions),{names:sides,axisLabel:t('损失目数 · 越低越好 →','Points lost · lower is better →'),...options});
 const graph=(parent,key,title,svg,insight)=>parent.append(statisticGraph(key,title,svg,insight));
 const moves=report.game.moves,phases=phaseLosses(report.reviews,moves),phaseName=key=>({opening:t('开局','opening'),middle:t('中盘','middle game'),endgame:t('收官','endgame')})[key],capital=text=>text[0].toUpperCase()+text.slice(1);
 const leadText=v=>Math.abs(v)<.05?t('持平','even'):sideName(v>0?'B':'W')+' +'+number(Math.abs(v)),percent=v=>Math.round(v)+'%',join=parts=>parts.join(t('；','; '));
 const phaseLabel=p=>capital(phaseName(p.key))+' '+p.from+'–'+p.to;
 const analysis=(rows,after,note)=>{const e=node('div',undefined,'report-graph-insight');if(rows)e.append(rows);if(note)e.append(node('p',note,'report-note'));if(after)e.append(node('p',after));return e;};
 const scoreInsight=()=>{
  const ends=phaseLeads(report.chart,moves),lead=leadChanges(report.chart);
  const second=!lead.leader?t('双方领先均未超过 1 目。','Neither side led by more than 1 point.'):!lead.changes?t('只有'+sideName(lead.leader)+'曾领先超过 1 目，从第 '+lead.since+' 手开始。','Only '+sideName(lead.leader)+' led by more than 1 point, first at move '+lead.since+'.'):t('领先超过 1 目的一方共变化 '+lead.changes+' 次；最后一次在第 '+lead.since+' 手，变为'+sideName(lead.leader)+'。','The side leading by more than 1 point changed '+lead.changes+(lead.changes===1?' time':' times')+'; the last change was at move '+lead.since+', to '+sideName(lead.leader)+'.');
  return analysis(ends.length?table([t('阶段','Phase'),t('本阶段最大领先','Biggest lead in phase')],ends.map(p=>[phaseLabel(p),leadText(p.peak.lead)+(Math.abs(p.peak.lead)<.05?'':t('（第 '+p.peak.move+' 手）',' (move '+p.peak.move+')'))])):null,second);
 };
 const winInsight=()=>{
  const shares=favouredByPhase(report.chart,moves),decided=decidedFrom(report.chart);
  const second=decided?t('从第 '+decided.move+' 手起，'+sideName(decided.side)+'胜率一直不低于 90%。','From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher.'):t('终局时双方胜率都未达到 90%。','Neither side reached 90% by the end.');
  return analysis(shares.length?table([t('阶段','Phase'),t('胜算更高的一方','Favoured side'),t('占该阶段手数','Share of moves')],shares.map(p=>[phaseLabel(p),p.side?sideName(p.side):t('机会均等','Even'),p.side?percent(p.percent):'—'])):null,second);
 };
 const lossInsight=()=>{
  const [b,w]=['B','W'].map(side=>topLossShare(report.reviews,side)),share=v=>v.percent===null?'—':percent(v.percent);
  if(b.percent===null&&w.percent===null)return '';
  return analysis(table(['',sideName('B'),sideName('W')],[[t('总损失目数','Total points lost'),number(b.total),number(w.total)],[t('最大五手的损失目数','Five biggest losses'),number(b.top),number(w.top)],[t('最大五手占比','Five biggest as share of total'),share(b),share(w)]]));
 };
 const phaseInsight=()=>{
  if(!phases.length)return '';
  const totals={B:0,W:0};for(const p of phases)for(const side of ['B','W'])totals[side]+=p[side].totalPointLoss;
  const loss=(p,side)=>number(p[side].totalPointLoss)+(totals[side]>0?t('（'+percent(100*p[side].totalPointLoss/totals[side])+'）',' ('+percent(100*p[side].totalPointLoss/totals[side])+')'):'');
  const rows=table([t('阶段','Phase'),t('黑方失误','Black mistakes'),t('白方失误','White mistakes'),t('黑方损失目数','Black points lost'),t('白方损失目数','White points lost')],phases.map(p=>[phaseLabel(p),String(p.B.errors),String(p.W.errors),loss(p,'B'),loss(p,'W')]));
  ['B','W'].forEach((side,column)=>{if(!(totals[side]>0))return;const most=Math.max(...phases.map(p=>p[side].totalPointLoss));phases.forEach((p,row)=>{if(p[side].totalPointLoss===most)rows.tBodies[0].rows[row].cells[3+column].classList.add('report-table-max');});});
  return analysis(rows,null,t('失误包括严重失误（单手损失超过 2 目）。括号内为占该方总损失的比例；粗体为该方损失最多的阶段。','Mistakes include blunders (over 2 points each). Brackets show the share of all points that player lost; bold marks the phase where each player lost most.'));
 };
 const context=sheet(t('全局目差走势：谁领先？','Game-wide point advantage'));
 graph(context,'score',t('目差：正为黑方领先，负为白方领先','Point advantage: positive Black, negative White'),contextChart('score'),scoreInsight());
 const winning=sheet(t('全局走势：获胜机会怎样变化？','Game-wide winning chances'));
 graph(winning,'win',t('黑方胜率','Black win probability'),contextChart('win'),winInsight());
 const quality=sheet(t('着法质量：一眼看清双方表现','Move quality: compare the whole game'));
 graph(quality,'quality',t('各类着法占比','Share of each move quality'),[compositionChart(t('着法质量占比','Move-quality composition'),['B','W','all'].map(side=>({label:side==='all'?t('全局','Whole game'):sideName(side),counts:(side==='all'?report.overall:report.players[side]).counts})),{keys,names,emptyLabel:t('无已评定着法','No rated moves')}),qualityLegend(names,{best:t('坐标匹配','coordinate match'),good:'≤ 0.5',inaccuracy:'0.5 < L ≤ 2',mistake:'2 < L ≤ 5',blunder:'> 5'})],analysis(table([t('着法类别','Move quality'),sideName('B'),sideName('W')],keys.map(key=>[names[key],report.players.B.counts[key],report.players.W.counts[key]]))));
 const loss=sheet(t('目数损失：典型表现与大失误','Point loss: typical play and large errors'));
 graph(loss,'loss',t('典型损失与较大失误','Typical loss and bigger errors'),compare(t('目数损失分位比较','Point-loss comparison'),[['meanPointLoss','平均损失','Average'],['medianPointLoss','一半着法不超过','Half of moves ≤'],['p90PointLoss','九成着法不超过','90% of moves ≤']],{digits:2}),lossInsight());
 const phaseRanges=gamePhases(Infinity).map(p=>t(phaseName(p.key)+' '+p.from+(p.to===Infinity?' 手起':'–'+p.to+' 手'),phaseName(p.key)+' '+p.from+(p.to===Infinity?' onward':'–'+p.to))).join(t('，',', '));
 const stages=sheet(t('不同阶段的损失','Losses by game phase'));
 graph(stages,'phase',t('各阶段的平均目数损失','Average point loss in each phase'),comparisonChart(t('阶段平均损失','Mean loss by phase'),phases.filter(p=>p.B.moves||p.W.moves).map(p=>({key:'meanPointLoss-'+p.key,label:capital(phaseName(p.key))+' '+p.from+'–'+p.to,values:[p.B.meanPointLoss,p.W.meanPointLoss]})),{names:sides,digits:2,axisLabel:t('平均损失目数 · 越低越好 →','Average points lost · lower is better →')}),phaseInsight());
 const scope=report.keyScope||{mode:'open',decided:null},decided=scope.decided;
 const moments=sheet(t('关键时刻：值得复盘的失误','Key moments to review')),isRated=m=>keys.includes(m.quality)&&Number.isFinite(m.pointLoss),series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isRated(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 graph(moments,'moments',t('每手损失在哪里发生？','Where did each move lose points?'),reportPlot(t('逐手目数损失','Point loss by move'),series,{yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y))),decided:scope.mode==='decided'?decided:null}));anchors.momentsPage=moments;
 const both=t('损失超过 2 目、且胜率下降至少 5 个百分点','lost over 2 points and at least 5 percentage points of win chance');
 const rule=scope.mode==='decided'?t('关键时刻是第 '+decided.move+' 手及之前'+both+'的着法；从第 '+decided.move+' 手起'+sideName(decided.side)+'胜率一直不低于 90%，胜负已定。按目数损失 × 胜率损失排序。','Key moments are moves up to move '+decided.move+' that '+both+'. From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher, so the result was decided. They are ranked by points × percentage points.')
  :scope.mode==='early'?t('从第 '+decided.move+' 手起'+sideName(decided.side)+'胜率一直不低于 90%，胜率几乎不变，因此关键时刻按目数损失排序（超过 2 目）。','From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher and win chances barely moved, so key moments are the largest point losses over 2 points.')
  :t('关键时刻是'+both+'的着法，按目数损失 × 胜率损失排序。','Key moments are moves that '+both+', ranked by points × percentage points.');
 moments.append(node('p',rule+t('每方最多五手，前三手在后文配有棋盘图；点击手数可回到棋局。',' Up to five per side are listed and the first three have board reviews later; select a move number to replay it.'),'report-note'));
 for(const side of ['B','W']){
  const moves=report.keyMoves[side],reviewed=new Set(report.problems.filter(m=>m.side===side).map(m=>m.nodeId));
  moments.append(node('h3',sideName(side)+' · '+t('关键时刻','Key moments')));
  if(!moves.length){moments.append(node('p',t('没有符合条件的着法。','No moves met the rule.'),'report-note'));continue;}
  const grid=table([t('手数','Move'),t('落点','Played at'),t('目数损失','Point loss'),t('胜率损失','Win loss'),t('后续复盘','Follow-up review')],moves.map(m=>[m.move,m.played,number(m.pointLoss),Number.isFinite(m.winrateLoss)?number(m.winrateLoss)+t(' 个百分点',' pp'):'—',reviewed.has(m.nodeId)?t('后文棋盘详解','Detailed board review'):t('棋局回放','Game replay')]));
  for(const [index,row] of [...grid.tBodies[0].rows].entries()){
   const m=moves[index],link=node('a',String(m.move));row.className='report-key-move'+(reviewed.has(m.nodeId)?' report-key-reviewed':'');link.href='https://weiqi.dliu.com/game/'+id+'?move='+m.nodeId;row.cells[0].replaceChildren(link);
   for(const [cell,key,badge] of [[2,'blackLead',leadBadge],[3,'blackWinrate',winBadge]]){const before=m.bestEvaluation?.[key],after=m.playedEvaluation?.[key];if(Number.isFinite(before)&&Number.isFinite(after))row.cells[cell].append(sideChange(badge(before),badge(after)));}
   if(reviewed.has(m.nodeId)){const detail=node('a',t('后文棋盘详解','Detailed board review'));detail.dataset.reviewMove=String(m.move);detail.dataset.reviewSide=side;row.cells[4].replaceChildren(detail);}
  }
  moments.append(grid);
 }
 if(['B','W'].some(side=>report.keyMoves[side].length))moments.append(node('p',t('方框为落子前 → 落子后：黑底是黑方领先的目数或胜率，白底是白方的。','Boxes show before → after the move: a black box is Black\'s lead or win chance, a white box is White\'s.'),'report-note'));
}
function addGameRecord(sheet){
 const record=fullGameRecord(report.overview,report.reviews);if(!record)return;
 const page=sheet(t('总谱（共 '+report.game.moves+' 手）','Full game record ('+report.game.moves+' moves)')),f=node('figure',undefined,'report-board report-full-record'),svg=boardDiagram(record.board,{labels:record.labels});
 svg.setAttribute('aria-label',t('终局棋盘，棋子上标注手数','Final board with move numbers'));f.append(svg);page.append(f);
 if(!record.hidden.length)return;
 const list=node('p',undefined,'report-record-hidden');
 for(const m of record.hidden){const item=node('span');item.append(node('b',String(m.move),'report-record-stone report-record-stone-'+m.side),document.createTextNode(' = '+(m.at==='pass'?t('停一手','Pass'):m.at)));list.append(item);}
 page.append(node('p',t('不在终局棋盘上的着法（被提或停一手）：','Moves not on the final board (captured or passes):'),'report-note'),list);
}
const metadata=entries=>{const grid=node('dl',undefined,'report-cover-data');for(const [label,value,wide] of entries){const entry=node('div',undefined,wide?'report-cover-data-wide':undefined),detail=node('dd');if(value instanceof Node)detail.append(value);else detail.textContent=value||'—';entry.append(node('dt',label),detail);grid.append(entry);}return grid;};
const versionValue=()=>t('第 '+REPORT_VERSION.number+' 版 · 生成方式更新于 '+REPORT_VERSION.date,'Version '+REPORT_VERSION.number+' · method updated '+REPORT_VERSION.date);
const calendarDate=value=>new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
function addSummary(sheet){
 const page=sheet(t('对局总结','Game summary')),players=report.players,names=report.game.players;anchors.summary=page;
 const firstChoice=side=>players[side].ratedMoves?100*(players[side].counts?.best||0)/players[side].ratedMoves:null,errors=side=>(players[side].counts?.mistake||0)+(players[side].counts?.blunder||0);
 const rows=[[t('AI 首选率','AI first-choice rate'),firstChoice,v=>Number.isFinite(v)?Math.round(v)+'%':'—',1],[t('平均每手损失（目）','Average loss per move (points)'),side=>players[side].meanPointLoss,v=>number(v,2),-1],[t('失误与严重失误（手）','Mistakes and blunders'),errors,String,-1]];
 const grid=table(['',...['B','W'].map(side=>sideName(side)+(names[side==='B'?'black':'white']?' · '+names[side==='B'?'black':'white']:''))],rows.map(([label,value,format])=>[label,format(value('B')),format(value('W'))]));
 rows.forEach(([,value,,better],index)=>{const [b,w]=['B','W'].map(value);if(!Number.isFinite(b)||!Number.isFinite(w)||b===w)return;grid.tBodies[0].rows[index].cells[(b-w)*better>0?1:2].classList.add('report-table-max');});
 const keyRow=node('tr');keyRow.append(node('td',t('关键时刻（后文详解）','Key moments (reviewed later)')));
 for(const side of ['B','W']){const cell=node('td'),moves=report.problems.filter(m=>m.side===side);if(!moves.length)cell.textContent='—';moves.forEach((m,i)=>{if(i)cell.append(document.createTextNode(t('、',', ')));const link=node('a',t('第 '+m.move+' 手','Move '+m.move));link.dataset.reviewMove=String(m.move);link.dataset.reviewSide=side;link.dataset.keepText='true';cell.append(link);});keyRow.append(cell);}
 const decided=decidedFrom(report.chart);
 page.append(node('p',decided?t('从第 '+decided.move+' 手起，'+sideName(decided.side)+'胜率一直不低于 90%，胜负已定。','From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher: the result was decided.'):t('终局时双方胜率都未达到 90%。','Neither side reached 90% by the end.')));
 grid.tBodies[0].append(keyRow);page.append(grid);
 page.append(node('p',t('粗体为表现更好的一方。关键时刻按重要性排序，点击可跳到棋盘详解。','Bold marks the better side. Key moments are in order of importance; select one to jump to its board review.'),'report-note'));
}
function addMovePages(sheet){
 const lines=[],reviews=[];anchors.lines=lines;anchors.reviews=reviews;
 for(const side of ['B','W'])for(const [index,m] of report.problems.filter(m=>m.side===side).slice(0,3).entries()){
  const quality=qualities()[m.quality]||t('未评定','Unrated');
  const answer=sheet(sideName(side)+' '+(index+1)+' · '+t('第 '+m.move+' 手','Move '+m.move));answer.dataset.side=m.side;answer.dataset.move=m.move;reviews.push(answer);
  answer.append(node('p',t('实战 ','Played ')+m.played+' · '+quality+' · '+t('损失 '+number(m.pointLoss)+' 目',number(m.pointLoss)+' points lost')+' · '+t('胜率损失 ','Win-chance loss: ')+number(m.winrateLoss)+t(' 个百分点',' percentage points'),'report-quality-'+m.quality));
  const sign=m.side==='B'?1:-1,win=v=>m.side==='B'?v:1-v,rows=[{label:t('AI 首选','AI best'),c:m.best},{label:t('实战','Played'),c:{move:m.played,...m.playedEvaluation,visits:m.playedCandidate?.visits}}];
  answer.append(table([t('选点','Choice'),t('坐标','Coordinate'),t('本方目差（目）','Point lead'),t('胜率','Win probability'),t('访问量','Visits')],rows.map(({label,c})=>[label,c.move,number(sign*c.blackLead),number(win(c.blackWinrate)*100)+'%',c.visits?.toLocaleString(locale())||'—'])));
  const pair=node('div',undefined,'diagram-pair'),numbers=line=>line?.moves.map((move,n)=>({index:move.index,side:move.side,label:String(n+1)})).filter(m=>m.index!==null)||[];
  const bestIndex=Number.isInteger(m.bestLine?.moves?.[0]?.index)?m.bestLine.moves[0].index:null,bestMark=bestIndex===null?[]:[{index:bestIndex,colour:markColours.best,kind:'best'}];
  pair.append(diagram(m.actualBoard,t('实战（红圈）与 AI 首选点（绿圈）','Played move (red) and AI choice (green)'),{marks:[...(m.playedIndex===null?[]:[{index:m.playedIndex,colour:markColours.played,kind:'played'}]),...bestMark]}));
  if(m.bestLine)pair.append(diagram(m.bestLine.board,t('AI 首选变化（绿圈为第 1 手）','AI best continuation (green = move 1)'),{labels:numbers(m.bestLine),marks:bestMark}));
  answer.append(pair);if(m.bestLine)lines.push(answer);
  if(m.bestLine?.truncated)answer.append(node('p',t('无法合法复现的变化已截断。','A continuation that could not be replayed legally has been truncated.'),'report-note'));
  const link=node('a',t('在棋局中复盘这一步','Review this move in the game'));link.href='/game/'+id+'?move='+m.nodeId;answer.append(link);
 }
}
const math=(tex,display)=>{const e=node(display?'div':'span',undefined,display?'report-math report-math-display':'report-math');e.innerHTML=texToMathML(tex,{display});return e;};
// Text with $…$ segments rendered as inline maths.
const rich=(text,cls='report-note')=>{const p=node('p',undefined,cls);text.split(/\$([^$]+)\$/).forEach((part,index)=>{if(index%2)p.append(math(part));else if(part)p.append(document.createTextNode(part));});return p;};
function methodCatalogue(){
 const a=anchors,visits=report.provenance?.visits?.toLocaleString(locale())||'—';
 return [
  {sheet:t('附录：计算方法（一）符号与损失','Appendix: calculation methods (1) — notation and losses'),items:[
   {title:t('符号','Notation'),at:[a.score,a.win,a.quality,a.loss,a.phase,a.moments,a.reviews],where:[
    ['i,\\ t',t('手数：第 i 手、第 t 手','move numbers')],
    ['c',t('一方：黑方 B 或白方 W','a side: Black (B) or White (W)')],
    ['s_i',t('第 i 手由黑方下时为 1，白方下时为 −1','1 if Black played move i, −1 if White did')],
    ['S_t,\\ P_t',t('第 t 手后局面的 AI 评估：黑方领先目数，黑方胜率（0 到 1）','AI estimate after move t: Black\'s lead in points and Black\'s win probability (0 to 1)')],
    ['S^*_i,\\ P^*_i',t('第 i 手前 AI 首选点的同样两项评估','the same two estimates for the AI first choice before move i')],
    ["S'_i,\\ P'_i",t('实战第 i 手的同样两项评估（见下文）','the same two estimates for the move actually played (see below)')],
    ['V',t('每个局面的访问量，本报告为 '+visits,'visits per position: '+visits+' in this report')],
    ['T',t('总手数','number of moves in the game')]]},
   {title:t('统计范围','What is counted'),at:[a.quality,a.loss,a.phase,a.moments],formula:['N_c = |M_c|'],notes:[t('$M_c$ 为 c 方已评定的着法。AI 没有给出评估的着法不计入，而不是按 0 计算。','$M_c$ is the set of rated moves by side c. Moves the AI could not rate are left out, not counted as 0.')]},
   {title:t('实战着法的评估','Values for the played move'),at:[a.loss,a.moments,a.reviews],formula:[t("(S'_i,\\ P'_i) = (S_i,\\ P_i) \\quad \\text{若}\\ v_i < \\max(2,\\ 0.03\\,v^*_i)","(S'_i,\\ P'_i) = (S_i,\\ P_i) \\quad \\text{if}\\ v_i < \\max(2,\\ 0.03\\,v^*_i)")],notes:[t("在第 i 手前的搜索中，AI 对实战着法访问 $v_i$ 次，对首选点访问 $v^*_i$ 次。访问足够时，$S'_i$、$P'_i$ 直接取这次搜索对实战着法的评估；访问太少时改用第 i 手后局面的评估，这类数值为估计值。","In the search before move i, the AI visited the played move $v_i$ times and its first choice $v^*_i$ times. With enough visits, $S'_i$ and $P'_i$ come straight from that search. With too few, the report uses the evaluation of the position after move i instead; these values are estimates.")]},
   {title:t('目数损失与胜率损失','Point loss and win-chance loss'),at:[a.loss,a.phase,a.moments,a.reviews],formula:["L_i = \\max(0,\\ s_i(S^*_i - S'_i))","W_i = \\max(0,\\ 100\\,s_i(P^*_i - P'_i))"],notes:[t('$W_i$ 以百分点计。实战着法与 AI 首选点相同时，$L_i = W_i = 0$。','$W_i$ is in percentage points. If the played move is the AI first choice, $L_i = W_i = 0$.')]},
   {title:t('着法质量','Move quality'),at:[a.summary,a.quality],where:[
    ['L_i \\le 0.5',qualityName('good')],['0.5 < L_i \\le 2',qualityName('inaccuracy')],['2 < L_i \\le 5',qualityName('mistake')],['L_i > 5',qualityName('blunder')]],
    notes:[t('与 AI 首选点相同的着法单独归为“AI 首选”。各类占比为 $100\\,n_k / N_c$，$n_k$ 为该类手数。','Moves that match the AI first choice form their own group, "AI first choice". Each group\'s share is $100\\,n_k / N_c$, where $n_k$ is the number of moves in the group.')]}]},
  {sheet:t('附录：计算方法（二）统计与走势','Appendix: calculation methods (2) — statistics and trends'),items:[
   {title:t('平均值与分位数','Average and quantiles'),at:[a.summary,a.loss],formula:['\\bar L_c = \\frac{1}{N_c} \\sum_{i \\in M_c} L_i','Q_q = x_j + r(x_{j+1} - x_j), \\quad h = q(N_c - 1) = j + r'],notes:[t('把 c 方的损失从小到大排成 $x_0 \\le x_1 \\le \\ldots \\le x_{N_c - 1}$；$j$ 为整数，$0 \\le r < 1$。“一半着法不超过”取 $q = 0.5$（中位数），“九成着法不超过”取 $q = 0.9$。','Sort side c\'s losses as $x_0 \\le x_1 \\le \\ldots \\le x_{N_c - 1}$; $j$ is a whole number and $0 \\le r < 1$. "Half of moves ≤" uses $q = 0.5$ (the median); "90% of moves ≤" uses $q = 0.9$.')]},
   {title:t('最大五手的损失','Five biggest losses'),at:[a.loss],formula:['T_c = \\sum_{i \\in M_c} L_i, \\quad T^5_c = \\sum_{k=1}^{\\min(5,\\ N_c)} L_{(k)}',t('\\text{占比} = 100\\,T^5_c / T_c','\\text{share} = 100\\,T^5_c / T_c')],notes:[t('$L_{(1)} \\ge L_{(2)} \\ge \\ldots$ 为 c 方的损失从大到小排列。','$L_{(1)} \\ge L_{(2)} \\ge \\ldots$ are side c\'s losses from largest to smallest.')]},
   {title:t('对局阶段','Game phases'),at:[a.score,a.win,a.phase],formula:['A \\in \\{[1, 60],\\ [61, 150],\\ [151, T]\\}, \\quad M_{c,A} = \\{i \\in M_c : i \\in A\\}','\\bar L_{c,A} = \\frac{1}{|M_{c,A}|} \\sum_{i \\in M_{c,A}} L_i, \\quad E_{c,A} = |\\{i \\in M_{c,A} : L_i > 2\\}|'],notes:[t('$A$ 依次为开局、中盘和收官。$E_{c,A}$ 为失误次数（含严重失误）；括号中的比例为 $100\\,|M_{c,A}|\\,\\bar L_{c,A} / T_c$。','$A$ is the opening, middle game or endgame. $E_{c,A}$ counts mistakes, including blunders; the bracketed share is $100\\,|M_{c,A}|\\,\\bar L_{c,A} / T_c$.')]},
   {title:t('目差走势','Point-advantage chart'),at:[a.score],formula:[t('y_t = S_t, \\quad a_t = B \\ \\text{若}\\ S_t > 1, \\quad a_t = W \\ \\text{若}\\ S_t < -1','y_t = S_t, \\quad a_t = B \\ \\text{if}\\ S_t > 1, \\quad a_t = W \\ \\text{if}\\ S_t < -1'),'t_A = \\argmax_{t \\in A} |S_t|'],notes:[t('$|S_t| \\le 1$ 时不计领先方。按顺序比较有领先方的 $a_t$，与上一个不同就记一次领先方变化。$t_A$ 为阶段 $A$ 中领先最多的一手。','When $|S_t| \\le 1$ there is no leader. Going through the moves in order, each $a_t$ that differs from the previous leader counts as one change. $t_A$ is the move with the biggest lead in phase $A$.')]},
   {title:t('胜率走势','Win-chance chart'),at:[a.win],formula:['y_t = 100\\,P_t','n_B = |\\{t \\in A : P_t > 0.5\\}|, \\quad n_W = |\\{t \\in A : P_t < 0.5\\}|',t('\\text{占比} = 100\\,\\max(n_B,\\ n_W) / |A|','\\text{share} = 100\\,\\max(n_B,\\ n_W) / |A|')],notes:[t('$n_B$ 和 $n_W$ 中较大的一方即该阶段胜算更高的一方；$|A|$ 为该阶段有评估的局面数。','The side with the larger of $n_B$ and $n_W$ is favoured in that phase; $|A|$ is the number of positions in the phase with an evaluation.')]}]},
  {sheet:t('附录：计算方法（三）关键时刻','Appendix: calculation methods (3) — key moments'),items:[
   {title:t('胜负已定的一手','The decided move'),at:[a.summary,a.win,a.moments],formula:[t('w_t = P_t \\ \\text{（黑方胜）}, \\quad w_t = 1 - P_t \\ \\text{（白方胜）}','w_t = P_t \\ \\text{(Black wins)}, \\quad w_t = 1 - P_t \\ \\text{(White wins)}'),'D = \\min\\{t : w_u \\ge 0.9 \\ \\forall u \\ge t\\}'],notes:[t('终局时 $w_T \\ge 0.9$ 的一方为胜方；双方都不到 0.9 时没有 $D$。从 $D$ 起胜方胜率一直不低于 90%，胜负已定。','The winner is the side with $w_T \\ge 0.9$ at the end; if neither side reaches 0.9, there is no $D$. From $D$ on, the winner stays at 90% or higher, so the result is decided.')]},
   {title:t('关键时刻：每方最差的五手','Key moments: each side\'s worst five moves'),at:[a.summary,a.momentsPage,a.reviews],formula:['K_c = \\{i \\in M_c : L_i > 2,\\ W_i \\ge 5,\\ i \\le D\\}','r_i = L_i \\cdot W_i'],notes:[
    t('把 $K_c$ 按 $r_i$ 从大到小排列；$r_i$ 相同时 $L_i$ 大者在前，再相同时手数小者在前。取前 $\\min(5,\\ |K_c|)$ 手，其中前 3 手在后文有棋盘详解。','Sort $K_c$ by $r_i$ from largest to smallest; ties go to the larger $L_i$, then to the earlier move. Take the first $\\min(5,\\ |K_c|)$ moves; the first 3 get board reviews.'),
    t('只损失一两目却让胜率大幅变化的着法常见于细棋，所以 $L_i$ 和 $W_i$ 都要足够大；$D$ 之后的损失不改变结果，所以不计。没有 $D$ 时去掉条件 $i \\le D$。','In close games a loss of a point or two can swing win chances a lot, so both $L_i$ and $W_i$ must be large. Losses after $D$ do not change the result, so they are left out. With no $D$, the condition $i \\le D$ is dropped.'),
    t('若 $D \\le 60$，胜率几乎不变，改用 $K_c = \\{i \\in M_c : L_i > 2\\}$，按 $L_i$ 从大到小排列。','If $D \\le 60$, win chances barely move, so $K_c = \\{i \\in M_c : L_i > 2\\}$ is used instead, sorted by $L_i$ from largest to smallest.')]},
   {title:t('逐手损失图','Loss-by-move chart'),at:[a.moments],formula:['y_i = L_i'],notes:[t('每手一条竖线，高度为 $L_i$；虚线标出 $D$。','Each move is a vertical line of height $L_i$; the dashed line marks $D$.')]},
   {title:t('AI 推荐变化','AI suggested continuation'),at:[a.lines],notes:[t('棋盘详解的右图是 AI 推荐的后续下法，不是实战棋谱。数字是推荐顺序，1 为 AI 首选点；最多显示 12 手，停一手不标出。','On each board review, the right-hand board shows the moves the AI suggests next, not the game record. Numbers give the order, with 1 at the AI choice. Up to 12 moves are shown; passes are not marked.')]}]}
 ];
}
function addMethods(sheet){
 const links=[];
 for(const group of methodCatalogue()){
  const page=sheet(group.sheet);
  for(const m of group.items){
   const item=node('section',undefined,'report-method'),heading=node('h3',undefined,'report-method-title'),pages=node('span',undefined,'report-method-page');
   heading.append(node('span',m.title),pages);item.append(heading);links.push({element:pages,at:m.at.flat().filter(Boolean)});
   for(const formula of m.formula||[])item.append(math(formula,true));
   if(m.where){const list=node('dl',undefined,'report-math-where');for(const [tex,text] of m.where){const row=node('div');const term=node('dt');term.append(math(tex));row.append(term,node('dd',text));list.append(row);}item.append(list);}
   for(const note of m.notes||[])item.append(rich(note));
   page.append(item);
  }
 }
 return links;
}
const durationText=seconds=>{
 if(!Number.isFinite(seconds)||seconds<0)return '—';
 const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return [h?t(h+' 小时',h+' h'):'',h||m?t(m+' 分',m+' min'):'',t(s+' 秒',s+' s')].filter(Boolean).join(' ');
};
const outLink=(text,href)=>{if(!text)return '';if(!href)return text;const a=node('a',text);a.href=href;return a;};
function addDetails(sheet){
 const p=report.provenance||{},c=p.compute||{},cfg=p.configuration||{},info=sheet(t('附录：分析信息','Appendix: analysis details'));info.classList.add('report-details-page');
 // Whole seconds as shown, so the durations match the times listed.
 const second=value=>{const ms=Date.parse(value);return Number.isFinite(ms)?Math.floor(ms/1000):null;},span=(a,b)=>second(a)!==null&&second(b)!==null?second(b)-second(a):null;
 const time=value=>value?timestamp(value):'—',count=value=>Number.isFinite(value)?value.toLocaleString(locale()):'';
 const release=/^KataGo v(\d+\.\d+\.\d+)$/.exec(p.engine||'')?.[1];
 const section=(title,entries,note)=>{info.append(node('h3',title,'report-details-heading'),metadata(entries));if(note)info.append(node('p',note,'report-note'));};
 section(t('时间','Timing'),[[t('加入分析队列','Queued for analysis'),time(p.queuedAt)],[t('排队与启动','Queue and start-up'),durationText(span(p.queuedAt,p.startedAt))],[t('AI 分析开始','AI analysis started'),time(p.startedAt)],[t('AI 分析用时','AI analysis time'),durationText(span(p.startedAt,p.completedAt))],[t('AI 分析完成','AI analysis finished'),time(p.completedAt)],[t('总用时','Total time'),durationText(span(p.queuedAt,p.completedAt))]]);
 section(t('引擎与模型','Engine and model'),[[t('引擎','Engine'),outLink(p.engine,release?'https://github.com/lightvector/KataGo/releases/tag/v'+release:'')],[t('计算资源','Compute'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · ')],[t('模型','Model'),outLink(p.model,/^https:\/\//.test(p.modelUrl||'')?p.modelUrl:''),true],[t('模型 SHA-256','Model SHA-256'),p.modelSha256,true]]);
 section(t('搜索设置','Search settings'),[[t('规则','Rules'),rulesName(p.rules)],[t('贴目','Komi'),Number.isFinite(p.komi)?String(p.komi):''],[t('每个局面的访问量','Visits per position'),count(p.visits)],[t('同时分析的局面数','Positions analysed at once'),count(cfg.analysisThreads)],[t('每个局面的搜索线程','Search threads per position'),count(cfg.searchThreads)],[t('最大批量','Maximum batch size'),count(cfg.maxBatchSize)],[t('推荐变化长度','Suggested line length'),Number.isFinite(cfg.analysisPVLen)?t(cfg.analysisPVLen+' 手（连同首选点最多 '+(cfg.analysisPVLen+1)+' 手）',cfg.analysisPVLen+' moves (up to '+(cfg.analysisPVLen+1)+' with the first choice)'):'']],t('对应的 KataGo 设置依次为 numAnalysisThreads、numSearchThreadsPerAnalysisThread、nnMaxBatchSize 和 analysisPVLen。','The matching KataGo settings are numAnalysisThreads, numSearchThreadsPerAnalysisThread, nnMaxBatchSize and analysisPVLen.'));
 section(t('报告','Report'),[[t('报告生成时间','Report prepared'),time(report.generatedAt)],[t('报告语言','Report language'),t('中文','English')],[t('报告版本','Report version'),versionValue(),true]],t('版本号和日期表示报告生成方式（内容和计算方法）最近一次更新，不是本报告的生成时间。','The version and date show when the way reports are made (content and calculation methods) last changed, not when this report was made.'));
}
function renderLanguage(value){
 reportLanguage=value;anchors={};
 const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.lang=value==='zh'?'zh-CN':'en';e.dataset.reportLanguage=value;e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),rules=rulesName(game.rules);

 addSummary(sheet);
 addGameRecord(sheet);
 addStatistics(sheet);
 addMovePages(sheet);
 const methodLinks=addMethods(sheet);
 addDetails(sheet);
 const plan=reportPagination(sheets.map(s=>s.querySelector('h2').textContent));
 for(const [index,s] of sheets.entries()){s.id=plan.contents[index].target;s.dataset.reportTitle=plan.contents[index].title;s.prepend(node('p','DL Weiqi','report-running-header'));}
 for(const link of fragment.querySelectorAll('[data-review-move]')){
  const target=sheets.find(s=>s.dataset.move===link.dataset.reviewMove&&s.dataset.side===link.dataset.reviewSide),page=sheets.indexOf(target)+3;
  if(target){link.href=location.pathname+location.search+'#'+target.id;link.dataset.reportPage=String(page);if(!link.dataset.keepText)link.textContent=t('棋盘详解 · 第 '+page+' 页','Board review · p. '+page);}
 }
 const front=type=>{const page=node('section',undefined,'report-sheet report-'+type);page.lang=value==='zh'?'zh-CN':'en';page.dataset.reportLanguage=value;return page;};
 const cover=front('cover');cover.id='report-page-1';cover.dataset.reportTitle=t('封面','Title page');
 cover.append(node('p','DL Weiqi','report-cover-brand'),node('p',t('深度分析 · 棋局复盘','DEEP ANALYSIS / GAME REVIEW'),'report-cover-kicker'),node('h1',t('围棋 AI 复盘报告','Go AI Review Report')),node('p',report.name,'report-cover-name'));
 const playerCards=node('div',undefined,'report-cover-players');
 for(const side of ['B','W']){const card=node('div',undefined,'report-cover-player report-cover-player-'+side);card.append(node('span',sideName(side),'report-cover-side'),node('strong',game.players[side==='B'?'black':'white']||'—'));playerCards.append(card);}
 cover.append(playerCards,node('p',result?t(result.zh,result.en):game.result||t('结果未记录','Result not recorded'),'report-cover-result'));
 const gameAddress='https://weiqi.dliu.com/game/'+id,gameLinkBox=node('p',undefined,'report-cover-link'),coverLink=node('a',gameAddress);coverLink.href=gameAddress;gameLinkBox.append(node('span',t('在线棋局','ONLINE GAME')),coverLink);cover.append(gameLinkBox);
 const gameDetails=metadata([[t('棋局 ID','Game ID'),id],[t('棋局日期','Game date'),game.date],[t('地点','Location'),game.venue],[t('用时','Time control'),timeControlSummary(game.timeControl,t)],[t('规则','Rules'),rules],[t('贴目','Komi'),String(game.komi)],[t('棋盘','Board'),'19 × 19'],[t('实战手数','Recorded moves'),String(game.moves)],[t('引擎','Engine'),report.provenance?.engine],[t('每个局面的访问量','Visits per position'),report.provenance?.visits?.toLocaleString(locale())],[t('报告日期','Report date'),calendarDate(report.generatedAt)]]);gameDetails.classList.add('report-cover-game-details');cover.append(gameDetails);
 const credit=node('p',undefined,'report-cover-credit');credit.append(document.createTextNode(t('由 DL 围棋制作 · ','Produced by DL Weiqi · ')));const creditLink=node('a','dliu.com');creditLink.href='https://dliu.com';credit.append(creditLink);cover.append(credit);
 const contents=front('contents');contents.id='report-page-2';contents.dataset.reportTitle=t('目录','Table of contents');
 contents.append(node('p','DL Weiqi','report-running-header'),node('h2',t('目录','Table of contents')),node('p',t('依次为对局总结、总谱、全局统计、关键时刻详解和附录。点击条目即可跳转。','The summary, full game record and statistics come first, then the key-moment reviews and appendices. Select an entry to jump to its page.'),'report-note'));
 const list=node('ol',undefined,'report-contents-list');
 for(const entry of plan.contents){const item=node('li'),link=node('a');link.href=location.pathname+location.search+'#'+entry.target;link.dataset.reportPage=String(entry.page);link.append(node('span',entry.title,'report-contents-title'),node('span',undefined,'report-contents-leader'),node('span',String(entry.page),'report-contents-page'));item.append(link);list.append(item);}
 contents.append(list);fragment.prepend(cover,contents);sheets.unshift(cover,contents);
 for(const [index,s] of sheets.entries()){s.dataset.reportPage=String(index+1);const footer=node('footer',undefined,'report-footer'),gameLink=node('a','weiqi.dliu.com/game/'+id);gameLink.href='https://weiqi.dliu.com/game/'+id;footer.append(gameLink,node('span',t('中文','English')+' · '+(index+1)+' / '+plan.pageCount));s.append(footer);}
 for(const {element,at} of methodLinks){
  const numbers=[...new Set(at.map(e=>Number(e.closest('.report-sheet')?.dataset.reportPage)).filter(Number.isFinite))].sort((a,b)=>a-b),runs=[];
  for(const n of numbers){const last=runs.at(-1);if(last&&n===last[1]+1)last[1]=n;else runs.push([n,n]);}
  if(!runs.length){element.remove();continue;}
  element.append(document.createTextNode(t('见第 ',numbers.length>1?'See pp. ':'See p. ')));
  runs.forEach(([first,last],index)=>{if(index)element.append(document.createTextNode(t('、',', ')));const link=node('a',first===last?String(first):first+'–'+last);link.href=location.pathname+location.search+'#'+sheets[first-1].id;link.dataset.reportPage=String(first);element.append(link);});
  if(reportLanguage==='zh')element.append(document.createTextNode(' 页'));
 }
 return fragment;
}
function render(){
 document.title=t('AI 棋局报告','AI game report')+' · DL';document.documentElement.lang=reportLanguage==='zh'?'zh-CN':'en';
 $('back-record').textContent=t('返回棋局','Return to game');$('back-record').href='/game/'+id;
 $('save-report').textContent=t('保存 PDF','Save PDF');
 for(const value of ['en','zh'])$(`report-${value}`).setAttribute('aria-pressed',String(reportLanguage===value));
 if(!report)return;
 $('report-content').replaceChildren(renderLanguage(reportLanguage));$('report-status').textContent='';
}
for(const value of ['en','zh'])$(`report-${value}`).onclick=()=>{reportLanguage=value;const url=new URL(location.href);url.searchParams.set('lang',value);history.replaceState(null,'',url);render();};

render();
try{if(!id)throw Error('Missing game ID.');report=selectReportHighlights(await libraryRequest('/api/library/'+encodeURIComponent(id)+'/report'));render();}catch(e){$('report-status').textContent=e.message;}
