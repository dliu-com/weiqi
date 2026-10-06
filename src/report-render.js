import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
import {reportPagination} from './report-document.js';
import {selectReportHighlights} from './report-highlights.js';
import {comparisonChart,compositionChart,qualityLegend} from './report-stat-charts.js';
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
  ['各类着法占比','Share of each move quality','每条横条是一方的全部已评定着法，合计为 100%。深绿色是 AI 首选，浅绿色是损失很小的好棋；黄色、橙色和红色表示越来越大的损失。下方小表保留各类的确切手数。\n\n想改善稳定性，先看橙色和红色的比例，再结合后面的失误表复盘。绿色多表示更多决策接近 AI 推荐，但不代表这个棋手必然更强：局面简单、对手较弱或已经大幅领先，都可能让正确选点更容易。','Each bar represents all rated moves by that player and adds up to 100%. Dark green is the AI’s first choice; light green means a move gave up very little. Yellow, orange and red show increasingly costly decisions. The small table keeps the exact counts.\n\nTo improve consistency, first look at orange and red, then find those decisions in the error tables. More green means more decisions stayed close to the AI recommendation. It is easier to find good moves in simple positions, so this chart alone does not measure playing strength.'],
  ['典型损失与较大失误','Typical loss and bigger errors','点损失比较同一局面下的实战选点与 AI 首选。例如，对本方来说，首选预计领先 5 点，而实战选点预计领先 2 点，这手损失约 3 点。它不是棋盘上立即被提走了三颗棋子，也不是相邻两手领先数的简单差值。\n\n“平均损失”概括全部已评定着法，容易被少数大失误拉高。“中间一手”表示一半着法损失不超过该值。“90% 界线”表示九成着法在此值以内，另外一成损失更大。平均值较高但中位数很低时，可先复盘最大的失误；这通常比逐手追求零损失更有针对性。','Point loss compares your played move with the AI’s preferred move from the same starting position. For example, if the preferred move leaves your side 5 points ahead and your move leaves it 2 points ahead, the estimated loss is 3 points. It is not necessarily three captured stones, and it is not simply the change between consecutive positions.\n\nAverage includes every rated move and can rise because of a few large errors. Middle move means half the moves lost no more than that value. The 90% cutoff means nine out of ten moves stayed below it; the remaining tenth lost more. If the average is high but the middle value is low, studying the largest errors is a useful starting point.'],
  ['各区间的平均点损失','Average point loss in each range','每一组比较双方在同一手数区间内的平均点损失，条形越长，平均损失越大。1–60、61–180、181 手以后是固定区间，并不一定等于这一局真实的布局、中盘、官子分界。\n\n找出自己最长的一条，再去关键时刻表中找属于那个区间的失误。它提示“哪段决策值得多复盘”，不能单凭这个数字断定你不擅长某个阶段；不同区间的局面复杂程度和着法数量不同。','Each pair compares the players’ average point loss over the same move range. A longer bar means more advantage was given up per rated move. The ranges 1–60, 61–180 and 181 onward are fixed; they do not necessarily match this game’s actual opening, middle game and endgame.\n\nFind your longest bar, then locate errors from that range in Key moments. This shows where to focus your review. It does not prove a weakness in a particular phase, because the difficulty and number of decisions vary across ranges.'],
  ['每手损失在哪里发生？','Where did each move lose points?','横轴是实战手数，尖峰高度是这一手相比 AI 首选损失的点数。深色为黑方，橙色为白方；一局中可以有很多小损失，却只有少数明显的大尖峰。大圆点标出后面有详细棋盘复盘的三手黑方与三手白方失误。\n\n下方分别按点损失列出双方前五个失误；其中前三个提供详细棋盘页，第四、第五个可通过手数链接回到棋局查看。点损失和胜率损失回答不同问题：已经明显输赢时，几目的损失可能只改变很小的获胜概率。','The horizontal axis is the recorded move number. Each spike shows the points given up compared with the AI’s preferred move: dark for Black and orange for White. A game can contain many small losses and only a few large spikes. Larger dots mark the three errors per side reviewed on detailed board pages.\n\nThe tables list each side’s five worst moves by point loss. The first three receive detailed board reviews; the fourth and fifth can be opened in the game through their move links. Point loss and win-probability loss answer different questions: several points may barely change the winning chance when the result is already very likely.'],
  ['黑方胜率','Black win probability','横轴是手数，纵轴是 AI 对黑方获胜机会的估计。50% 附近表示双方机会接近；80% 表示模型更看好黑方，并不表示黑方领先 80 点，白方仍有约 20% 的获胜机会。\n\n用这张图找到局势变得悬殊或重新接近的时刻，再结合点数图和失误表定位决策。接近 0% 或 100% 后，曲线可能几乎不动，即使点数仍在变化。相邻局面的胜率变化也不能全部归因于刚下的一手，因为 AI 评估本身会波动。','Read left to right by move number. The height is the AI’s estimated chance that Black wins. Around 50% means similar chances. At 80%, the model favours Black and gives White about 20%; it does not mean Black leads by 80 points.\n\nUse this to find when the game became one-sided or returned to a close contest, then compare the point-lead graph and error tables. Near 0% or 100%, the curve can barely move while the point advantage still changes. A change between neighbouring positions is not an exact measure of the last move’s quality, because AI estimates also vary.'],
  ['点数优势：正为黑，负为白','Point advantage: positive Black, negative White','横轴是手数，零线表示预计点数接近。曲线在 +5 时，AI 预计黑方领先约 5 点；在 −5 时，预计白方领先约 5 点。穿过零线表示预计领先方改变。最后记录的比赛结果仍以棋谱为准。\n\n先找明显转折，再看对应的失误表与棋盘变化。深色和橙色圆点分别标出后面详细复盘的黑方和白方失误。曲线显示“局面发生了什么”，后面的点损失统计才比较“同一局面还有什么更好的选择”。','Read left to right by move number. Zero means the estimated score is close. At +5 the AI expects Black to lead by about 5 points; at −5 it expects White to lead by about 5. Crossing zero means the estimated leading side changed. The recorded game result remains the official result of this game.\n\nLook for large changes, then use the error tables and board diagrams to investigate the decisions around them. Dark and orange dots identify Black and White errors reviewed later. This graph tells the game’s story; point-loss statistics compare the played move with a better choice from the same position.']
 ];
 const reading=guides.find(g=>g[0]===title||g[1]===title);return reading?t(reading[2],reading[3]):'';
}
function statisticGraph(title,visual,formula,zh,en){
 const figure=node('figure',undefined,'report-stat-card'),caption=node('figcaption',undefined,'report-graph-maths');
 figure.append(node('h3',title),visual);for(const text of graphReading(title).split('\n\n'))caption.append(node('p',text,'report-graph-reading'));caption.append(node('h4',t('计算细节 · 供技术读者参考','Calculation details · for technical readers')),node('p',formula,'report-formula'),node('p',t(zh,en),'report-note'));figure.append(caption);return figure;
}
function addStatistics(sheet){
 const keys=['best','good','inaccuracy','mistake','blunder'],names={best:t('AI 首选','AI first choice'),good:t('好棋','Good'),...qualities()},sides={B:sideName('B'),W:sideName('W')};
 const rows=definitions=>definitions.map(([key,zh,en])=>({key,label:t(zh,en),values:['B','W'].map(side=>report.players[side][key])}));
 const compare=(title,definitions,options={})=>comparisonChart(title,rows(definitions),{names:sides,...options});
 const graph=(parent,title,svg,formula,zh,en)=>parent.append(statisticGraph(title,svg,formula,zh,en));
 const context=sheet(t('全局走势：谁在领先？','Game-wide point advantage'));
 graph(context,t('点数优势：正为黑，负为白','Point advantage: positive Black, negative White'),contextChart('score'),'Displayed point advantage = S(position), from Black’s perspective',
 'S>0 表示黑方领先，S<0 表示白方领先；这是该模型与访问量下的预估优势，不是最终结算目数。黑方标记为深色、白方标记为橙色。',
 'S>0 means Black leads and S<0 means White leads. This is the estimated advantage under this model and visit setting, not the final scored margin. Dark markers represent Black and orange markers White.');
 const winning=sheet(t('全局走势：获胜机会怎样变化？','Game-wide winning chances'));
 graph(winning,t('黑方胜率','Black win probability'),contextChart('win'),'Displayed Black win % = 100 × P(position)',
 'P 为当前实战局面中黑方的引擎胜率，白方胜率为 100% 减去该值。标记为报告列出的失误。相邻局面的变化不是单手损失，单手损失比较同一决策点的首选与实战。',
 'P is the engine’s Black win probability at that recorded position; White’s is 100% minus this value. Markers identify listed errors. Adjacent position changes are not move loss, which compares best and played choices at one decision point.');
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
 const ranges=report.players.B.segments.filter(s=>s.moves||report.players.W.segments.find(w=>w.from===s.from)?.moves);
 const rangeRows=metric=>ranges.map(range=>({key:metric+'-'+range.from,label:range.from+'–'+range.to,values:['B','W'].map(side=>report.players[side].segments.find(s=>s.from===range.from)[metric])}));
 const stages=sheet(t('不同手数区间的损失','Losses across move ranges'));
 graph(stages,t('各区间的平均点损失','Average point loss in each range'),comparisonChart(t('区间平均损失','Mean loss by range'),rangeRows('meanPointLoss'),{names:sides,digits:2}),'Range mean = Σ Lᵢ in range / rated moves in range',
 '区间固定为 1–60、61–180 和 181 手以后，不是自动识别的棋局阶段。条形均值使用本方在该区间的所有已评定着法，包括首选与好棋。',
 'Ranges are fixed at 1–60, 61–180 and 181 onward, not automatically detected game phases. Each mean uses that side’s rated moves in the range, including first choices and good moves.');
 const timeline=sheet(t('值得复盘的关键时刻','Key moments to review')),isRated=m=>keys.includes(m.quality)&&Number.isFinite(m.pointLoss),series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isRated(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 graph(timeline,t('每手损失在哪里发生？','Where did each move lose points?'),reportPlot(t('逐手点损失','Point loss by move'),series,{stems:true,yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y)))}),'Each stem = Lᵢ = max(0, sᵢ(Sbest−Splayed))',
 '横轴是实战手数，纵轴是该手点损失。零损失位于基线，未评定着法没有点。较大的圆点标出展示棋盘的三个黑方与三个白方失误。',
 'The horizontal axis is the recorded move number; height is that move’s point loss. Zero losses lie on the baseline; unrated moves have no point. Larger dots identify the three Black and three White errors with board diagrams.');
 const keyTable=sheet(t('关键时刻：双方各五手失误','Key moments: five errors per side'));
 keyTable.append(node('p',t('这是优先复盘清单。双方分别选出点损失最大的五手，前三手在后文配有棋盘图；点击手数可回到棋局，点击页码可跳到详细复盘。','Use this as your review shortlist. Each side’s five largest point losses are listed. The first three have board diagrams later; select a move number to replay it, or a page link to jump to its detailed review.')));
 for(const side of ['B','W']){
  const moves=report.keyMoves[side],reviewed=new Set(report.problems.filter(m=>m.side===side).map(m=>m.nodeId));
  keyTable.append(node('h3',sideName(side)+' · '+t('点损失最大的五手','Five largest point losses')));
  if(!moves.length){keyTable.append(node('p',t('未找到损失超过 0.5 点的已评定失误。','No rated errors losing more than 0.5 points were found.'),'report-note'));continue;}
  const grid=table([t('手数','Move'),t('实战','Played'),t('点损失','Point loss'),t('胜率损失','Win loss'),t('后续复盘','Follow-up review')],moves.map(m=>[m.move,m.played,(m.estimated?'≈ ':'')+number(m.pointLoss),number(m.winrateLoss)+t(' 个百分点',' pp'),reviewed.has(m.nodeId)?t('后文棋盘详解','Detailed board review'):t('棋局回放','Game replay')]));
  for(const [index,row] of [...grid.tBodies[0].rows].entries()){
   const m=moves[index],link=node('a',String(m.move));row.className='report-key-move'+(reviewed.has(m.nodeId)?' report-key-reviewed':'');link.href='https://weiqi.dliu.com/record/'+id+'?move='+m.nodeId;row.cells[0].replaceChildren(link);
   if(reviewed.has(m.nodeId)){const detail=node('a',t('后文棋盘详解','Detailed board review'));detail.dataset.reviewMove=String(m.move);detail.dataset.reviewSide=side;row.cells[4].replaceChildren(detail);}
  }
  keyTable.append(grid);
 }
 keyTable.append(node('p',t('按本方点损失从大到小排序；不足五手时只列出实际找到的失误。“≈”表示搜索不足，采用落子后局面估计；胜率损失以百分点计。双方各前三手会在后文详细复盘。','Sorted by point loss for the played side; fewer than five are listed when fewer qualify. “≈” marks an estimate from the following position when the played move had insufficient search. Win loss is in percentage points. The first three per side are reviewed in detail later.'),'report-note'));

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
 cover.append(metadata([[t('棋局 ID','Game ID'),id],[t('棋局日期','Game date'),game.date],[t('规则','Rules'),rules],[t('棋盘','Board'),'19 × 19'],[t('贴目','Komi'),String(game.komi)],[t('实战手数','Recorded moves'),String(game.moves)]]));
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
