import {t} from './i18n.js';
import {libraryRequest} from './library-api.js';
import {boardDiagram} from './board-diagram.js';
import {gameResult} from './game-result.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/record\/([^/]+)\/report\/?$/)?.[1]||new URLSearchParams(location.search).get('game');
let report=null;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const number=(v,d=1)=>Number.isFinite(v)?v.toFixed(d):'—';
const qualities=()=>({best:t('最佳','Best'),good:t('好棋','Good'),inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')});
function table(headers,rows){const e=node('table',undefined,'report-table'),head=node('thead'),h=node('tr');for(const text of headers)h.append(node('th',text));head.append(h);e.append(head);const body=node('tbody');for(const cells of rows){const row=node('tr');for(const text of cells)row.append(node('td',text));body.append(row);}e.append(body);return e;}
function diagram(board,caption,labels=[],single=false){const f=node('figure',undefined,'report-board'+(single?' single':''));f.append(boardDiagram(board,{labels}),node('figcaption',caption));return f;}
function render(){
 document.title=t('AI 棋局报告 · DL','AI game report · DL');$('back-record').textContent=t('返回棋局','Return to game');$('back-record').href='/record/'+id;$('print-report').textContent=t('打印 / 保存 PDF','Print / Save PDF');
 if(!report)return;const fragment=document.createDocumentFragment(),sheets=[];
 const sheet=title=>{const e=node('section',undefined,'report-sheet');e.append(node('h2',title));sheets.push(e);fragment.append(e);return e;};
 const game=report.game,result=gameResult(game.result),gameLabel=t('黑方：','Black: ')+(game.players.black||'—')+' · '+t('白方：','White: ')+(game.players.white||'—');
 const overview=sheet(t('AI 棋局复盘报告','AI game review report'));overview.append(node('p',report.name,'report-game'),node('p',gameLabel,'report-game'),node('p',[result?t(result.zh,result.en):game.result,game.date,game.rules,t('贴目 ','Komi ')+game.komi,t('共 '+game.moves+' 手',game.moves+' moves')].filter(Boolean).join(' · ')));
 const p=report.provenance,c=p.compute||{},duration=Number.isFinite(p.endToEndMs)?Math.round(p.endToEndMs/60000)+t(' 分钟',' min'):'—';overview.append(node('p',[p.engine+' · '+p.model,p.visits.toLocaleString()+t(' 次访问 / 局面',' visits / position'),[c.gpu,c.instanceType,c.vCpu?c.vCpu+' vCPUs':'',c.memoryGB?c.memoryGB+' GB RAM':''].filter(Boolean).join(' · '),t('分析总时间（含排队和准备）：','Analysis total including queue/setup: ')+duration,t('分析完成：','Analysis completed: ')+new Date(p.completedAt).toLocaleString(undefined,{timeZoneName:'longOffset'})+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone].join('\n'),'report-meta'));
 overview.append(node('p',t('分别列出黑方和白方点损失最大的五个较差着法，以及 AI 推荐变化。若一方没有五个符合条件的着法，只列出实际找到的数量。','The five moves with the largest estimated point losses for each side, with AI recommended continuations. If fewer than five qualify, only the available moves are listed.')));
 for(const side of ['B','W']){
  const colour=side==='B'?t('黑方','Black'):t('白方','White'),name=game.players[side==='B'?'black':'white']||'—',moves=report.problems.filter(m=>m.side===side).slice(0,5);
  overview.append(node('h3',colour+' · '+name));
  if(moves.length)overview.append(table([t('手数','Move'),t('实战','Played'),t('点损失','Point loss'),t('AI 首选','AI best')],moves.map(m=>[m.move,m.played,number(m.pointLoss),m.best.move])));
  else overview.append(node('p',t('未找到点损失超过 0.5 的已评定着法。','No rated moves losing more than 0.5 points were found.')));
 }
 for(const side of ['B','W'])for(const [index,m] of report.problems.filter(m=>m.side===side).slice(0,5).entries()){
  const colour=m.side==='B'?t('黑方','Black'):t('白方','White'),title=colour+' '+(index+1)+' · '+t('第 '+m.move+' 手','Move '+m.move);
  const answer=sheet(title+' · '+(qualities()[m.quality]||t('未评定','Unrated')));answer.dataset.side=m.side;answer.dataset.move=m.move;
  answer.append(node('p',m.played+' · '+t('估计点损失 ','Estimated point loss: ')+number(m.pointLoss)+' · '+t('胜率损失 ','Win-probability loss: ')+number(m.winrateLoss)+t(' 个百分点',' percentage points'),'report-quality-'+m.quality));
  const sign=m.side==='B'?1:-1,win=v=>m.side==='B'?v:1-v,rows=[{label:t('AI 首选','AI best'),c:m.best},{label:t('实战','Played'),c:{move:m.played,...m.playedEvaluation,visits:m.playedCandidate?.visits}}];
  answer.append(table([t('选点','Choice'),t('坐标','Coordinate'),t('领先点数','Point lead'),t('胜率','Win probability'),t('访问量','Visits')],rows.map(({label,c})=>[label,c.move,number(sign*c.blackLead),number(win(c.blackWinrate)*100)+'%',c.visits?.toLocaleString()||'—'])));
  const pair=node('div',undefined,'diagram-pair'),numbers=line=>line?.moves.map((move,n)=>({index:move.index,side:move.side,label:String(n+1)})).filter(m=>m.index!==null)||[];
  pair.append(diagram(m.actualBoard,t('实战落子后的棋盘','Board after the played move'),m.playedIndex===null?[]:[{index:m.playedIndex,side:m.side,label:'1'}]),diagram(m.bestLine.board,t('AI 首选变化','AI best continuation'),numbers(m.bestLine)));answer.append(pair);
  answer.append(node('p',t('数字从选点后的第 1 手开始；停一手不标在棋盘上。最多显示 12 手，后续为引擎推荐变化，不是实际棋谱。','Numbers start with the candidate move. Passes have no board label. Up to 12 moves are shown; continuations are engine suggestions, not the recorded game.'),'report-note'));
  if(m.estimated)answer.append(node('p',t('实战着法的搜索不足，其评估来自落子后的局面；数值为估计。','The played move had insufficient search; its evaluation comes from the following position and is estimated.'),'report-note'));
  if(m.bestLine.truncated)answer.append(node('p',t('无法合法复现的变化已截断。','A continuation that could not be replayed legally has been truncated.'),'report-note'));
  const link=node('a',t('在棋局中复盘这一步','Review this move in the game'));link.href='/record/'+id+'?move='+m.nodeId;answer.append(link);
 }
 overview.append(node('p',t('按棋手视角的估计点损失排序，仅列出损失超过 0.5 点的着法。报告复用已保存的深度分析，不启动新分析。','Ranked by estimated point loss from the player’s perspective; only moves losing more than 0.5 points are included. The report reuses saved deep analysis and starts no new analysis.'),'report-note'));
 for(const [n,s] of sheets.entries()){const footer=node('footer',undefined,'report-footer');footer.append(node('span','weiqi.dliu.com/record/'+id),node('span',(n+1)+' / '+sheets.length));s.append(footer);}
 $('report-content').replaceChildren(fragment);$('print-report').disabled=false;$('report-status').textContent='';
}
$('print-report').onclick=()=>window.print();render();
try{if(!id)throw Error('Missing game ID.');report=await libraryRequest('/api/library/'+encodeURIComponent(id)+'/report');render();}catch(e){$('report-status').textContent=e.message;}
