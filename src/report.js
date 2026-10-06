import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
import {reportPagination} from './report-document.js';
import {selectReportHighlights} from './report-highlights.js';
import {comparisonChart,compositionChart,qualityLegend} from './report-stat-charts.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/record\/([^/]+)\/report\/?$/)?.[1]||new URLSearchParams(location.search).get('game');
let report=null,reportLanguage=new URLSearchParams(location.search).get('lang')==='zh'?'zh':'en',saving=false;
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
 const wrap=node('div',undefined,'report-chart'),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 190');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
 const left=48,right=14,top=16,bottom=30,max=Math.max(1,yMax),x=v=>left+v/Math.max(1,xMax)*(760-left-right),y=v=>160-v/max*(160-top);
 for(const value of [0,max/2,max]){add('line',{x1:left,y1:y(value),x2:746,y2:y(value),stroke:'#c9d2d7','stroke-width':.7});add('text',{x:left-7,y:y(value)+3,'text-anchor':'end','font-size':10,fill:'#52616b'},number(value)+(percent?'%':''));}
 for(const value of [0,Math.round(xMax/4),Math.round(xMax/2),Math.round(xMax*3/4),xMax])add('text',{x:x(value),y:183,'text-anchor':'middle','font-size':10,fill:'#52616b'},value);
 for(const entry of series){const colour=entry.side==='B'?'#26343d':'#bc581b';if(stems){for(const point of entry.points){add('line',{x1:x(point.x),x2:x(point.x),y1:160,y2:y(point.y),stroke:colour,'stroke-width':1.4});const dot=add('circle',{cx:x(point.x),cy:y(point.y),r:report.problems.some(m=>m.move===point.x)?3.5:1.5,fill:colour});const title=document.createElementNS(ns,'title');title.textContent=sideName(entry.side)+' · '+t('第 ','Move ')+point.x+' · '+number(point.y);dot.append(title);}}else add('path',{d:entry.points.map((p,i)=>(i?'L':'M')+x(p.x)+','+y(p.y)).join(' '),fill:'none',stroke:colour,'stroke-width':1.8});}
 wrap.append(svg,node('p',t('黑方：深色 · 白方：橙色 · 横轴：手数','Black: dark · White: orange · Horizontal axis: move number'),'report-note'));return wrap;
}
function contextChart(mode){
 const ns='http://www.w3.org/2000/svg',wrap=node('div',undefined,'report-chart'),g=chartGeometry(report.chart,760,175,mode),svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 175');svg.setAttribute('role','img');svg.setAttribute('aria-label',mode==='win'?t('黑方胜率走势','Black win probability'):t('黑方点数优势','Black point advantage'));
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))e.setAttribute(key,value);if(text!==undefined)e.textContent=text;svg.append(e);};
 for(const value of [-g.extent,0,g.extent]){add('line',{x1:g.left,y1:g.y(value),x2:g.width-g.right,y2:g.y(value),stroke:'#c9d2d7','stroke-width':.7});add('text',{x:g.left-6,y:g.y(value)+3,'text-anchor':'end','font-size':10,fill:'#52616b'},mode==='win'?(value+50)+'%':(value>0?'+':'')+value);}
 add('path',{d:g.points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),fill:'none',stroke:'#425d6c','stroke-width':1.5});for(const value of [0,Math.round(g.last/2),g.last])add('text',{x:g.x(value),y:169,'text-anchor':'middle','font-size':10,fill:'#52616b'},value);
 for(const move of report.problems){const point=g.points.find(p=>p.nodeId===move.nodeId);if(point)add('circle',{cx:point.x,cy:point.y,r:3.5,fill:move.side==='B'?'#26343d':'#bc581b',stroke:'white','stroke-width':1});}
 wrap.append(svg);return wrap;
}
function graphReading(title){
 const guides=[
  ['各类着法占比','Share of each move quality','绿色越多，保持局面的着法越多；橙色和红色越多，损失较大的着法越多。每一行是一方或全局的全部已评定着法。','More green means more moves kept the position close to the AI recommendation. More orange and red means more costly errors. Each row represents that player’s analysed moves, or both players together.'],
  ['典型损失与较大失误','Typical loss and bigger errors','点损失表示相比 AI 推荐，这手棋损失了多少优势。数值越低越好。平均值概括全局；中间一手是一半着法损失更小的界线；90% 界线帮助观察较大的失误。','Point loss is how much advantage a move gives up compared with the AI recommendation. Lower is better. Average summarizes all moves; the middle move splits them in half; the 90% cutoff shows the size of bigger errors.'],
  ['三手占全部损失的比例','Share of loss in the three worst moves','比例越高，越值得先复盘少数关键失误；比例较低，可能需要改善较多分散的着法。','A higher share suggests reviewing a few key mistakes first. A lower share may mean smaller errors were spread across more moves.'],
  ['胜率损失对比（百分点）','Win-rate losses compared (percentage points)','相比推荐选点，这些着法降低了多少获胜机会？越低越好。例如从 70% 降到 50%，损失为 20 个百分点。','How much did moves reduce the chance of winning compared with the recommendation? Lower is better. Falling from 70% to 50% is a loss of 20 percentage points.'],
  ['各区间的平均点损失','Average point loss in each range','比较棋局前段、中段和后段的平均损失。越低越好，可帮助找到最需要改进的手数区间。','Compare average losses early, in the middle and later in the game. Lower is better; this helps identify stretches to work on.'],
  ['各损失区间的着法比例','Share of moves in each loss bin','看大部分着法是零损失、小损失还是大损失。横轴是着法比例，每一手只进入一组。','See whether most moves lost nothing, a little or a lot. Bar length is the share of moves, and each move belongs to just one group.'],
  ['每手损失在哪里发生？','Where did each move lose points?','尖峰越高，这手棋的损失越大。较大的圆点对应后面有棋盘图的重点失误。','Taller spikes mean more costly moves. Larger dots identify the key errors illustrated on board diagrams later in the report.'],
  ['黑方胜率','Black win probability','曲线越高，AI 认为黑方越有可能获胜。50% 表示双方机会相当。它是对局面的估计，不是保证。','A higher line means the AI thinks Black is more likely to win. At 50%, both sides have equal chances. This is an estimate, not a guarantee.'],
  ['点数优势：正为黑，负为白','Point advantage: positive Black, negative White','高于零线表示黑方领先，低于零线表示白方领先。离零线越远，预估优势越大。','Above zero means Black leads; below zero means White leads. Farther from zero means a larger estimated advantage.']
 ];
 const reading=guides.find(g=>g[0]===title||g[1]===title);return reading?t(reading[2],reading[3]):'';
}
function statisticGraph(title,visual,formula,zh,en){
 const figure=node('figure',undefined,'report-stat-card'),caption=node('figcaption',undefined,'report-graph-maths');
 figure.append(node('h3',title),visual);caption.append(node('p',graphReading(title),'report-graph-reading'),node('h4',t('计算细节 · 供技术读者参考','Calculation details · for technical readers')),node('p',formula,'report-formula'),node('p',t(zh,en),'report-note'));figure.append(caption);return figure;
}
function addStatistics(sheet){
 const keys=['best','good','inaccuracy','mistake','blunder'],names={best:t('AI 首选','AI first choice'),good:t('好棋','Good'),...qualities()},sides={B:sideName('B'),W:sideName('W')};
 const rows=definitions=>definitions.map(([key,zh,en])=>({key,label:t(zh,en),values:['B','W'].map(side=>report.players[side][key])}));
 const compare=(title,definitions,options={})=>comparisonChart(title,rows(definitions),{names:sides,...options});
 const graph=(parent,title,svg,formula,zh,en)=>parent.append(statisticGraph(title,svg,formula,zh,en));
 const quality=sheet(t('着法质量：一眼看清双方表现','Move quality: compare the whole game'));
 graph(quality,t('各类着法占比','Share of each move quality'),compositionChart(t('着法质量占比','Move-quality composition'),['B','W','all'].map(side=>({label:side==='all'?t('全局','Whole game'):sideName(side),counts:(side==='all'?report.overall:report.players[side]).counts})),{keys,names,emptyLabel:t('无已评定着法','No rated moves')}),'Share = 100 × category count / N',
 'N 是该行已评定着法数。AI 首选按坐标匹配优先归类；其他着法按点损失 L 分类：好棋 ≤0.5，不精确 >0.5 至 2，失误 >2 至 5，严重失误 >5。全局行合并双方着法，不平均双方百分比。首选匹配不表示客观完美。',
 'N is the rated-move count for that row. A coordinate matching the AI first choice is classified first; other moves use point loss L: good ≤0.5, inaccuracy >0.5 to 2, mistake >2 to 5, blunder >5. Whole game pools the moves rather than averaging side percentages. A first-choice match does not establish objective perfection.');
 quality.querySelector('.report-stat-card').insertBefore(qualityLegend(names),quality.querySelector('.report-graph-maths'));
 quality.append(table([t('着法类别','Move quality'),sideName('B'),sideName('W')],keys.map(key=>[names[key],report.players.B.counts[key],report.players.W.counts[key]])));
 quality.append(node('p',t('统计包含所有已评定着法。没有评估的着法不计为零损失；估计评估会在具体着法页标明。','Statistics include every rated move. Missing evaluations are left out, not treated as zero loss; estimates are labelled on detailed move pages.'),'report-note'));
 const loss=sheet(t('点损失：典型表现与大失误','Point loss: typical play and large errors'));
 graph(loss,t('典型损失与较大失误','Typical loss and bigger errors'),compare(t('点损失分位比较','Point-loss comparison'),[['meanPointLoss','平均损失','Average'],['medianPointLoss','中间一手','Middle move'],['p90PointLoss','90% 界线','90% below']],{digits:2}),'Lᵢ = max(0, sᵢ(Sbest − Splayed)); μ = Σ Lᵢ / N; h = (N−1)q; Qq = x⌊h⌋ + (h−⌊h⌋)(x⌈h⌉−x⌊h⌋)',
 'S 是黑方领先点数，黑方落子 s=+1、白方 s=−1；实战为 AI 首选时损失记为 0。均值包含所有已评定着法。分位数将损失从小到大排序为 x₀…xN−1 后线性插值；90 百分位刻画较大损失，越低越好。估计选点的 Splayed 来自下一实战局面。',
 'S is Black’s point lead; s=+1 for Black and −1 for White. Playing the AI first choice records zero loss. The mean includes all rated moves. Quantiles linearly interpolate sorted losses x₀…xN−1; the 90th percentile describes bigger losses, with lower values better. Estimated Splayed comes from the next recorded position.');
 const totals=sheet(t('少数失误造成了多少损失？','How much loss came from a few mistakes?'));
 graph(totals,t('三手占全部损失的比例','Share of loss in the three worst moves'),compare(t('三手损失集中度','Top-three concentration'),[['highlightLossPercent','损失集中度','Concentration']],{maximum:100,suffix:'%'}),'T₃ = Σ up to three largest bad-move Lᵢ; T = Σ all rated Lᵢ; share = 100 × T₃ / T',
 '比例越高，损失越集中于少数关键失误；较低可能表示失误较分散。T=0 时比例无定义，显示“—”，不是 0%。',
 'A larger share means a few errors account for more of the loss; a lower share can indicate more dispersed errors. When T=0, the ratio is undefined and displays “—”, not 0%.');
 const win=sheet(t('胜率损失：典型与较大变化','Win-rate loss: typical and larger drops'));
 graph(win,t('胜率损失对比（百分点）','Win-rate losses compared (percentage points)'),compare(t('胜率损失','Win-rate loss'),[['meanWinrateLoss','平均损失','Average'],['medianWinrateLoss','中间一手','Middle move'],['p90WinrateLoss','90% 界线','90% below']],{digits:2}),'Wᵢ = max(0, 100 × sᵢ(Pbest−Pplayed)); mean = Σ Wᵢ / M',
 'P 是黑方胜率（0 至 1），s 取落子方视角；M 只包含具有胜率数据的已评定着法。70% 降到 50% 是 20 个百分点。中位数与第 90 百分位使用相同线性插值公式。这些损失不相加成全局输赢概率。',
 'P is Black’s win probability (0 to 1), and s uses the played side’s perspective. M includes rated moves with win data. A drop from 70% to 50% is 20 percentage points. Median and 90th percentile use the same linear interpolation formula. Losses are not added into a game-wide win probability.');
 win.append(table([t('极值与样本量','Extreme value and sample size'),sideName('B'),sideName('W')],[[t('已评定胜率手数 M','Rated win-loss moves M'),report.players.B.winrateRatedMoves,report.players.W.winrateRatedMoves],[t('最大胜率损失（百分点）','Biggest drop (percentage points)'),number(report.players.B.maxWinrateLoss,2),number(report.players.W.maxWinrateLoss,2)],[t('对应手数','Move of maximum loss'),report.players.B.worstWinrateLossMove,report.players.W.worstWinrateLossMove]]));
 const ranges=report.players.B.segments.filter(s=>s.moves||report.players.W.segments.find(w=>w.from===s.from)?.moves);
 const rangeRows=metric=>ranges.map(range=>({key:metric+'-'+range.from,label:range.from+'–'+range.to,values:['B','W'].map(side=>report.players[side].segments.find(s=>s.from===range.from)[metric])}));
 const stages=sheet(t('不同手数区间的损失','Losses across move ranges'));
 graph(stages,t('各区间的平均点损失','Average point loss in each range'),comparisonChart(t('区间平均损失','Mean loss by range'),rangeRows('meanPointLoss'),{names:sides,digits:2}),'Range mean = Σ Lᵢ in range / rated moves in range',
 '区间固定为 1–60、61–180 和 181 手以后，不是自动识别的棋局阶段。条形均值使用本方在该区间的所有已评定着法，包括首选与好棋。',
 'Ranges are fixed at 1–60, 61–180 and 181 onward, not automatically detected game phases. Each mean uses that side’s rated moves in the range, including first choices and good moves.');
 const distribution=sheet(t('多少着法损失很小或很大？','How many moves lost a little or a lot?'));
 const bucketLabel=b=>b.to===0?'0':b.to===null?'>10':'> '+b.from+'–'+b.to;
 const bucketRows=metric=>report.players.B.lossBuckets.map((b,i)=>({key:metric+'-'+i,label:bucketLabel(b),values:[b[metric],report.players.W.lossBuckets[i][metric]]}));
 graph(distribution,t('各损失区间的着法比例','Share of moves in each loss bin'),comparisonChart(t('点损失分布','Point-loss distribution'),bucketRows('percentage'),{names:sides,digits:1,suffix:'%',maximum:100}),'Bin share = 100 × moves in bin / N',
 '区间互不重叠：0、(0,0.5]、(0.5,2]、(2,5]、(5,10]、>10。零与低损失都保留，未评定着法不进入任何区间。该方六个比例之和为 100%（显示值有四舍五入）。',
 'Bins are non-overlapping: 0, (0,0.5], (0.5,2], (2,5], (5,10], >10. Zero and small losses remain; unrated moves enter no bin. Each side’s shares sum to 100%, subject to displayed rounding.');
 const timeline=sheet(t('值得复盘的关键时刻','Key moments to review')),isRated=m=>keys.includes(m.quality)&&Number.isFinite(m.pointLoss),series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isRated(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 graph(timeline,t('每手损失在哪里发生？','Where did each move lose points?'),reportPlot(t('逐手点损失','Point loss by move'),series,{stems:true,yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y)))}),'Each stem = Lᵢ = max(0, sᵢ(Sbest−Splayed))',
 '横轴是实战手数，纵轴是该手点损失。零损失位于基线，未评定着法没有点。较大的圆点标出展示棋盘的三个黑方与三个白方失误。',
 'The horizontal axis is the recorded move number; height is that move’s point loss. Zero losses lie on the baseline; unrated moves have no point. Larger dots identify the three Black and three White errors with board diagrams.');
 const context=sheet(t('全局胜率与点数走势','Game-wide win probability and point advantage'));
 graph(context,t('黑方胜率','Black win probability'),contextChart('win'),'Displayed Black win % = 100 × P(position)',
 'P 为当前实战局面中黑方的引擎胜率，白方胜率为 100% 减去该值。标记为报告列出的失误。相邻局面的变化不是单手损失，单手损失比较同一决策点的首选与实战。',
 'P is the engine’s Black win probability at that recorded position; White’s is 100% minus this value. Markers identify listed errors. Adjacent position changes are not move loss, which compares best and played choices at one decision point.');
 graph(context,t('点数优势：正为黑，负为白','Point advantage: positive Black, negative White'),contextChart('score'),'Displayed point advantage = S(position), from Black’s perspective',
 'S>0 表示黑方领先，S<0 表示白方领先；这是该模型与访问量下的预估优势，不是最终结算目数。黑方标记为深色、白方标记为橙色。',
 'S>0 means Black leads and S<0 means White leads. This is the estimated advantage under this model and visit setting, not the final scored margin. Dark markers represent Black and orange markers White.');
}
function renderLanguage(value){
 reportLanguage=value;
 const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.lang=value==='zh'?'zh-CN':'en';e.dataset.reportLanguage=value;e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),rules=({japanese:t('日本规则','Japanese rules'),chinese:t('中国规则','Chinese rules'),aga:t('AGA 规则','AGA rules'),korean:t('韩国规则','Korean rules')})[game.rules?.toLowerCase()]||game.rules,gameLabel=t('黑方：','Black: ')+(game.players.black||'—')+' · '+t('白方：','White: ')+(game.players.white||'—');
 const overview=sheet(t('棋局概览与重点着法','Game summary and highlighted moves'));overview.append(node('p',report.name,'report-game'),node('p',gameLabel,'report-game'),node('p',[result?t(result.zh,result.en):game.result,game.date,rules,t('贴目 ','Komi ')+game.komi,t('共 '+game.moves+' 手',game.moves+' moves')].filter(Boolean).join(' · ')));
 const p=report.provenance,c=p.compute||{},duration=Number.isFinite(p.endToEndMs)?Math.round(p.endToEndMs/60000)+t(' 分钟',' min'):'—';overview.append(node('p',[p.engine+' · '+p.model,p.visits.toLocaleString(locale())+t(' 次访问 / 局面',' visits / position'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),t('分析总时间（含排队和准备）：','Analysis total including queue/setup: ')+duration,t('分析完成：','Analysis completed: ')+timestamp(p.completedAt)].join('\n'),'report-meta'));
 overview.append(node('p',t('分别列出黑方和白方点损失最大的三个较差着法，以及 AI 推荐变化。若一方没有三个符合条件的着法，只列出实际找到的数量。','The three moves with the largest estimated point losses for each side, with AI recommended continuations. If fewer than three qualify, only the available moves are listed.')));
 for(const side of ['B','W']){
  const colour=side==='B'?t('黑方','Black'):t('白方','White'),name=game.players[side==='B'?'black':'white']||'—',moves=report.problems.filter(m=>m.side===side).slice(0,3);
  overview.append(node('h3',colour+' · '+name));
  if(moves.length)overview.append(table([t('手数','Move'),t('实战','Played'),t('点损失','Point loss'),t('AI 首选','AI best')],moves.map(m=>[m.move,m.played,number(m.pointLoss),m.best.move])));
  else overview.append(node('p',t('未找到点损失超过 0.5 的已评定着法。','No rated moves losing more than 0.5 points were found.')));
 }
 addStatistics(sheet);
 for(const side of ['B','W'])for(const [index,m] of report.problems.filter(m=>m.side===side).slice(0,3).entries()){
  const colour=m.side==='B'?t('黑方','Black'):t('白方','White'),title=colour+' '+(index+1)+' · '+t('第 '+m.move+' 手','Move '+m.move);
  const answer=sheet(title+' · '+(qualities()[m.quality]||t('未评定','Unrated')));answer.dataset.side=m.side;answer.dataset.move=m.move;
  answer.append(node('p',m.played+' · '+t('估计点损失 ','Estimated point loss: ')+number(m.pointLoss)+' · '+t('胜率损失 ','Win-probability loss: ')+number(m.winrateLoss)+t(' 个百分点',' percentage points'),'report-quality-'+m.quality));
  answer.append(node('p',t('占本方较差着法累计点损失：','Share of this side’s cumulative bad-move loss: ')+number(m.pointLoss/report.players[m.side].totalBadPointLoss*100)+'%','report-note'));
  const sign=m.side==='B'?1:-1,win=v=>m.side==='B'?v:1-v,rows=[{label:t('AI 首选','AI best'),c:m.best},{label:t('实战','Played'),c:{move:m.played,...m.playedEvaluation,visits:m.playedCandidate?.visits}}];
  answer.append(table([t('选点','Choice'),t('坐标','Coordinate'),t('领先点数','Point lead'),t('胜率','Win probability'),t('访问量','Visits')],rows.map(({label,c})=>[label,c.move,number(sign*c.blackLead),number(win(c.blackWinrate)*100)+'%',c.visits?.toLocaleString(locale())||'—'])));
  const pair=node('div',undefined,'diagram-pair'),numbers=line=>line?.moves.map((move,n)=>({index:move.index,side:move.side,label:String(n+1)})).filter(m=>m.index!==null)||[];
  pair.append(diagram(m.actualBoard,t('实战落子后的棋盘','Board after the played move'),m.playedIndex===null?[]:[{index:m.playedIndex,side:m.side,label:'1'}]),diagram(m.bestLine.board,t('AI 首选变化','AI best continuation'),numbers(m.bestLine)));answer.append(pair);
  answer.append(node('p',t('数字从选点后的第 1 手开始；停一手不标在棋盘上。最多显示 12 手，后续为引擎推荐变化，不是实际棋谱。','Numbers start with the candidate move. Passes have no board label. Up to 12 moves are shown; continuations are engine suggestions, not the recorded game.'),'report-note'));
  if(m.estimated)answer.append(node('p',t('实战着法的搜索不足，其评估来自落子后的局面；数值为估计。','The played move had insufficient search; its evaluation comes from the following position and is estimated.'),'report-note'));
  if(m.bestLine.truncated)answer.append(node('p',t('无法合法复现的变化已截断。','A continuation that could not be replayed legally has been truncated.'),'report-note'));
  const link=node('a',t('在棋局中复盘这一步','Review this move in the game'));link.href='/record/'+id+'?move='+m.nodeId;answer.append(link);
 }
 overview.append(node('p',t('按棋手视角的估计点损失排序，棋盘图仅列出损失超过 0.5 点的着法，统计包括所有已评定着法。报告复用已保存的深度分析，不启动新分析。','Ranked by estimated point loss from the player’s perspective; board diagrams include only moves losing more than 0.5 points; statistics include all rated moves. The report reuses saved deep analysis and starts no new analysis.'),'report-note'));
 const plan=reportPagination(sheets.map(s=>s.querySelector('h2').textContent));
 for(const [index,s] of sheets.entries()){s.id=plan.contents[index].target;s.dataset.reportTitle=plan.contents[index].title;s.prepend(node('p','DL / WEIQI','report-running-header'));}
 const front=type=>{const page=node('section',undefined,'report-sheet report-'+type);page.lang=value==='zh'?'zh-CN':'en';page.dataset.reportLanguage=value;return page;};
 const cover=front('cover');cover.id='report-page-1';cover.dataset.reportTitle=t('封面','Title page');
 cover.append(node('p','DL / WEIQI','report-cover-brand'),node('p',t('深度分析 · 棋局复盘','DEEP ANALYSIS / GAME REVIEW'),'report-cover-kicker'),node('h1',t('围棋 AI\n复盘报告','Go AI\nReview Report')),node('p',report.name,'report-cover-name'));
 const playerCards=node('div',undefined,'report-cover-players');
 for(const side of ['B','W']){const card=node('div',undefined,'report-cover-player report-cover-player-'+side);card.append(node('span',sideName(side),'report-cover-side'),node('strong',game.players[side==='B'?'black':'white']||'—'));playerCards.append(card);}
 cover.append(playerCards,node('p',result?t(result.zh,result.en):game.result||t('结果未记录','Result not recorded'),'report-cover-result'));
 const gameAddress='https://weiqi.dliu.com/record/'+id,gameLinkBox=node('p',undefined,'report-cover-link'),coverLink=node('a',gameAddress);coverLink.href=gameAddress;gameLinkBox.append(node('span',t('在线棋局','ONLINE GAME')),coverLink);cover.append(gameLinkBox);
 const metadata=entries=>{const grid=node('dl',undefined,'report-cover-data');for(const [label,value,wide] of entries){const entry=node('div',undefined,wide?'report-cover-data-wide':undefined);entry.append(node('dt',label),node('dd',value||'—'));grid.append(entry);}return grid;};
 cover.append(metadata([[t('棋局 ID','Game ID'),id],[t('棋局日期','Game date'),game.date],[t('规则','Rules'),rules],[t('棋盘','Board'),'19 × 19'],[t('贴目','Komi'),String(game.komi)],[t('实战手数','Recorded moves'),String(game.moves)]]));
 const publication=node('div',undefined,'report-cover-analysis');
 publication.append(node('h3',t('分析与报告元数据','ANALYSIS AND REPORT METADATA')),metadata([[t('引擎','Engine'),p.engine],[t('每个局面的访问量','Visits per position'),p.visits.toLocaleString(locale())],[t('模型','Model'),p.model,true],[t('模型 SHA-256','Model SHA-256'),p.modelSha256,true],[t('计算资源','Compute'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),true],[t('总分析时间（含排队与准备）','Analysis total including queue/setup'),duration],[t('报告语言','Report language'),t('中文','English')],[t('分析完成时间','Analysis completed'),timestamp(p.completedAt),true],[t('报告生成时间','Report prepared'),timestamp(report.generatedAt),true]]));
 cover.append(publication,node('p',t('图表复盘 · 双方各三个重点失误 · 图下附计算细节','Visual game review / Three key errors per side / Calculations beneath each graph'),'report-cover-scope'));
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
 $('save-report').textContent=saving?t('正在保存…','Saving…'):t('保存 PDF','Save PDF');
 for(const value of ['en','zh'])$(`report-${value}`).setAttribute('aria-pressed',String(reportLanguage===value));
 if(!report)return;
 $('report-content').replaceChildren(renderLanguage(reportLanguage));$('save-report').disabled=saving;$('report-status').textContent='';
}
for(const value of ['en','zh'])$(`report-${value}`).onclick=()=>{if(saving)return;reportLanguage=value;const url=new URL(location.href);url.searchParams.set('lang',value);history.replaceState(null,'',url);render();};
$('save-report').onclick=async()=>{
 if(!report||saving)return;
 saving=true;$('save-report').disabled=true;$('save-report').textContent=t('正在准备 PDF…','Preparing PDF…');
 for(const value of ['en','zh'])$(`report-${value}`).disabled=true;
 try{
  const {saveReportPdf}=await import('./report-pdf.js');
  await saveReportPdf(Array.from(document.querySelectorAll('.report-sheet')),id,reportLanguage,(done,total)=>{$('report-status').textContent=t('正在准备 PDF：','Preparing PDF: ')+done+' / '+total;});
  $('report-status').textContent=t('PDF 已准备好并开始下载。','PDF prepared; download started.');
 }catch(e){console.error('Report PDF failed',e);$('report-status').textContent=t('无法保存 PDF，请重试。','Unable to save PDF. Please try again.');}
 finally{saving=false;$('save-report').disabled=false;$('save-report').textContent=t('保存 PDF','Save PDF');for(const value of ['en','zh'])$(`report-${value}`).disabled=false;}
};
render();
try{if(!id)throw Error('Missing game ID.');report=selectReportHighlights(await libraryRequest('/api/library/'+encodeURIComponent(id)+'/report'));render();}catch(e){$('report-status').textContent=e.message;}
