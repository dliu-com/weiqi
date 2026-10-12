import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
import {reportPagination} from './report-document.js';
import {selectReportHighlights} from './report-highlights.js';
import {fullGameRecord} from './report-game-record.js';
import {comparisonChart,compositionChart,qualityLegend,reportChartColours,niceTicks} from './report-stat-charts.js';
import {REPORT_VERSION} from './report-version.js';
import {gamePhases,phaseLosses,favouredByPhase,decidedFrom,leadChanges,phaseLeads,topLossShare} from './report-insights.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/game\/([^/]+)\/report\/?$/)?.[1]||new URLSearchParams(location.search).get('game');
let report=null,reportLanguage=new URLSearchParams(location.search).get('lang')==='zh'?'zh':'en';
// The report font draws curly quotes full-width, so English text uses straight quotes.
const plain=text=>typeof text==='string'?text.replace(/[‘’]/g,"'").replace(/[“”]/g,'"'):text;
const t=(zh,en)=>reportLanguage==='zh'?zh:plain(en);
const markColours={played:'#c8372d',best:'#17806a'};
let methods=[];
const locale=()=>reportLanguage==='zh'?'zh-CN':'en-GB';
const timestamp=value=>{const parts=new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'medium'}).format(new Date(value)),zone=new Intl.DateTimeFormat(locale(),{timeZoneName:'longOffset'}).formatToParts(new Date(value)).find(p=>p.type==='timeZoneName')?.value;return parts+' · '+zone+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
const qualities=()=>({inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')});
function table(headers,rows){const e=node('table',undefined,'report-table'),head=node('thead'),h=node('tr');for(const text of headers)h.append(node('th',text));head.append(h);e.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const text of cells)row.append(node('td',text));body.append(row);}e.append(body);return e;}
function diagram(board,caption,{labels=[],marks=[]}={}){const f=node('figure',undefined,'report-board');const svg=boardDiagram(board,{labels,marks});svg.setAttribute('aria-label',t('十九路围棋图','19 × 19 Go diagram'));f.append(svg,node('figcaption',caption));return f;}
const sideName=side=>side==='B'?t('黑方','Black'):t('白方','White');
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
  ['目差：正为黑方领先，负为白方领先','Point advantage: positive Black, negative White','穿过零线表示预计领先方改变；圆点标出后文详解的关键时刻。','Crossing zero changes the estimated leader. Dots mark key moments reviewed on later board pages.']
 ];
 const entry=guides.find(g=>g[0]===title||g[1]===title);return entry?t(entry[2],entry[3]):'';
}
function statisticGraph(title,visual,formula,zh,en,insight){
 const figure=node('figure',undefined,'report-stat-card'),caption=node('figcaption',undefined,'report-graph-maths');
 figure.append(node('h3',title),visual);if(insight)caption.append(node('h4',t('AI 分析','AI analysis'),'report-insight-heading'),insight);const reading=graphTakeaway(title);if(reading)caption.append(node('p',reading,'report-graph-reading'));if(caption.childNodes.length)figure.append(caption);
 // Formulas and definitions are collected for the calculation appendix.
 methods.push({title,formula,note:t(zh,en)});return figure;
}
function addStatistics(sheet){
 const keys=['best','good','inaccuracy','mistake','blunder'],names={best:t('AI 首选','AI first choice'),good:t('好棋','Good'),...qualities()},sides={B:sideName('B'),W:sideName('W')};
 const rows=definitions=>definitions.map(([key,zh,en])=>({key,label:t(zh,en),values:['B','W'].map(side=>report.players[side][key])}));
 const compare=(title,definitions,options={})=>comparisonChart(title,rows(definitions),{names:sides,axisLabel:t('损失目数 · 越低越好 →','Points lost · lower is better →'),...options});
 const graph=(parent,title,svg,formula,zh,en,insight)=>parent.append(statisticGraph(title,svg,formula,zh,en,insight));
 const moves=report.game.moves,phases=phaseLosses(report.reviews,moves),phaseName=key=>({opening:t('开局','opening'),middle:t('中盘','middle game'),endgame:t('收官','endgame')})[key],capital=text=>text[0].toUpperCase()+text.slice(1);
 const leadText=v=>Math.abs(v)<.05?t('持平','even'):sideName(v>0?'B':'W')+' +'+number(Math.abs(v)),percent=v=>Math.round(v)+'%',join=parts=>parts.join(t('；','; '));
 const phaseLabel=p=>capital(phaseName(p.key))+' '+p.from+'–'+p.to;
 const analysis=(rows,after)=>{const e=node('div',undefined,'report-graph-insight');if(rows)e.append(rows);if(after)e.append(node('p',after));return e;};
 const scoreInsight=()=>{
  const ends=phaseLeads(report.chart,moves),lead=leadChanges(report.chart);
  const second=!lead.leader?t('双方领先均未超过 1 目。','Neither side led by more than 1 point.'):!lead.changes?t('只有'+sideName(lead.leader)+'曾领先超过 1 目，从第 '+lead.since+' 手开始。','Only '+sideName(lead.leader)+' led by more than 1 point, first at move '+lead.since+'.'):t('领先超过 1 目的一方共变化 '+lead.changes+' 次；最后一次在第 '+lead.since+' 手，变为'+sideName(lead.leader)+'。','The side leading by more than 1 point changed '+lead.changes+(lead.changes===1?' time':' times')+'; the last change was at move '+lead.since+', to '+sideName(lead.leader)+'.');
  return analysis(ends.length?table([t('阶段','Phase'),t('阶段结束时','At end of phase'),t('本阶段目差变化','Change in phase'),t('本阶段最大领先','Biggest lead in phase')],ends.map(p=>[phaseLabel(p),leadText(p.end),p.change===null?'—':leadText(p.change),leadText(p.peak.lead)+(Math.abs(p.peak.lead)<.05?'':t('（第 '+p.peak.move+' 手）',' (move '+p.peak.move+')'))])):null,second);
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
  return analysis(rows,t('失误包括严重失误（单手损失超过 2 目）。括号内为占该方总损失的比例；粗体为该方损失最多的阶段。','Mistakes include blunders (over 2 points each). Brackets show the share of all points that player lost; bold marks the phase where each player lost most.'));
 };
 const context=sheet(t('全局目差走势：谁领先？','Game-wide point advantage'));
 graph(context,t('目差：正为黑方领先，负为白方领先','Point advantage: positive Black, negative White'),contextChart('score'),'Displayed point advantage = S(position), from Black\'s perspective',
 'S 为 AI 预计目差：正数表示黑方领先，负数表示白方领先；单位为目。',
 'S is the AI\'s estimated Black lead, not the final scored result.',scoreInsight());
 const winning=sheet(t('全局走势：获胜机会怎样变化？','Game-wide winning chances'));
 graph(winning,t('黑方胜率','Black win probability'),contextChart('win'),'Displayed Black win % = 100 × P(position)',
 'P 为 AI 预计黑方获胜概率；相邻局面的变化不等于单手损失。',
 'P is the estimated Black win probability. Changes between positions are not the loss of one move.',winInsight());
 const quality=sheet(t('着法质量：一眼看清双方表现','Move quality: compare the whole game'));
 graph(quality,t('各类着法占比','Share of each move quality'),compositionChart(t('着法质量占比','Move-quality composition'),['B','W','all'].map(side=>({label:side==='all'?t('全局','Whole game'):sideName(side),counts:(side==='all'?report.overall:report.players[side]).counts})),{keys,names,emptyLabel:t('无已评定着法','No rated moves')}),'Share = 100 × category count / N',
 'N 为已评定着法数；首选按坐标匹配，其余按损失目数分类（L 的单位为目）。全局合并双方着法。',
 'N counts rated moves. AI first choice matches the coordinate; other categories use point loss. Whole game pools both sides.',analysis(table([t('着法类别','Move quality'),sideName('B'),sideName('W')],keys.map(key=>[names[key],report.players.B.counts[key],report.players.W.counts[key]]))));
 quality.querySelector('.report-stat-card').insertBefore(qualityLegend(names,{best:t('坐标匹配','coordinate match'),good:'≤ 0.5',inaccuracy:'0.5 < L ≤ 2',mistake:'2 < L ≤ 5',blunder:'> 5'}),quality.querySelector('.report-graph-maths'));
 methods.push({title:t('统计范围','What is counted'),formula:'',note:t('统计包含所有已评定着法。没有评估的着法不计为零损失；估计评估会在具体着法页标明。','Statistics include every rated move. Missing evaluations are left out, not treated as zero loss; estimates are labelled on detailed move pages.')});
 const loss=sheet(t('目数损失：典型表现与大失误','Point loss: typical play and large errors'));
 graph(loss,t('典型损失与较大失误','Typical loss and bigger errors'),compare(t('目数损失分位比较','Point-loss comparison'),[['meanPointLoss','平均损失','Average'],['medianPointLoss','一半着法不超过','Half of moves ≤'],['p90PointLoss','九成着法不超过','90% of moves ≤']],{digits:2}),'L_i = max(0, s_i * (S_best - S_played)); mean = sum(L_i) / N\nh = (N - 1) * q; Q(q) = x[floor(h)] + (h - floor(h)) * (x[ceil(h)] - x[floor(h)])',
 'S 为黑方视角的目差（单位：目）；黑 s=+1，白 s=−1；x 为排序后的损失目数，q=0.5 或 0.9。首选损失为 0，估计值取下一实战局面。',
 'S is Black\'s lead; s=+1 for Black, −1 for White. x sorts losses; q=0.5 or 0.9. First-choice loss is zero; estimates use the following position.',lossInsight());
 const phaseRanges=gamePhases(Infinity).map(p=>t(phaseName(p.key)+' '+p.from+(p.to===Infinity?' 手起':'–'+p.to+' 手'),phaseName(p.key)+' '+p.from+(p.to===Infinity?' onward':'–'+p.to))).join(t('，',', '));
 const stages=sheet(t('不同阶段的损失','Losses by game phase'));
 graph(stages,t('各阶段的平均目数损失','Average point loss in each phase'),comparisonChart(t('阶段平均损失','Mean loss by phase'),phases.filter(p=>p.B.moves||p.W.moves).map(p=>({key:'meanPointLoss-'+p.key,label:capital(phaseName(p.key))+' '+p.from+'–'+p.to,values:[p.B.meanPointLoss,p.W.meanPointLoss]})),{names:sides,digits:2,axisLabel:t('平均损失目数 · 越低越好 →','Average points lost · lower is better →')}),'Phase mean = sum(L_i in phase) / rated moves in phase',
 '按手数划分阶段：'+phaseRanges+'；包括首选与好棋。',
 'Phases by move number: '+phaseRanges+'. All rated moves are included, even first choices and good moves.',phaseInsight());
 const scope=report.keyScope||{mode:'open',decided:null},decided=scope.decided;
 const moments=sheet(t('关键时刻：值得复盘的失误','Key moments to review')),isRated=m=>keys.includes(m.quality)&&Number.isFinite(m.pointLoss),series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isRated(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 graph(moments,t('每手损失在哪里发生？','Where did each move lose points?'),reportPlot(t('逐手目数损失','Point loss by move'),series,{yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y))),decided:scope.mode==='decided'?decided:null}),'Each stem = L_i = max(0, s_i * (S_best - S_played))',
 '损失比较同一局面的首选与实战；无评估的着法不计入。',
 'Loss compares best and played choices from the same position. Unrated moves are excluded.');
 for(const side of ['B','W']){
  const moves=report.keyMoves[side],reviewed=new Set(report.problems.filter(m=>m.side===side).map(m=>m.nodeId));
  moments.append(node('h3',sideName(side)+' · '+t('关键时刻','Key moments')));
  if(!moves.length){moments.append(node('p',t('没有符合条件的着法。','No moves met the rule.'),'report-note'));continue;}
  const grid=table([t('手数','Move'),t('实战','Played'),t('目数损失（目）','Point loss'),t('胜率损失','Win loss'),t('后续复盘','Follow-up review')],moves.map(m=>[m.move,m.played,(m.estimated?'≈ ':'')+number(m.pointLoss),number(m.winrateLoss)+t(' 个百分点',' pp'),reviewed.has(m.nodeId)?t('后文棋盘详解','Detailed board review'):t('棋局回放','Game replay')]));
  for(const [index,row] of [...grid.tBodies[0].rows].entries()){
   const m=moves[index],link=node('a',String(m.move));row.className='report-key-move'+(reviewed.has(m.nodeId)?' report-key-reviewed':'');link.href='https://weiqi.dliu.com/game/'+id+'?move='+m.nodeId;row.cells[0].replaceChildren(link);
   if(reviewed.has(m.nodeId)){const detail=node('a',t('后文棋盘详解','Detailed board review'));detail.dataset.reviewMove=String(m.move);detail.dataset.reviewSide=side;row.cells[4].replaceChildren(detail);}
  }
  moments.append(grid);
 }
 const both=t('损失超过 2 目、且胜率下降至少 5 个百分点','lost over 2 points and at least 5 percentage points of win chance');
 const rule=scope.mode==='decided'?t('关键时刻是第 '+decided.move+' 手及之前'+both+'的着法；从第 '+decided.move+' 手起'+sideName(decided.side)+'胜率一直不低于 90%，胜负已定。按目数损失 × 胜率损失排序。','Key moments are moves up to move '+decided.move+' that '+both+'. From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher, so the result was decided. They are ranked by points × percentage points.')
  :scope.mode==='early'?t('从第 '+decided.move+' 手起'+sideName(decided.side)+'胜率一直不低于 90%，胜率几乎不变，因此关键时刻按目数损失排序（超过 2 目）。','From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher and win chances barely moved, so key moments are the largest point losses over 2 points.')
  :t('关键时刻是'+both+'的着法，按目数损失 × 胜率损失排序。','Key moments are moves that '+both+', ranked by points × percentage points.');
 moments.append(node('p',rule+t('每方最多五手，前三手在后文配有棋盘图；点击手数可回到棋局。“≈”表示采用落子后局面估计。',' Up to five per side are listed and the first three have board reviews later; select a move number to replay it. "≈" marks an estimate from the following position.'),'report-note'));
 methods.push({title:t('关键时刻','Key moments'),formula:'Key moment: L > 2 and W ≥ 5 and move ≤ D; rank by L × W',note:t('L 为目数损失，W 为胜率损失（百分点），D 为胜负已定的一手：从这一手起胜方胜率一直不低于 90%。只损失一两目却让胜率大幅变化的着法常见于细棋，不计入；D 之后损失再多也不改变结果。若 D 在开局（前 60 手），胜率几乎不变，改为只按 L 排序。','L is point loss, W is win-chance loss in percentage points and D is the decided move: from D on, the winner stayed at 90% or higher. Moves losing only a point or two can swing win chances a lot in close games, so they are left out; losses after D do not change the result. If D falls in the opening (first 60 moves), win chances barely move, so moves are ranked by L alone.')});
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
const metadata=entries=>{const grid=node('dl',undefined,'report-cover-data');for(const [label,value,wide] of entries){const entry=node('div',undefined,wide?'report-cover-data-wide':undefined);entry.append(node('dt',label),node('dd',value||'—'));grid.append(entry);}return grid;};
const versionText=()=>t('报告版本 ','Report version ')+REPORT_VERSION.number+' · '+REPORT_VERSION.date;
function addSummary(sheet){
 const page=sheet(t('对局总结','Game summary')),players=report.players,names=report.game.players;
 const firstChoice=side=>players[side].ratedMoves?100*(players[side].counts?.best||0)/players[side].ratedMoves:null,errors=side=>(players[side].counts?.mistake||0)+(players[side].counts?.blunder||0);
 const rows=[[t('AI 首选率','AI first-choice rate'),firstChoice,v=>Number.isFinite(v)?Math.round(v)+'%':'—',1],[t('平均每手损失（目）','Average loss per move (points)'),side=>players[side].meanPointLoss,v=>number(v,2),-1],[t('失误与严重失误（手）','Mistakes and blunders'),errors,String,-1]];
 const grid=table(['',...['B','W'].map(side=>sideName(side)+(names[side==='B'?'black':'white']?' · '+names[side==='B'?'black':'white']:''))],rows.map(([label,value,format])=>[label,format(value('B')),format(value('W'))]));
 rows.forEach(([,value,,better],index)=>{const [b,w]=['B','W'].map(value);if(!Number.isFinite(b)||!Number.isFinite(w)||b===w)return;grid.tBodies[0].rows[index].cells[(b-w)*better>0?1:2].classList.add('report-table-max');});
 const keyRow=node('tr');keyRow.append(node('td',t('关键时刻（后文详解）','Key moments (reviewed later)')));
 for(const side of ['B','W']){const cell=node('td'),moves=report.problems.filter(m=>m.side===side);if(!moves.length)cell.textContent='—';moves.forEach((m,i)=>{if(i)cell.append(document.createTextNode(t('、',', ')));const link=node('a',t('第 '+m.move+' 手','Move '+m.move));link.dataset.reviewMove=String(m.move);link.dataset.reviewSide=side;link.dataset.keepText='true';cell.append(link);});keyRow.append(cell);}
 grid.tBodies[0].append(keyRow);page.append(grid);
 page.append(node('p',t('粗体为表现更好的一方。关键时刻按重要性排序，点击可跳到棋盘详解。','Bold marks the better side. Key moments are in order of importance; select one to jump to its board review.'),'report-note'));
 const decided=decidedFrom(report.chart);
 page.append(node('p',decided?t('从第 '+decided.move+' 手起，'+sideName(decided.side)+'胜率一直不低于 90%，胜负已定。','From move '+decided.move+', '+sideName(decided.side)+' stayed at 90% or higher: the result was decided.'):t('终局时双方胜率都未达到 90%。','Neither side reached 90% by the end.')));
}
function addMovePages(sheet){
 for(const side of ['B','W'])for(const [index,m] of report.problems.filter(m=>m.side===side).slice(0,3).entries()){
  const quality=qualities()[m.quality]||t('未评定','Unrated');
  const answer=sheet(sideName(side)+' '+(index+1)+' · '+t('第 '+m.move+' 手','Move '+m.move)+' · '+quality+' · '+t('损失 '+number(m.pointLoss)+' 目',number(m.pointLoss)+' points lost'));answer.dataset.side=m.side;answer.dataset.move=m.move;
  answer.append(node('p',t('实战 ','Played ')+m.played+' · '+t('胜率损失 ','Win-chance loss: ')+number(m.winrateLoss)+t(' 个百分点',' percentage points'),'report-quality-'+m.quality));
  const sign=m.side==='B'?1:-1,win=v=>m.side==='B'?v:1-v,rows=[{label:t('AI 首选','AI best'),c:m.best},{label:t('实战','Played'),c:{move:m.played,...m.playedEvaluation,visits:m.playedCandidate?.visits}}];
  answer.append(table([t('选点','Choice'),t('坐标','Coordinate'),t('本方目差（目）','Point lead'),t('胜率','Win probability'),t('访问量','Visits')],rows.map(({label,c})=>[label,c.move,number(sign*c.blackLead),number(win(c.blackWinrate)*100)+'%',c.visits?.toLocaleString(locale())||'—'])));
  const pair=node('div',undefined,'diagram-pair'),numbers=line=>line?.moves.map((move,n)=>({index:move.index,side:move.side,label:String(n+1)})).filter(m=>m.index!==null)||[];
  const bestIndex=Number.isInteger(m.bestLine?.moves?.[0]?.index)?m.bestLine.moves[0].index:null,bestMark=bestIndex===null?[]:[{index:bestIndex,colour:markColours.best,kind:'best'}];
  pair.append(diagram(m.actualBoard,t('实战（红圈）与 AI 首选点（绿圈）','Played move (red) and AI choice (green)'),{marks:[...(m.playedIndex===null?[]:[{index:m.playedIndex,colour:markColours.played,kind:'played'}]),...bestMark]}));
  if(m.bestLine)pair.append(diagram(m.bestLine.board,t('AI 首选变化（绿圈为第 1 手）','AI best continuation (green = move 1)'),{labels:numbers(m.bestLine),marks:bestMark}));
  answer.append(pair);
  answer.append(node('p',t('右图数字从 AI 首选的第 1 手开始；停一手不标在棋盘上。最多显示 12 手，为引擎推荐变化，不是实际棋谱。','On the right, numbers start with the AI choice; passes have no label. Up to 12 moves are shown; they are engine suggestions, not the recorded game.'),'report-note'));
  if(m.estimated)answer.append(node('p',t('实战着法的搜索不足，其评估来自落子后的局面；数值为估计。','The played move had insufficient search; its evaluation comes from the following position and is estimated.'),'report-note'));
  if(m.bestLine?.truncated)answer.append(node('p',t('无法合法复现的变化已截断。','A continuation that could not be replayed legally has been truncated.'),'report-note'));
  const link=node('a',t('在棋局中复盘这一步','Review this move in the game'));link.href='/game/'+id+'?move='+m.nodeId;answer.append(link);
 }
}
function addAppendices(sheet){
 const page=sheet(t('附录：计算方法','Appendix: calculation methods'));
 for(const m of methods){const item=node('section',undefined,'report-method');item.append(node('h3',m.title));if(m.formula)item.append(node('p',m.formula,'report-formula'));item.append(node('p',m.note,'report-note'));page.append(item);}
 const p=report.provenance,c=p.compute||{},duration=Number.isFinite(p.endToEndMs)?Math.round(p.endToEndMs/60000)+t(' 分钟',' min'):'—';
 const info=sheet(t('附录：分析信息','Appendix: analysis details'));
 info.append(metadata([[t('引擎','Engine'),p.engine],[t('每个局面的访问量','Visits per position'),p.visits?.toLocaleString(locale())],[t('模型','Model'),p.model,true],[t('模型 SHA-256','Model SHA-256'),p.modelSha256,true],[t('计算资源','Compute'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),true],[t('总分析时间（含排队与准备）','Analysis total including queue/setup'),duration],[t('报告语言','Report language'),t('中文','English')],[t('分析完成时间','Analysis completed'),p.completedAt?timestamp(p.completedAt):'—',true],[t('报告生成时间','Report prepared'),timestamp(report.generatedAt),true],[t('报告版本','Report version'),REPORT_VERSION.number+' · '+REPORT_VERSION.date,true]]));
 info.append(node('p',t('报告版本在报告内容或计算方法改变时更新。','The report version changes whenever report content or calculation methods change.'),'report-note'));
}
function renderLanguage(value){
 reportLanguage=value;methods=[];
 const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.lang=value==='zh'?'zh-CN':'en';e.dataset.reportLanguage=value;e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),rules=({japanese:t('日本规则','Japanese rules'),chinese:t('中国规则','Chinese rules'),aga:t('AGA 规则','AGA rules'),korean:t('韩国规则','Korean rules')})[game.rules?.toLowerCase()]||game.rules;

 addSummary(sheet);
 addGameRecord(sheet);
 addStatistics(sheet);
 addMovePages(sheet);
 addAppendices(sheet);
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
 const gameDetails=metadata([[t('棋局 ID','Game ID'),id],[t('棋局日期','Game date'),game.date],[t('规则','Rules'),rules],[t('棋盘','Board'),'19 × 19'],[t('贴目','Komi'),String(game.komi)],[t('实战手数','Recorded moves'),String(game.moves)]]);gameDetails.classList.add('report-cover-game-details');cover.append(gameDetails);
 const credit=node('p',undefined,'report-cover-credit');credit.append(document.createTextNode(t('由 DL 围棋制作 · ','Produced by DL Weiqi · ')));const creditLink=node('a','dliu.com');creditLink.href='https://dliu.com';credit.append(creditLink);cover.append(credit,node('p',versionText(),'report-cover-version'));
 const contents=front('contents');contents.id='report-page-2';contents.dataset.reportTitle=t('目录','Table of contents');
 contents.append(node('p','DL Weiqi','report-running-header'),node('h2',t('目录','Table of contents')),node('p',t('依次为对局总结、总谱、全局统计、关键时刻详解和附录。点击条目即可跳转。','The summary, full game record and statistics come first, then the key-moment reviews and appendices. Select an entry to jump to its page.'),'report-note'));
 const list=node('ol',undefined,'report-contents-list');
 for(const entry of plan.contents){const item=node('li'),link=node('a');link.href=location.pathname+location.search+'#'+entry.target;link.dataset.reportPage=String(entry.page);link.append(node('span',entry.title,'report-contents-title'),node('span',undefined,'report-contents-leader'),node('span',String(entry.page),'report-contents-page'));item.append(link);list.append(item);}
 contents.append(list);fragment.prepend(cover,contents);sheets.unshift(cover,contents);
 for(const [index,s] of sheets.entries()){s.dataset.reportPage=String(index+1);const footer=node('footer',undefined,'report-footer'),gameLink=node('a','weiqi.dliu.com/game/'+id);gameLink.href='https://weiqi.dliu.com/game/'+id;footer.append(gameLink,node('span',t('中文','English')+' · '+(index+1)+' / '+plan.pageCount));s.append(footer);}
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
