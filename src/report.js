import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
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
function addStatistics(sheet){
 const stats=sheet(t('失误统计：黑白对比','Loss statistics: Black and White'));
 const value=(key,format=n=>number(n))=>['B','W'].map(side=>format(report.players[side][key]));
 const row=(zh,en,key,format)=>[t(zh,en),...value(key,format)],integer=n=>n??'—',percent=n=>Number.isFinite(n)?number(n)+'%':'—',worst=(key,moveKey,unit='')=>['B','W'].map(side=>number(report.players[side][key])+unit+(report.players[side][moveKey]!==null?' · '+t('第 ','Move ')+report.players[side][moveKey]:''));
 stats.append(table([t('统计项','Metric'),sideName('B'),sideName('W')],[row('实战手数','Recorded moves','moves',integer),row('已评定手数','Rated moves','ratedMoves',integer),row('未评定手数','Unrated moves','unratedMoves',integer),row('较差着法数量（点损失 >0.5）','Bad moves (>0.5 point loss)','badMoves',integer),row('较差着法比例','Bad moves / rated moves','badPercent',percent),[t('不精确（>0.5 至 2 点）','Inaccuracies (>0.5 to 2 points)'),...['B','W'].map(s=>report.players[s].counts.inaccuracy)],[t('失误（>2 至 5 点）','Mistakes (>2 to 5 points)'),...['B','W'].map(s=>report.players[s].counts.mistake)],[t('严重失误（>5 点）','Blunders (>5 points)'),...['B','W'].map(s=>report.players[s].counts.blunder)],row('累计较差着法点损失','Sum of bad-move point losses','totalBadPointLoss'),row('每手平均点损失（所有已评定着法）','Mean point loss / rated move','meanPointLoss'),row('较差着法平均点损失','Mean bad-move point loss','meanBadPointLoss'),row('较差着法点损失中位数','Median bad-move point loss','medianBadPointLoss'),row('较差着法点损失第 90 百分位','90th percentile bad-move loss','p90BadPointLoss'),[t('最大点损失 / 手数','Largest point loss / move'),...worst('maxBadPointLoss','worstPointLossMove')],row('所列五手累计点损失','Point loss in the five listed moves','topFiveBadPointLoss'),row('所列五手占较差着法点损失比例','Five listed moves / total bad-move loss','topFiveLossPercent',percent)]));
 stats.append(node('p',t('点损失是各独立局面的评估差相加，不是实际输赢目数；未评定着法不计入均值、比例或分位数。','Summed point losses combine evaluations from separate positions; they are not the final game margin. Unrated moves are excluded from means, percentages and percentiles.'),'report-note'));
 const win=sheet(t('胜率损失与错失机会','Win-probability losses and missed opportunities'));
 win.append(table([t('统计项','Metric'),sideName('B'),sideName('W')],[row('具有胜率评估的较差着法','Bad moves with win-rate evaluation','winrateRatedBadMoves',integer),row('较差着法平均胜率损失（百分点）','Mean bad-move win-rate loss (pp)','meanBadWinrateLoss'),[t('最大胜率损失 / 手数（百分点）','Largest win-rate loss / move (pp)'),...worst('maxBadWinrateLoss','worstWinrateLossMove')],row('胜率损失 ≥10 个百分点的着法','Moves losing ≥10 win-rate pp','winrateDrops10pp',integer),row('胜率损失 ≥20 个百分点的着法','Moves losing ≥20 win-rate pp','winrateDrops20pp',integer),row('错失可保留的点数领先','Moves missing an available point lead','availableLeadsLost',integer),row('错失可保留的 >50% 胜率','Moves missing an available >50% win rate','availableWinningChancesLost',integer),row('使用估计的较差着法','Bad moves using estimated played evaluations','badEstimatedMoves',integer)]));
 win.append(node('p',t('胜率损失采用落子一方的视角，以百分点计。错失领先表示 AI 首选仍为正分，而实战选点为负分；错失胜率表示 AI 首选胜率超过 50%，而实战选点低于 50%。这些统计仅针对较差着法，不累计胜率变化为全局百分比。','Win-rate losses use the played side’s perspective and percentage points (pp). A missed point lead means the AI recommendation retained a positive lead while the played move had a negative lead. A missed >50% chance means the recommendation exceeded 50% while the played move fell below 50%. These counts concern bad moves; win-rate changes are not summed into a game-wide percentage.'),'report-note'));
 const stages=sheet(t('手数区间与点损失分布','Move ranges and point-loss distribution'));
 stages.append(table([t('棋手','Side'),t('手数','Range'),t('已评定','Rated'),t('较差着法','Bad moves'),t('比例','Rate'),t('累计点损失','Sum loss'),t('平均较差着法损失','Mean bad loss')],['B','W'].flatMap(side=>report.players[side].segments.filter(s=>s.moves).map(s=>[sideName(side),s.from+'–'+s.to,s.ratedMoves,s.badMoves,percent(s.badPercent),number(s.totalBadPointLoss),number(s.meanBadPointLoss)]))));
 stages.append(node('p',t('区间固定为 1–60、61–180 和 181 手以后；不是自动识别的布局、中盘或官子。','Ranges are fixed at 1–60, 61–180 and 181 onward; they are not automatically detected game phases.'),'report-note'),node('h3',t('点损失分布','Point-loss distribution')));
 stages.append(table([t('点损失范围','Loss range'),t('黑方手数','Black count'),t('黑方累计损失','Black sum loss'),t('白方手数','White count'),t('白方累计损失','White sum loss')],report.players.B.lossBuckets.map((bucket,index)=>[(bucket.to===null?'>10':'> '+bucket.from+' – '+bucket.to),bucket.count,number(bucket.totalPointLoss),report.players.W.lossBuckets[index].count,number(report.players.W.lossBuckets[index].totalPointLoss)])));
 const timeline=sheet(t('较差着法发生在哪些位置','Where the bad moves occurred')),isBad=m=>['inaccuracy','mistake','blunder'].includes(m.quality)&&Number.isFinite(m.pointLoss)&&m.pointLoss>.5,series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isBad(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 timeline.append(node('h3',t('逐手点损失（仅较差着法）','Point loss by move (bad moves only)')),reportPlot(t('逐手点损失','Point loss by move'),series,{stems:true,yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y)))}));
 const cumulative=['B','W'].map(side=>{let total=0;const points=[{x:0,y:0}];for(const m of report.reviews){if(m.side===side&&isBad(m))total+=m.pointLoss;points.push({x:m.move,y:total});}return {side,points};});timeline.append(node('h3',t('累计较差着法点损失','Cumulative bad-move point loss')),reportPlot(t('累计较差着法点损失','Cumulative bad-move point loss'),cumulative,{yMax:Math.max(1,...cumulative.map(s=>s.points.at(-1).y))}),node('p',t('较大的点标出本报告详细分析的五个黑方与五个白方着法。累计曲线只表示损失集中在哪一段，不是实际比分。','Larger dots identify the five Black and five White moves detailed in this report. Cumulative curves show where losses accumulated; they are not actual scores.'),'report-note'));
 const context=sheet(t('这些着法前后的全局走势','Game context around the highlighted moves'));context.append(node('h3',t('黑方胜率','Black win probability')),contextChart('win'),node('h3',t('点数优势：黑方为正，白方为负','Point advantage: positive for Black, negative for White')),contextChart('score'),node('p',t('深色标记为所列黑方着法，橙色为所列白方着法。走势图采用棋谱各实战局面的独立评估；单手损失则比较 AI 首选与实战选点。','Dark markers identify the listed Black moves; orange markers identify the listed White moves. Trends use independently analysed recorded positions; move losses compare the recommended and played choices.'),'report-note'));
}
function renderLanguage(value){
 reportLanguage=value;
 const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.lang=value==='zh'?'zh-CN':'en';e.dataset.reportLanguage=value;e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),rules=({japanese:t('日本规则','Japanese rules'),chinese:t('中国规则','Chinese rules'),aga:t('AGA 规则','AGA rules'),korean:t('韩国规则','Korean rules')})[game.rules?.toLowerCase()]||game.rules,gameLabel=t('黑方：','Black: ')+(game.players.black||'—')+' · '+t('白方：','White: ')+(game.players.white||'—');
 const overview=sheet(t('AI 棋局复盘报告 · 中文','AI game review report · English'));overview.append(node('p',report.name,'report-game'),node('p',gameLabel,'report-game'),node('p',[result?t(result.zh,result.en):game.result,game.date,rules,t('贴目 ','Komi ')+game.komi,t('共 '+game.moves+' 手',game.moves+' moves')].filter(Boolean).join(' · ')));
 const p=report.provenance,c=p.compute||{},duration=Number.isFinite(p.endToEndMs)?Math.round(p.endToEndMs/60000)+t(' 分钟',' min'):'—';overview.append(node('p',[p.engine+' · '+p.model,p.visits.toLocaleString(locale())+t(' 次访问 / 局面',' visits / position'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),t('分析总时间（含排队和准备）：','Analysis total including queue/setup: ')+duration,t('分析完成：','Analysis completed: ')+timestamp(p.completedAt)].join('\n'),'report-meta'));
 overview.append(node('p',t('分别列出黑方和白方点损失最大的五个较差着法，以及 AI 推荐变化。若一方没有五个符合条件的着法，只列出实际找到的数量。','The five moves with the largest estimated point losses for each side, with AI recommended continuations. If fewer than five qualify, only the available moves are listed.')));
 for(const side of ['B','W']){
  const colour=side==='B'?t('黑方','Black'):t('白方','White'),name=game.players[side==='B'?'black':'white']||'—',moves=report.problems.filter(m=>m.side===side).slice(0,5);
  overview.append(node('h3',colour+' · '+name));
  if(moves.length)overview.append(table([t('手数','Move'),t('实战','Played'),t('点损失','Point loss'),t('AI 首选','AI best')],moves.map(m=>[m.move,m.played,number(m.pointLoss),m.best.move])));
  else overview.append(node('p',t('未找到点损失超过 0.5 的已评定着法。','No rated moves losing more than 0.5 points were found.')));
 }
 addStatistics(sheet);
 for(const side of ['B','W'])for(const [index,m] of report.problems.filter(m=>m.side===side).slice(0,5).entries()){
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
 overview.append(node('p',t('按棋手视角的估计点损失排序，仅列出损失超过 0.5 点的着法。报告复用已保存的深度分析，不启动新分析。','Ranked by estimated point loss from the player’s perspective; only moves losing more than 0.5 points are included. The report reuses saved deep analysis and starts no new analysis.'),'report-note'));
 for(const [n,s] of sheets.entries()){const footer=node('footer',undefined,'report-footer');footer.append(node('span','weiqi.dliu.com/record/'+id),node('span',t('中文','English')+' · '+(n+1)+' / '+sheets.length));s.append(footer);}
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
try{if(!id)throw Error('Missing game ID.');report=await libraryRequest('/api/library/'+encodeURIComponent(id)+'/report');render();}catch(e){$('report-status').textContent=e.message;}
