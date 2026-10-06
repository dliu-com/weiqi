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
 const integer=n=>n??'—',percent=n=>Number.isFinite(n)?number(n)+'%':'—',summary=side=>side==='all'?report.overall:report.players[side];
 const sides=['B','W','all'],headers=[t('统计项','Metric'),sideName('B'),sideName('W'),t('全局','Whole game')];
 const value=(key,format=n=>number(n,2))=>sides.map(side=>format(summary(side)[key]));
 const row=(zh,en,key,format)=>[t(zh,en),...value(key,format)];
 const worst=(key,moveKey)=>sides.map(side=>{const s=summary(side);return number(s[key],2)+(s[moveKey]!=null?' · '+t('第 ','Move ')+s[moveKey]:'');});
 const names={best:t('AI 首选','AI first choice'),good:t('好棋','Good'),...qualities()};
 const quality=sheet(t('所有着法：质量与评估覆盖率','All moves: quality and evaluation coverage'));
 quality.append(table(headers,[row('实战手数','Recorded moves','moves',integer),row('已评定手数 N','Rated moves N','ratedMoves',integer),row('未评定手数','Unrated moves','unratedMoves',integer),row('评估覆盖率','Evaluation coverage','coveragePercent',percent),...Object.entries(names).map(([key,label])=>[label,...sides.map(side=>{const s=summary(side);return s.counts[key]+' · '+percent(s.qualityBreakdown.find(m=>m.quality===key).percentage);})]),row('损失 ≤0.5 点','Loss ≤0.5 points','withinHalfPointPercent',percent),row('损失 ≤1 点','Loss ≤1 point','withinOnePointPercent',percent),row('损失 ≤2 点','Loss ≤2 points','withinTwoPointsPercent',percent),row('直接搜索的实战选点','Sufficiently searched played choices','searchedMoves',integer),row('使用后续局面估计的选点','Choices estimated from the following position','estimatedMoves',integer)]));
 quality.append(node('p',t('AI 首选表示坐标与引擎排名第一的选点相同，损失记为 0；不代表客观完美。其余着法按点损失分类：好棋 ≤0.5，不精确 >0.5 至 2，失误 >2 至 5，严重失误 >5。质量百分比的分母是本方已评定着法，不包含未评定着法；全局统计合并双方原始数据，不平均双方百分比。','AI first choice means the played coordinate matches the engine’s top choice; its loss is recorded as zero. It does not establish objective perfection. Other moves are classified by point loss: good ≤0.5; inaccuracy >0.5 to 2; mistake >2 to 5; blunder >5. Quality percentages use that side’s rated moves, excluding unrated moves. Whole-game metrics pool both sides’ move data rather than averaging their percentages.'),'report-note'));
 const stats=sheet(t('所有已评定着法：点损失统计','All rated moves: point-loss statistics'));
 stats.append(table(headers,[row('累计点损失 T','Total point loss T','totalPointLoss'),row('平均点损失 μ','Mean point loss μ','meanPointLoss'),row('点损失中位数 Q₅₀','Median point loss Q₅₀','medianPointLoss'),row('点损失第 90 百分位 Q₉₀','90th percentile loss Q₉₀','p90PointLoss'),row('点损失第 95 百分位 Q₉₅','95th percentile loss Q₉₅','p95PointLoss'),row('总体标准差 σ','Population standard deviation σ','stdPointLoss'),row('均方根损失 RMS','Root mean square loss RMS','rmsPointLoss'),[t('最大点损失 / 手数','Maximum point loss / move'),...worst('maxPointLoss','worstPointLossMove')],row('直接搜索选点的平均损失','Mean loss: searched choices','searchedMeanPointLoss'),row('估计选点的平均损失','Mean loss: estimated choices','estimatedMeanPointLoss'),row('较差着法的累计点损失','Total loss from bad moves','totalBadPointLoss'),row('较差着法的平均点损失','Mean loss among bad moves','meanBadPointLoss'),row('损失最大的五手累计损失','Loss in the five worst moves','topFivePointLoss'),row('损失最大的五手 / 所有着法累计损失','Five worst / total loss across all moves','topFiveLossPercent',percent)]));
 stats.append(node('p',t('均值、分位数、标准差与 RMS 包括所有已评定着法（含 AI 首选和好棋的低损失或零损失）。RMS 更强调大失误，标准差描述损失波动。累计损失相加的是独立局面中的决策损失，不是最终比分；全局“五手”指双方合并后的五手。','Means, quantiles, standard deviation and RMS include every rated move, including small or zero losses for good moves and AI first choices. RMS gives larger errors more weight; standard deviation describes variation. Total loss sums decision losses from separate positions, not the final game score. The whole-game “five worst” are selected from both sides combined.'),'report-note'));
 const win=sheet(t('所有已评定着法：胜率损失与错失机会','All rated moves: win-rate losses and missed opportunities'));
 win.append(table(headers,[row('有胜率损失数据的手数 M','Moves with win-loss data M','winrateRatedMoves',integer),row('缺少胜率数据的已评定手数','Rated moves missing win-loss data','winrateUnratedMoves',integer),row('平均胜率损失（百分点）','Mean win-rate loss (pp)','meanWinrateLoss'),row('胜率损失中位数（百分点）','Median win-rate loss (pp)','medianWinrateLoss'),row('胜率损失第 90 百分位（百分点）','90th percentile win-rate loss (pp)','p90WinrateLoss'),row('胜率损失总体标准差（百分点）','Population SD of win-rate loss (pp)','stdWinrateLoss'),[t('最大胜率损失 / 手数（百分点）','Maximum win-rate loss / move (pp)'),...worst('maxWinrateLoss','worstWinrateLossMove')],row('胜率损失 ≥5 个百分点的手数','Moves losing ≥5 win-rate pp','winrateDrops5pp',integer),row('胜率损失 ≥10 个百分点的手数','Moves losing ≥10 win-rate pp','winrateDrops10pp',integer),row('胜率损失 ≥20 个百分点的手数','Moves losing ≥20 win-rate pp','winrateDrops20pp',integer),row('错失可保留的点数领先','Moves missing an available point lead','availableLeadsLost',integer),row('错失可保留的 >50% 胜率','Moves missing an available >50% win rate','availableWinningChancesLost',integer)]));
 win.append(node('p',t('这些统计包含所有具有相应数据的已评定着法，无论点损失评级。胜率采用落子一方的视角；如 70% 降至 50%，损失为 20 个百分点。胜率损失不会相加为全局输赢概率。错失领先：AI 首选领先 >0 点而实战落后 <0 点；错失胜率：AI 首选 >50% 而实战 <50%。','These metrics include all rated moves with the required data, regardless of point-loss category. Win probability uses the played side’s perspective: a drop from 70% to 50% is 20 percentage points. Losses are not summed into a game-wide win probability. A missed lead means the recommendation leads by >0 points while the played move trails by <0; a missed winning chance crosses from >50% to <50%.'),'report-note'));
 const categories=sheet(t('各类着法的损失与估计数量','Losses and estimates within each move quality'));
 categories.append(table([t('棋手','Side'),t('着法类别','Quality'),t('手数','Moves'),t('平均点损失','Mean point loss'),t('平均胜率损失（百分点）','Mean win loss (pp)'),t('估计手数','Estimated moves')],['B','W'].flatMap(side=>report.players[side].qualityBreakdown.map(q=>[sideName(side),names[q.quality],q.count,number(q.meanPointLoss,2),number(q.meanWinrateLoss,2),q.estimatedMoves]))));
 categories.append(node('p',t('“—”表示该类别没有可用数据，不是 0。某着法若未找到实战候选或候选访问量不足，其评估取自下一实战局面；这些估计仍进入统计，但单独报告数量和均值。直接搜索阈值为 max(2, AI 首选访问量 × 3%)。','“—” means no usable data, not zero. If a played candidate is absent or has insufficient visits, its evaluation comes from the next recorded position. Estimates remain in the metrics and their count/mean are shown separately. The sufficient-search threshold is max(2, top-choice visits × 3%).'),'report-note'));
 const stages=sheet(t('所有着法：手数区间比较','All moves: comparison by move range'));
 stages.append(table([t('棋手 / 区间','Side / range'),t('已评定','Rated'),t('首选率','First-choice %'),t('损失 ≤0.5','Loss ≤0.5 %'),t('平均损失','Mean loss'),t('第 90 百分位','90th percentile'),t('累计损失','Total loss')],['B','W'].flatMap(side=>report.players[side].segments.filter(s=>s.moves).map(s=>[sideName(side)+' '+s.from+'–'+s.to,s.ratedMoves,percent(s.bestMatchPercent),percent(s.withinHalfPointPercent),number(s.meanPointLoss,2),number(s.p90PointLoss,2),number(s.totalPointLoss,2)]))));
 stages.append(node('h3',t('区间内各类着法数量','Move-quality counts within each range')),table([t('棋手 / 区间','Side / range'),...Object.values(names)],['B','W'].flatMap(side=>report.players[side].segments.filter(s=>s.moves).map(s=>[sideName(side)+' '+s.from+'–'+s.to,...Object.keys(names).map(key=>s.counts[key])]))),node('p',t('区间固定为 1–60、61–180 和 181 手以后，不是自动识别的布局、中盘或官子。区间指标包括所有已评定着法。','Ranges are fixed at 1–60, 61–180 and 181 onward, not automatically detected opening, middle game or endgame. Range metrics include every rated move.'),'report-note'));
 const distribution=sheet(t('所有已评定着法：点损失分布','All rated moves: point-loss distribution'));
 const bucketLabel=b=>b.to===0?'0':b.to===null?'>10':'> '+b.from+' – '+b.to;
 distribution.append(table([t('点损失范围','Loss range'),t('黑方手数 / 比例','Black count / %'),t('黑方累计损失','Black total loss'),t('白方手数 / 比例','White count / %'),t('白方累计损失','White total loss')],report.players.B.lossBuckets.map((b,i)=>{const w=report.players.W.lossBuckets[i];return [bucketLabel(b),b.count+' · '+percent(b.percentage),number(b.totalPointLoss,2),w.count+' · '+percent(w.percentage),number(w.totalPointLoss,2)];})));
 distribution.append(node('p',t('分布包含零损失与低损失，六个区间互不重叠并覆盖所有已评定着法。未评定着法不作为零损失加入。百分比独立四舍五入，显示值之和可能略有偏差。','Zero and small losses are included. The six non-overlapping bins cover every rated move. Unrated moves are never counted as zero loss. Independently rounded percentages may not sum to exactly 100%.'),'report-note'));
 const timeline=sheet(t('所有已评定着法：逐手与累计损失','All rated moves: per-move and cumulative losses')),isRated=m=>Object.hasOwn(names,m.quality)&&Number.isFinite(m.pointLoss),series=['B','W'].map(side=>({side,points:report.reviews.filter(m=>m.side===side&&isRated(m)).map(m=>({x:m.move,y:m.pointLoss}))}));
 timeline.append(node('h3',t('逐手点损失（所有已评定着法）','Point loss by move (all rated moves)')),reportPlot(t('逐手点损失','Point loss by move'),series,{stems:true,yMax:Math.max(1,...series.flatMap(s=>s.points.map(p=>p.y)))}));
 const cumulative=['B','W'].map(side=>{let total=0;const points=[{x:0,y:0}];for(const m of report.reviews){if(m.side===side&&isRated(m))total+=m.pointLoss;points.push({x:m.move,y:total});}return {side,points};});
 timeline.append(node('h3',t('所有着法累计点损失','Cumulative point loss across all moves')),reportPlot(t('累计点损失','Cumulative point loss'),cumulative,{yMax:Math.max(1,...cumulative.map(s=>s.points.at(-1).y))}),node('p',t('较大的点标出本报告展示棋盘的五个黑方与五个白方较差着法。图表包含所有已评定着法，零损失位于基线；未评定着法没有点。累计曲线不是实际比分。','Larger dots mark the five Black and five White bad moves with board diagrams. Charts include every rated move, with zero loss on the baseline; unrated moves have no point. Cumulative curves are not actual scores.'),'report-note'));
 const context=sheet(t('全局评估走势','Game-wide evaluation trends'));
 context.append(node('h3',t('黑方胜率','Black win probability')),contextChart('win'),node('h3',t('点数优势：黑方为正，白方为负','Point advantage: positive for Black, negative for White')),contextChart('score'),node('p',t('走势使用所有实战局面的评估，标记表示所列较差着法。走势的相邻变化与单手损失不同：单手损失比较同一决策点的 AI 首选与实战选择。','Trends use every recorded position; markers identify the listed bad moves. Adjacent trend changes differ from move loss, which compares the AI recommendation and played choice at one decision point.'),'report-note'));
 const math=sheet(t('计算方法：视角、点损失与胜率','Calculations: perspective, point loss and win probability'));
 const formula=(parent,expression,zh,en)=>{parent.append(node('p',expression,'report-formula'),node('p',t(zh,en),'report-note'));};
 formula(math,'sᵢ = +1 (Black / 黑方), −1 (White / 白方)', '第 i 手取落子方视角。S 是黑方领先点数，P 是黑方胜率（0 至 1）；下标 best 为 AI 首选，played 为实战选点。','For move i, use the played side’s perspective. S is Black’s point lead and P is Black’s win probability (0 to 1); best denotes the AI first choice and played the recorded choice.');
 formula(math,'Lᵢ = max(0, sᵢ × (Sᵢ,best − Sᵢ,played))','点损失 Lᵢ 不小于 0。实战就是 AI 首选时 Lᵢ=0。估计选点使用下一实战局面的评估；不同搜索结果的微小差异不当作收益累加。','Point loss Lᵢ is non-negative; a recorded AI first choice has Lᵢ=0. Estimated played choices use the next recorded position. Small discrepancies between searches are clamped rather than accumulated as gains.');
 formula(math,'Wᵢ = max(0, 100 × sᵢ × (Pᵢ,best − Pᵢ,played))','Wᵢ 的单位是胜率百分点，不是相对百分比。实战为 AI 首选时 Wᵢ=0；缺失胜率数据不计入 M。','Wᵢ is in percentage points, not a relative percentage. A recorded AI first choice has Wᵢ=0; missing win data is excluded from M.');
 formula(math,'Coverage = 100 × N / recorded moves','N 为已评定着法数。未评定着法不计入损失、质量比例或分位数；覆盖率的分母包含全部实战着法。','N counts rated moves. Unrated moves are excluded from loss statistics, quality percentages and quantiles; coverage uses all recorded moves as its denominator.');
 formula(math,'Quality % = 100 × category count / N','AI 首选按坐标匹配优先判定；其他着法按 Lᵢ 分类：好棋 [0,0.5]；不精确 (0.5,2]；失误 (2,5]；严重失误 (5,∞)。','AI first choice is identified by coordinate match first. Other moves use Lᵢ: good [0,0.5]; inaccuracy (0.5,2]; mistake (2,5]; blunder (5,∞).');
 const maths=sheet(t('计算方法：均值、离散程度与分位数','Calculations: averages, spread and quantiles'));
 formula(maths,'T = Σ Lᵢ;   μ = T / N','累计与平均包括所有 N 个已评定着法；零损失也进入均值。','Total and mean include all N rated moves; zero losses remain in the mean.');
 formula(maths,'σ = √(Σ (Lᵢ − μ)² / N)','使用总体标准差，分母为 N，而不是 N−1。报告描述的是已保存的着法集合，不是推断棋力。','Population standard deviation uses N, not N−1. It describes the saved move set, not an inferred playing strength.');
 formula(maths,'RMS = √(Σ Lᵢ² / N) = √(μ² + σ²)','RMS 对大损失给予更高权重。没有已评定着法时，均值、标准差和 RMS 均显示“—”。','RMS weights larger losses more strongly. With no rated moves, mean, SD and RMS display “—”.');
 formula(maths,'h = (N−1)q; k = floor(h); Qq = xₖ + (h−k)(x⌈h⌉ − xₖ)','将损失升序排列为 x₀…xN−1，按线性插值计算 q=0.50、0.90、0.95 的分位数；N=1 时均为唯一的损失值。','Sort losses as x₀…xN−1 and linearly interpolate quantiles q=0.50, 0.90, 0.95. With N=1 each quantile is the sole value.');
 formula(maths,'Mean win loss = Σ Wᵢ / M;   top-five share = 100 × Σ five largest Lᵢ / T','胜率指标使用具有胜率损失数据的 M 手。五手集中度按全部累计点损失 T 计算；T=0 时显示“—”。','Win-loss metrics use the M moves with win data. Top-five concentration uses total loss T across all rated moves; T=0 displays “—”.');
 const example=sheet(t('本局计算示例与解读','Worked calculations from this game'));
 for(const side of ['B','W']){
  const s=report.players[side];example.append(node('h3',sideName(side)+' · '+(s.name||'—')));
  formula(example,'μ = '+number(s.totalPointLoss,3)+' / '+s.ratedMoves+' = '+number(s.meanPointLoss,3), '所有已评定着法的平均点损失，含首选与好棋。','Mean point loss over every rated move, including first choices and good moves.');
  formula(example,'AI first choice % = '+s.counts.best+' / '+s.ratedMoves+' × 100 = '+(Number.isFinite(s.bestMatchPercent)?number(s.bestMatchPercent,2)+'%':'—'),'坐标匹配率与点损失均值测量不同方面；同等优秀的另一选点可能不算首选匹配。','Coordinate-match rate and mean loss measure different aspects; an equally strong alternative may not match the first choice.');
  formula(example,'RMS = √('+number(s.meanPointLoss,3)+'² + '+number(s.stdPointLoss,3)+'²) ≈ '+number(s.rmsPointLoss,3),'公式使用未四舍五入的数据计算，显示值仅作示例。','Calculations use unrounded data; displayed values are rounded examples.');
 }
 example.append(node('p',t('报告统计描述这一次模型与访问量下的引擎评估，不给出虚构的 Elo、段位或准确率。好棋与首选计入统计，但具体棋盘图仍只展示双方各五个较差着法。','These statistics describe this model and visit setting, without inventing Elo, rank or a calibrated accuracy score. Good moves and first choices count in statistics; exact board diagrams remain limited to five bad moves per side.'),'report-note'));
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
 overview.append(node('p',t('按棋手视角的估计点损失排序，棋盘图仅列出损失超过 0.5 点的着法，统计包括所有已评定着法。报告复用已保存的深度分析，不启动新分析。','Ranked by estimated point loss from the player’s perspective; board diagrams include only moves losing more than 0.5 points; statistics include all rated moves. The report reuses saved deep analysis and starts no new analysis.'),'report-note'));
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
