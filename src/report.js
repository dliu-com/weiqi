import {t,setLanguage} from './i18n.js';
import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {chartGeometry} from './evaluation-chart.js';
import {gameResult} from './game-result.js';
import {gtpPoint} from './ai-review.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/record\/([^/]+)\/report\/?$/)?.[1]||new URLSearchParams(location.search).get('game');
let report=null;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
const qualities=()=>({best:t('最佳','Best'),good:t('好棋','Good'),inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')});
function table(headers,rows){const e=node('table',undefined,'report-table'),head=node('thead'),h=node('tr');for(const text of headers)h.append(node('th',text));head.append(h);e.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const text of cells)row.append(node('td',text));body.append(row);}e.append(body);return e;}
function diagram(board,caption,labels=[],single=false){const f=node('figure',undefined,'report-board'+(single?' single':''));f.append(boardDiagram(board,{labels}),node('figcaption',caption));return f;}
function chart(mode){const wrap=node('div',undefined,'report-chart'),g=chartGeometry(report.chart,760,165,mode),ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 760 165');svg.setAttribute('role','img');svg.setAttribute('aria-label',mode==='win'?'Black win probability':'Black point advantage');
 const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);};
 for(const value of [-g.extent,0,g.extent]){add('line',{x1:g.left,y1:g.y(value),x2:g.width-g.right,y2:g.y(value),stroke:'#c4cdd3','stroke-width':.7});add('text',{x:g.left-6,y:g.y(value)+3,'text-anchor':'end','font-size':10,fill:'#56626a'},mode==='win'?(value+50)+'%':(value>0?'+':'')+value);}
 add('path',{d:g.points.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),fill:'none',stroke:mode==='win'?'#377b58':'#26343d','stroke-width':1.5});
 const ticks=new Set([0,g.last]);for(let i=50;i<g.last-20;i+=50)ticks.add(i);for(const m of ticks)add('text',{x:g.x(m),y:158,'text-anchor':'middle','font-size':10,fill:'#56626a'},m);
 wrap.append(svg);return wrap;
}
function render(){
 document.title=t('AI 棋局报告 · DL','AI game report · DL');$('back-record').textContent=t('返回棋局','Return to game');$('back-record').href='/record/'+id;$('player-label').textContent=t('复盘棋手','Review');$('count-label').textContent=t('问题手','Problems');$('study-label').textContent=t('先练习再看答案','Exercise before answer');$('print-report').textContent=t('打印 / 保存 PDF','Print / Save PDF');
 for(const option of $('report-player').options)option.textContent=option.value==='both'?t('双方','Both players'):option.value==='B'?t('黑方','Black'):t('白方','White');
 if(!report)return;const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),gameLabel=t('黑方：','Black: ')+(game.players.black||'—')+' · '+t('白方：','White: ')+(game.players.white||'—');
 const overview=sheet(t('AI 棋局复盘报告','AI game review report'));overview.append(node('p',report.name,'report-game'),node('p',gameLabel,'report-game'),node('p',[result?t(result.zh,result.en):game.result,game.date,game.rules,t('贴目 ','Komi ')+game.komi,t('共 '+game.moves+' 手',game.moves+' moves')].filter(Boolean).join(' · ')));
 const p=report.provenance,c=p.compute||{},duration=Number.isFinite(p.endToEndMs)?Math.round(p.endToEndMs/60000)+t(' 分钟',' min'):'—';overview.append(node('p',[p.engine+' · '+p.model,p.visits.toLocaleString()+t(' 次访问 / 局面',' visits / position'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),t('分析总时间（含排队和准备）：','Analysis total including queue/setup: ')+duration,t('分析完成：','Analysis completed: ')+new Date(p.completedAt).toLocaleString(undefined,{timeZoneName:'longOffset'})+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone].join('\n'),'report-meta'));
 overview.append(node('h3',t('发挥统计','Player statistics')));
 overview.append(table([t('棋手','Player'),t('已评定 / 手数','Rated / moves'),t('平均点损失','Mean point loss'),t('首选吻合','Best match'),t('好棋吻合','Best + good')],['B','W'].map(side=>{const player=report.players[side];return [(side==='B'?t('黑方 ','Black '):t('白方 ','White '))+(player.name||'—'),player.ratedMoves+' / '+player.moves,number(player.meanPointLoss),number(player.bestMatchPercent)+'%',number(player.goodMatchPercent)+'%'];})));
 overview.append(table([t('评价','Rating'),t('黑方','Black'),t('白方','White')],Object.entries(qualities()).map(([key,label])=>[label,report.players.B.counts[key],report.players.W.counts[key]])));
 overview.append(node('p',t('好棋吻合包括首选以及估计点损失不超过 0.5 的着法。点损失采用棋手视角；搜索不足的实战着法使用落子后的局面估计。最佳是 KataGo 首选。这里不推算段位、着法难度或是否使用 AI。','Best + good includes the engine’s first choice and moves losing at most 0.5 estimated points. Loss is from the player’s perspective. Underexplored played moves use the following position’s estimate. Best means KataGo’s top choice. No rank, move-difficulty or AI-use inference is made.'),'report-note'));
 overview.append(node('p',t('估计评定手数：黑方 ','Estimated move ratings: Black ')+report.players.B.estimatedMoves+' · '+t('白方 ','White ')+report.players.W.estimatedMoves,'report-note'));
 const graphs=sheet(t('全局走势','Game trends'));graphs.append(node('h3',t('黑方胜率','Black win probability')),chart('win'),node('h3',t('点数优势（黑方为正，白方为负）','Point advantage: positive for Black, negative for White')),chart('score'),node('h3',t('手数区间统计','Statistics by move range')));
 graphs.append(table([t('棋手','Player'),t('手数范围','Move range'),t('平均点损失','Mean point loss'),t('好棋吻合','Best + good')],['B','W'].flatMap(side=>report.players[side].segments.filter(s=>s.moves).map(s=>[side==='B'?t('黑方','Black'):t('白方','White'),s.from+'–'+s.to,number(s.meanPointLoss),number(s.goodMatchPercent)+'%']))));graphs.append(node('p',t('区间固定为 1–60、61–180 和 181 手以后，不表示自动识别的布局、中盘或官子。','Ranges are fixed at moves 1–60, 61–180 and 181 onward; they do not imply automatic detection of opening, middlegame or endgame.'),'report-note'));
 sheet(t('总谱','Game overview')).append(diagram(report.overview.board,t('终局棋盘；存活棋子上标注实战手数。','Final board; surviving stones are labelled with recorded move numbers.'),report.overview.numbers,true));
 const side=$('report-player').value,limit=Number($('report-count').value),problems=report.problems.filter(m=>side==='both'||m.side===side).slice(0,limit);
 if(!problems.length)sheet(t('问题手','Moves to study')).append(node('p',t('本次搜索未找到已评定且损失超过 0.5 点的着法。','This search found no rated moves losing more than 0.5 points.')));
 for(const m of problems){
  const title=t('问题手：第 '+m.move+' 手','Move to study: '+m.move),colour=m.side==='B'?t('黑方','Black'):t('白方','White'),options=[{move:m.played},m.best,...m.alternatives].filter((c,n,list)=>list.findIndex(v=>v.move===c.move)===n).slice(0,4).sort((a,b)=>((gtpPoint(a.move)??361)*73+m.move*37)%367-((gtpPoint(b.move)??361)*73+m.move*37)%367),labels=options.map((c,n)=>({index:gtpPoint(c.move),label:'ABCD'[n],colour:'#377b58'})).filter(m=>m.index!==null);
  if($('study-mode').checked){const exercise=sheet(title);exercise.append(node('p',colour+t('先。考虑更好的选点，然后查看下一页。',' to play. Consider a better move before checking the next page.')),diagram(m.beforeBoard,t('候选点：','Candidate points: ')+options.map((c,n)=>'ABCD'[n]+' '+c.move).join(' · '),labels,true));}
  const answer=sheet(title+' · '+(qualities()[m.quality]||t('未评定','Unrated')));answer.append(node('p',colour+' · '+m.played+' · '+t('估计点损失 ','Estimated point loss: ')+number(m.pointLoss)+' · '+t('胜率损失 ','Win-probability loss: ')+number(m.winrateLoss)+t(' 个百分点',' percentage points'),'report-quality-'+m.quality));
  const sign=m.side==='B'?1:-1,win=v=>m.side==='B'?v:1-v,rows=[{label:'ABCD'[options.findIndex(c=>c.move===m.best.move)]+' · '+t('AI 首选','AI best'),c:m.best},{label:'ABCD'[options.findIndex(c=>c.move===m.played)]+' · '+t('实战','Played'),c:{move:m.played,...m.playedEvaluation,visits:m.playedCandidate?.visits}}];
  answer.append(table([t('选点','Choice'),t('坐标','Coordinate'),t('领先点数','Point lead'),t('胜率','Win probability'),t('访问量','Visits')],rows.map(({label,c})=>[label,c.move,number(sign*c.blackLead),number(win(c.blackWinrate)*100)+'%',c.visits?.toLocaleString()||'—'])));
  const pair=node('div',undefined,'diagram-pair'),numbers=line=>line?.moves.map((move,n)=>({index:move.index,side:move.side,label:String(n+1)})).filter(m=>m.index!==null)||[];
  pair.append(diagram(m.bestLine.board,t('AI 首选变化','AI best continuation'),numbers(m.bestLine)),diagram(m.playedLine?.board||m.actualBoard,m.playedLine?t('实战选点的 AI 变化','AI continuation from the played move'):t('实战落子后的棋盘','Board after the played move'),m.playedLine?numbers(m.playedLine):[{index:m.playedIndex,side:m.side,label:'1'}]));answer.append(pair);
  answer.append(node('p',t('数字从选点后的第 1 手开始；停一手不标在棋盘上。最多显示 12 手，后续为引擎推荐变化，不是实际棋谱。','Numbers start with the candidate move. Passes have no board label. Up to 12 moves are shown; continuations are engine suggestions, not the recorded game.'),'report-note'));
  if(m.estimated)answer.append(node('p',t('实战着法的搜索不足，其评估来自落子后的局面；数值为估计。','The played move had insufficient search; its evaluation comes from the following position and is estimated.'),'report-note'));
  if(m.bestLine.truncated||m.playedLine?.truncated)answer.append(node('p',t('无法合法复现的变化已截断。','A continuation that could not be replayed legally has been truncated.'),'report-note'));
  const link=node('a',t('在棋局中复盘这一步','Review this move in the game'));link.href='/record/'+id+'?move='+m.nodeId;answer.append(link);
 }
 const end=sheet(t('评估方法','Evaluation method'));end.append(node('p',t('点损失的评级阈值：好棋 ≤ 0.5、不精确 ≤ 2、失误 ≤ 5、严重失误 > 5。统计覆盖主线，未评定着法不计入平均值或吻合率。问题手按点损失从大到小选择，最多展示所选数量。所有指标与变化来自已保存的深度分析；生成或打印报告不会运行新分析。','Point-loss thresholds: Good ≤ 0.5, Inaccuracy ≤ 2, Mistake ≤ 5, Blunder > 5. Statistics cover the main line; unrated moves are excluded from means and match rates. Study moves are selected by largest point loss, up to the chosen count. All metrics and variations come from saved deep analysis; generating or printing this report starts no new analysis.')),node('p',t('模型校验值：','Model SHA-256: ')+p.modelSha256,'report-note'),node('p',t('报告生成：','Report generated: ')+new Date(report.generatedAt).toLocaleString(undefined,{timeZoneName:'longOffset'}),'report-note'));
 for(const [n,s] of sheets.entries()){const footer=node('footer',undefined,'report-footer');footer.append(node('span','weiqi.dliu.com/record/'+id),node('span',(n+1)+' / '+sheets.length));s.append(footer);}
 $('report-content').replaceChildren(fragment);$('print-report').disabled=false;$('report-status').textContent='';
}
for(const id of ['report-player','report-count','study-mode'])$(id).onchange=render;
document.querySelectorAll('[data-language]').forEach(b=>b.onclick=()=>{setLanguage(b.dataset.language);render();});
$('print-report').onclick=()=>window.print();render();
try{if(!id)throw Error('Missing game ID.');report=await libraryRequest('/api/library/'+encodeURIComponent(id)+'/report');render();}catch(e){$('report-status').textContent=e.message;}
