import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
import {reportPagination} from './report-document.js';
import {selectReportHighlights} from './report-highlights.js';
import {comparisonChart,compositionChart,qualityLegend,reportChartColours} from './report-stat-charts.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/record\/([^/]+)\/report\/?$/)?.[1]||new URLSearchParams(location.search).get('game');
let report=null,reportLanguage=new URLSearchParams(location.search).get('lang')==='zh'?'zh':'en';
const t=(zh,en)=>reportLanguage==='zh'?zh:en;
const locale=()=>reportLanguage==='zh'?'zh-CN':'en-GB';
const timestamp=value=>{const parts=new Intl.DateTimeFormat(locale(),{dateStyle:'short',timeStyle:'medium'}).format(new Date(value)),zone=new Intl.DateTimeFormat(locale(),{timeZoneName:'longOffset'}).formatToParts(new Date(value)).find(p=>p.type==='timeZoneName')?.value;return parts+' · '+zone+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;};
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
const qualities=()=>({inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')});
function table(headers,rows){const e=node('table',undefined,'report-table'),head=node('thead'),h=node('tr');for(const text of headers)h.append(node('th',text));head.append(h);e.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const text of cells)row.append(node('td',text));body.append(row);}e.append(body);return e;}
function diagram(board,caption,labels=[],single=false){const f=node('figure',undefined,'report-board'+(single?' single':''));const svg=boardDiagram(board,{labels});svg.setAttribute('aria-label',t('十九路围棋图','19 × 19 Go diagram'));f.append(svg,node('figcaption',caption));return f;}
const sideName=side=>side==='B'?t('黑方','Black'):t('白方','White');
function reportPlot(label,series,{xMax=report.game.moves,yMax=1,stems=false,percent=false}={}){
 const wrap=node('div',undefined,'report-chart'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 760 300');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);svg.setAttribute('class','report-plot');
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 const left=58,right=20,top=100,max=Math.max(1,yMax),x=v=>left+v/Math.max(1,xMax)*(760-left-right),y=v=>252-v/max*(252-top);
 for(const value of [0,max/2,max]){add('line',{x1:left,y1:y(value),x2:740,y2:y(value),stroke:value===0?reportChartColours.axis:reportChartColours.grid,'stroke-width':value===0?1:.7});add('text',{x:left-7,y:y(value)+3,'text-anchor':'end','font-size':10,fill:reportChartColours.ink},number(value)+(percent?'%':''));}
 for(const value of [0,Math.round(xMax/4),Math.round(xMax/2),Math.round(xMax*3/4),xMax])add('text',{x:x(value),y:274,'text-anchor':'middle','font-size':10,fill:reportChartColours.ink},value);
 for(const entry of series){
  const colour=entry.side==='B'?reportChartColours.black:reportChartColours.white;
  if(stems)for(const point of entry.points){
   const stem={x1:x(point.x),x2:x(point.x),y1:252,y2:y(point.y)};
   if(entry.side==='W')add('line',{...stem,stroke:reportChartColours.line,'stroke-width':2.8});
   add('line',{...stem,stroke:colour,'stroke-width':1.4});
   const dot=add('circle',{cx:x(point.x),cy:y(point.y),r:report.problems.some(m=>m.move===point.x)?3.5:1.5,fill:colour,stroke:reportChartColours.line,'stroke-width':.7});
   const title=document.createElementNS(ns,'title');title.textContent=sideName(entry.side)+' · '+t('第 ','Move ')+point.x+' · '+number(point.y);dot.append(title);
  }
  else add('path',{d:entry.points.map((p,i)=>(i?'L':'M')+x(p.x)+','+y(p.y)).join(' '),fill:'none',stroke:colour,'stroke-width':1.8});
 }
 add('text',{x:left,y:22,'font-size':14,'font-weight':600,fill:reportChartColours.ink},t('损失目数 · 越低越好','Points lost · lower is better'));
 const labelled=[...report.problems].sort((a,b)=>b.pointLoss-a.pointLoss).slice(0,3).sort((a,b)=>a.move-b.move),labelEnds=[-Infinity,-Infinity,-Infinity];
 for(const move of labelled){const pointX=x(move.move),labelX=Math.max(104,Math.min(688,pointX)),row=Math.max(0,labelEnds.findIndex(end=>labelX-48>end+8)),labelY=36+row*24;labelEnds[row]=labelX+48;
  add('line',{x1:pointX,x2:labelX,y1:y(move.pointLoss)-6,y2:labelY+6,stroke:reportChartColours.line,'stroke-width':.8,'stroke-dasharray':'3 3'});
  add('rect',{x:labelX-48,y:labelY-16,width:96,height:23,rx:3,fill:move.side==='B'?reportChartColours.black:reportChartColours.white,stroke:reportChartColours.line,'stroke-width':.7});
  add('text',{x:labelX,y:labelY,'text-anchor':'middle','font-size':12,fill:move.side==='B'?'white':reportChartColours.ink},sideName(move.side)+' · '+move.move);
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
 wrap.append(svg,chartLegend(t('黑方失误 · 后文详解','Black error · reviewed later'),t('白方失误 · 后文详解','White error · reviewed later')));return wrap;
}
function graphTakeaway(title){
 const guides=[
  ['各类着法占比','Share of each move quality','先看橙色和红色：这些失误最值得复盘。','Start with orange and red: these decisions deserve review.'],
  ['典型损失与较大失误','Typical loss and bigger errors','条形越短，损失越小。平均值明显高于中位数时，优先复盘大失误。','Shorter bars mean less loss. A high average beside a low median points to a few costly mistakes.'],
  ['各区间的平均目数损失','Average point loss in each range','最长的条形提示最值得复盘的手数区间。','Your longest bar identifies the move range to review first.'],
  ['每手损失在哪里发生？','Where did each move lose points?','尖峰越高，损失越大。标出的手数可在后文棋盘详解中复盘。','Taller spikes mean bigger losses. The labelled moves have detailed board reviews later.'],
  ['黑方胜率','Black win probability','50% 表示机会均等；例如黑方 80% = 白方 20%。胜率不是目差。','50% means equal chances. Black 80% = White 20%; this is probability, not a point lead.'],
  ['目差：正为黑方领先，负为白方领先','Point advantage: positive Black, negative White','穿过零线表示预计领先方改变；圆点标出后文详解的失误。','Crossing zero changes the estimated leader. Dots mark errors reviewed on the later board pages.']
 ];
 const entry=guides.find(g=>g[0]===title||g[1]===title);return entry?t(entry[2],entry[3]):'';
}
function statisticGraph(title,visual,formula,zh,en){
 const figure=node('figure',undefined,'report-stat-card'),caption=node('figcaption',undefined,'report-graph-maths');
 figure.append(node('h3',title),visual);caption.append(node('p',graphTakeaway(title),'report-graph-reading'),node('h4',t('计算细节','Calculation details')),node('p',formula,'report-formula'),node('p',t(zh,en),'report-note'));figure.append(caption);return figure;
}
function addStatistics(sheet){
 const keys=['best','good','inaccuracy','mistake','blunder'],names={best:t('AI 首选','AI first choice'),good:t('好棋','Good'),...qualities()},sides={B:sideName('B'),W:sideName('W')};
 const rows=definitions=>definitions.map(([key,zh,en])=>({key,label:t(zh,en),values:['B','W'].map(side=>report.players[side][key])}));
 const compare=(title,definitions,options={})=>comparisonChart(title,rows(definitions),{names:sides,axisLabel:t('损失目数 · 越低越好 →','Points lost · lower is better →'),...options});
 const graph=(parent,title,svg,formula,zh,en)=>parent.append(statisticGraph(title,svg,formula,zh,en));
 const context=sheet(t('全局目差走势：谁领先？','Game-wide point advantage'));
 graph(context,t('目差：正为黑方领先，负为白方领先','Point advantage: positive Black, negative White'),contextChart('score'),'Displayed point advantage = S(position), from Black’s perspective',
 'S 为 AI 预计目差：正数表示黑方领先，负数表示白方领先；单位为目。',
 'S is the AI’s estimated Black lead, not the final scored result.');
 const winning=sheet(t('全局走势：获胜机会怎样变化？','Game-wide winning chances'));
 graph(winning,t('黑方胜率','Black win probability'),contextChart('win'),'Displayed Black win % = 100 × P(position)',
 'P 为 AI 预计黑方获胜概率；相邻局面的变化不等于单手损失。',
 'P is the estimated Black win probability. Changes between positions are not the loss of one move.');
 const quality=sheet(t('着法质量：一眼看清双方表现','Move quality: compare the whole game'));
 graph(quality,t('各类着法占比','Share of each move quality'),compositionChart(t('着法质量占比','Move-quality composition'),['B','W','all'].map(side=>({label:side==='all'?t('全局','Whole game'):sideName(side),counts:(side==='all'?report.overall:report.players[side]).counts})),{keys,names,emptyLabel:t('无已评定着法','No rated moves')}),'Share = 100 × category count / N',
 'N 为已评定着法数；首选按坐标匹配，其余按损失目数分类（L 的单位为目）。全局合并双方着法。',
 'N counts rated moves. AI first choice matches the coordinate; other categories use point loss. Whole game pools both sides.');
 quality.querySelector('.report-stat-card').insertBefore(qualityLegend(names,{best:t('坐标匹配','coordinate match'),good:'≤ 0.5',inaccuracy:'0.5 < L ≤ 2',mistake:'2 < L ≤ 5',blunder:'> 5'}),quality.querySelector('.report-graph-maths'));
 quality.append(table([t('着法类别','Move quality'),sideName('B'),sideName('W')],keys.map(key=>[names[key],report.players.B.counts[key],report.players.W.counts[key]])));
 quality.append(node('p',t('统计包含所有已评定着法。没有评估的着法不计为零损失；估计评估会在具体着法页标明。','Statistics include every rated move. Missing evaluations are left out, not treated as zero loss; estimates are labelled on detailed move pages.'),'report-note'));
 const loss=sheet(t('目数损失：典型表现与大失误','Point loss: typical play and large errors'));
 graph(loss,t('典型损失与较大失误','Typical loss and bigger errors'),compare(t('目数损失分位比较','Point-loss comparison'),[['meanPointLoss','平均损失','Average'],['medianPointLoss','一半着法不超过','Half of moves ≤'],['p90PointLoss','九成着法不超过','90% of moves ≤']],{digits:2}),'L_i = max(0, s_i * (S_best - S_played)); mean = sum(L_i) / N\nh = (N - 1) * q; Q(q) = x[floor(h)] + (h - floor(h)) * (x[ceil(h)] - x[floor(h)])',
 'S 为黑方视角的目差（单位：目）；黑 s=+1，白 s=−1；x 为排序后的损失目数，q=0.5 或 0.9。首选损失为 0，估计值取下一实战局面。',
 'S is Black’s lead; s=+1 for Black, −1 for White. x sorts losses; q=0.5 or 0.9. First-choice loss is zero; estimates use the following position.');
 const ranges=report.players.B.segments.filter(s=>s.moves||report.players.W.segments.find(w=>w.from===s.from)?.moves);
 const rangeRows=metric=>ranges.map(range=>({key:metric+'-'+range.from,label:range.from+'–'+range.to,values:['B','W'].map(side=>report.players[side].segments.find(s=>s.from===range.from)[metric])}));
 const stages=sheet(t('不同手数区间的损失','Losses across move ranges'));
 graph(stages,t('各区间的平均目数损失','Average point loss in each range'),comparisonChart(t('区间平均损失','Mean loss by range'),rangeRows('meanPointLoss'),{names:sides,digits:2,axisLabel:t('平均损失目数 · 越低越好 →','Average points lost · lower is better →')}),'Range mean = sum(L_i in range) / rated moves in range',
 '固定手数区间，不是自动识别的棋局阶段；包括首选与好棋。',
 'Fixed move ranges, not detected game phases. All rated moves are included, even first choices and good moves.');
 const timeline=sheet(t('值得复盘的关键时刻','Key moments to review')),isRated=m=>keys.includes(m.quality)&&Number.isFinite(m.pointLoss),series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isRated(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 graph(timeline,t('每手损失在哪里发生？','Where did each move lose points?'),reportPlot(t('逐手目数损失','Point loss by move'),series,{stems:true,yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y)))}),'Each stem = L_i = max(0, s_i * (S_best - S_played))',
 '损失比较同一局面的首选与实战；无评估的着法不计入。',
 'Loss compares best and played choices from the same position. Unrated moves are excluded.');
 const keyTable=sheet(t('关键时刻：双方各五手失误','Key moments: five errors per side'));
 keyTable.append(node('p',t('这是优先复盘清单。双方分别选出目数损失最大的五手，前三手在后文配有棋盘图；点击手数可回到棋局，点击页码可跳到详细复盘。','Use this as your review shortlist. Each side’s five largest point losses are listed. The first three have board diagrams later; select a move number to replay it, or a page link to jump to its detailed review.')));
 for(const side of ['B','W']){
  const moves=report.keyMoves[side],reviewed=new Set(report.problems.filter(m=>m.side===side).map(m=>m.nodeId));
  keyTable.append(node('h3',sideName(side)+' · '+t('目数损失最大的五手','Five largest point losses')));
  if(!moves.length){keyTable.append(node('p',t('未找到损失超过 0.5 目的已评定失误。','No rated errors losing more than 0.5 points were found.'),'report-note'));continue;}
  const grid=table([t('手数','Move'),t('实战','Played'),t('目数损失（目）','Point loss'),t('胜率损失','Win loss'),t('后续复盘','Follow-up review')],moves.map(m=>[m.move,m.played,(m.estimated?'≈ ':'')+number(m.pointLoss),number(m.winrateLoss)+t(' 个百分点',' pp'),reviewed.has(m.nodeId)?t('后文棋盘详解','Detailed board review'):t('棋局回放','Game replay')]));
  for(const [index,row] of [...grid.tBodies[0].rows].entries()){
   const m=moves[index],link=node('a',String(m.move));row.className='report-key-move'+(reviewed.has(m.nodeId)?' report-key-reviewed':'');link.href='https://weiqi.dliu.com/record/'+id+'?move='+m.nodeId;row.cells[0].replaceChildren(link);
   if(reviewed.has(m.nodeId)){const detail=node('a',t('后文棋盘详解','Detailed board review'));detail.dataset.reviewMove=String(m.move);detail.dataset.reviewSide=side;row.cells[4].replaceChildren(detail);}
  }
  keyTable.append(grid);
 }
 keyTable.append(node('p',t('按本方目数损失从大到小排序；不足五手时只列出实际找到的失误。“≈”表示搜索不足，采用落子后局面估计；胜率损失以百分点计。双方各前三手会在后文详细复盘。','Sorted by point loss for the played side; fewer than five are listed when fewer qualify. “≈” marks an estimate from the following position when the played move had insufficient search. Win loss is in percentage points. The first three per side are reviewed in detail later.'),'report-note'));

}
function renderLanguage(value){
 reportLanguage=value;
 const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.lang=value==='zh'?'zh-CN':'en';e.dataset.reportLanguage=value;e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),rules=({japanese:t('日本规则','Japanese rules'),chinese:t('中国规则','Chinese rules'),aga:t('AGA 规则','AGA rules'),korean:t('韩国规则','Korean rules')})[game.rules?.toLowerCase()]||game.rules;
 const p=report.provenance,c=p.compute||{},duration=Number.isFinite(p.endToEndMs)?Math.round(p.endToEndMs/60000)+t(' 分钟',' min'):'—';

 addStatistics(sheet);
 for(const side of ['B','W'])for(const [index,m] of report.problems.filter(m=>m.side===side).slice(0,3).entries()){
  const colour=m.side==='B'?t('黑方','Black'):t('白方','White'),title=colour+' '+(index+1)+' · '+t('第 '+m.move+' 手','Move '+m.move);
  const answer=sheet(title+' · '+(qualities()[m.quality]||t('未评定','Unrated')));answer.dataset.side=m.side;answer.dataset.move=m.move;
  answer.append(node('p',m.played+' · '+t('估计目数损失 ','Estimated point loss: ')+number(m.pointLoss)+t(' 目','')+' · '+t('胜率损失 ','Win-probability loss: ')+number(m.winrateLoss)+t(' 个百分点',' percentage points'),'report-quality-'+m.quality));
  answer.append(node('p',t('占本方较差着法累计目数损失：','Share of this side’s cumulative bad-move loss: ')+number(m.pointLoss/report.players[m.side].totalBadPointLoss*100)+'%','report-note'));
  const sign=m.side==='B'?1:-1,win=v=>m.side==='B'?v:1-v,rows=[{label:t('AI 首选','AI best'),c:m.best},{label:t('实战','Played'),c:{move:m.played,...m.playedEvaluation,visits:m.playedCandidate?.visits}}];
  answer.append(table([t('选点','Choice'),t('坐标','Coordinate'),t('本方目差（目）','Point lead'),t('胜率','Win probability'),t('访问量','Visits')],rows.map(({label,c})=>[label,c.move,number(sign*c.blackLead),number(win(c.blackWinrate)*100)+'%',c.visits?.toLocaleString(locale())||'—'])));
  const pair=node('div',undefined,'diagram-pair'),numbers=line=>line?.moves.map((move,n)=>({index:move.index,side:move.side,label:String(n+1)})).filter(m=>m.index!==null)||[];
  pair.append(diagram(m.actualBoard,t('实战落子后的棋盘','Board after the played move'),m.playedIndex===null?[]:[{index:m.playedIndex,side:m.side,label:'1'}]),diagram(m.bestLine.board,t('AI 首选变化','AI best continuation'),numbers(m.bestLine)));answer.append(pair);
  answer.append(node('p',t('数字从选点后的第 1 手开始；停一手不标在棋盘上。最多显示 12 手，后续为引擎推荐变化，不是实际棋谱。','Numbers start with the candidate move. Passes have no board label. Up to 12 moves are shown; continuations are engine suggestions, not the recorded game.'),'report-note'));
  if(m.estimated)answer.append(node('p',t('实战着法的搜索不足，其评估来自落子后的局面；数值为估计。','The played move had insufficient search; its evaluation comes from the following position and is estimated.'),'report-note'));
  if(m.bestLine.truncated)answer.append(node('p',t('无法合法复现的变化已截断。','A continuation that could not be replayed legally has been truncated.'),'report-note'));
  const link=node('a',t('在棋局中复盘这一步','Review this move in the game'));link.href='/record/'+id+'?move='+m.nodeId;answer.append(link);
 }
 const plan=reportPagination(sheets.map(s=>s.querySelector('h2').textContent));
 for(const [index,s] of sheets.entries()){s.id=plan.contents[index].target;s.dataset.reportTitle=plan.contents[index].title;s.prepend(node('p','DL / WEIQI','report-running-header'));}
 for(const link of fragment.querySelectorAll('[data-review-move]')){
  const target=sheets.find(s=>s.dataset.move===link.dataset.reviewMove&&s.dataset.side===link.dataset.reviewSide),page=sheets.indexOf(target)+3;
  if(target){link.href=location.pathname+location.search+'#'+target.id;link.dataset.reportPage=String(page);link.textContent=t('棋盘详解 · 第 '+page+' 页','Board review · p. '+page);}
 }
 const front=type=>{const page=node('section',undefined,'report-sheet report-'+type);page.lang=value==='zh'?'zh-CN':'en';page.dataset.reportLanguage=value;return page;};
 const cover=front('cover');cover.id='report-page-1';cover.dataset.reportTitle=t('封面','Title page');
 cover.append(node('p','DL / WEIQI','report-cover-brand'),node('p',t('深度分析 · 棋局复盘','DEEP ANALYSIS / GAME REVIEW'),'report-cover-kicker'),node('h1',t('围棋 AI\n复盘报告','Go AI\nReview Report')),node('p',report.name,'report-cover-name'));
 const playerCards=node('div',undefined,'report-cover-players');
 for(const side of ['B','W']){const card=node('div',undefined,'report-cover-player report-cover-player-'+side);card.append(node('span',sideName(side),'report-cover-side'),node('strong',game.players[side==='B'?'black':'white']||'—'));playerCards.append(card);}
 cover.append(playerCards,node('p',result?t(result.zh,result.en):game.result||t('结果未记录','Result not recorded'),'report-cover-result'));
 const gameAddress='https://weiqi.dliu.com/record/'+id,gameLinkBox=node('p',undefined,'report-cover-link'),coverLink=node('a',gameAddress);coverLink.href=gameAddress;gameLinkBox.append(node('span',t('在线棋局','ONLINE GAME')),coverLink);cover.append(gameLinkBox);
 const metadata=entries=>{const grid=node('dl',undefined,'report-cover-data');for(const [label,value,wide] of entries){const entry=node('div',undefined,wide?'report-cover-data-wide':undefined);entry.append(node('dt',label),node('dd',value||'—'));grid.append(entry);}return grid;};
 const gameDetails=metadata([[t('棋局 ID','Game ID'),id],[t('棋局日期','Game date'),game.date],[t('规则','Rules'),rules],[t('棋盘','Board'),'19 × 19'],[t('贴目','Komi'),String(game.komi)],[t('实战手数','Recorded moves'),String(game.moves)]]);gameDetails.classList.add('report-cover-game-details');cover.append(gameDetails);
 const publication=node('div',undefined,'report-cover-analysis');
 publication.append(node('h3',t('分析与报告元数据','ANALYSIS AND REPORT METADATA')),metadata([[t('引擎','Engine'),p.engine],[t('每个局面的访问量','Visits per position'),p.visits.toLocaleString(locale())],[t('模型','Model'),p.model,true],[t('模型 SHA-256','Model SHA-256'),p.modelSha256,true],[t('计算资源','Compute'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),true],[t('总分析时间（含排队与准备）','Analysis total including queue/setup'),duration],[t('报告语言','Report language'),t('中文','English')],[t('分析完成时间','Analysis completed'),timestamp(p.completedAt),true],[t('报告生成时间','Report prepared'),timestamp(report.generatedAt),true]]));
 cover.append(publication,node('p',t('先看全局走势 · 双方各五手失误统计 · 各三手棋盘详解','Game story first / Five errors per side / Three detailed board reviews each'),'report-cover-scope'));
 const contents=front('contents');contents.id='report-page-2';contents.dataset.reportTitle=t('目录','Table of contents');
 contents.append(node('p','DL / WEIQI','report-running-header'),node('h2',t('目录','Table of contents')),node('p',t('全局统计与数学方法在前，具体失误局面在后。点击条目即可跳转。','Statistics and methods come first, followed by the detailed error positions. Select an entry to jump to its page.'),'report-note'));
 const list=node('ol',undefined,'report-contents-list');
 for(const entry of plan.contents){const item=node('li'),link=node('a');link.href=location.pathname+location.search+'#'+entry.target;link.dataset.reportPage=String(entry.page);link.append(node('span',entry.title,'report-contents-title'),node('span',undefined,'report-contents-leader'),node('span',String(entry.page),'report-contents-page'));item.append(link);list.append(item);}
 contents.append(list);fragment.prepend(cover,contents);sheets.unshift(cover,contents);
 for(const [index,s] of sheets.entries()){s.dataset.reportPage=String(index+1);const footer=node('footer',undefined,'report-footer'),gameLink=node('a','weiqi.dliu.com/record/'+id);gameLink.href='https://weiqi.dliu.com/record/'+id;footer.append(gameLink,node('span',t('中文','English')+' · '+(index+1)+' / '+plan.pageCount));s.append(footer);}
 return fragment;
}
function render(){
 document.title=t('AI 棋局报告','AI game report')+' · DL';document.documentElement.lang=reportLanguage==='zh'?'zh-CN':'en';
 $('back-record').textContent=t('返回棋局','Return to game');$('back-record').href='/record/'+id;
 $('save-report').textContent=t('保存 PDF','Save PDF');
 for(const value of ['en','zh'])$(`report-${value}`).setAttribute('aria-pressed',String(reportLanguage===value));
 if(!report)return;
 $('report-content').replaceChildren(renderLanguage(reportLanguage));$('report-status').textContent='';
}
for(const value of ['en','zh'])$(`report-${value}`).onclick=()=>{reportLanguage=value;const url=new URL(location.href);url.searchParams.set('lang',value);history.replaceState(null,'',url);render();};

render();
try{if(!id)throw Error('Missing game ID.');report=selectReportHighlights(await libraryRequest('/api/library/'+encodeURIComponent(id)+'/report'));render();}catch(e){$('report-status').textContent=e.message;}
