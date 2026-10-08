import './site-shell.js';
import {timeControlSummary} from './time-control.js';
import {mountStoneSound,prepareStoneSound,playStoneSound} from './stone-sound.js';
import {BoardView} from './board-view.js';
import {localTimestamp,analysisQuotaDate} from './site-time.js';
import {t,setLanguage} from './i18n.js';
import {analysisWait,pendingAnalysis,shouldPollQuick,analysisCompletion,analysisTotalMillis,queueWait,QUICK_POLL_INTERVAL_MS,conservativeMinute} from './analysis-status.js';
import {reviewMove,nextMoveComparison,recommendedLine,startRecommendedLine,lineContinuations,followLineContinuation,gtpPoint} from './ai-review.js';
import {play} from './engine.js';
import {stepReplay} from './replay-navigation.js';
import {gameResult} from './game-result.js';
import {drawEvaluationChart} from './evaluation-chart.js';
import {readSgf,parseSgf} from './sgf.js';
import {libraryRequest,requestErrorText} from './library-api.js';
import {renderMoveLabel,qualityPill} from './move-label.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/(?:record|game)\/([0-9]{10,14}|[a-f0-9-]{36})\/?$/)?.[1] || new URLSearchParams(location.search).get('game');
mountStoneSound($('game-sound'));
let data=null,record=null,handicap=0,selected=restorePosition(),loading=false,points=[],analyses=new Map(),trials=[],trialOffset=0,chartMode='score',pollTimer=null,statusTimer=null,aiLine=null,suggestions=true;
const boardCandidates=new Map(),boardRecordedMoves=new Map();
let aiHover=null,aiHoverBlocked=false,preserveAiTable=false,loadError=null;
const hoverAiSuggestions=window.matchMedia('(hover:hover) and (pointer:fine)');
try{suggestions=localStorage.getItem('weiqi.aiSuggestions')!=='off';}catch{}
function coord(index){return 'ABCDEFGHJKLMNOPQRST'[index%record.size]+(record.size-Math.floor(index/record.size));}
let boardView;
function drawBoard(){if(boardView)return;boardView=new BoardView($('board'),{horizontalArrows:false,onPoint:i=>{const actual=boardRecordedMoves.get(i),choice=boardCandidates.get(i);if(actual!==undefined)selectPosition(actual);else if(choice?.continuation)followAiContinuation(choice.continuation);else if(choice)showAiCandidate(choice.review,choice.candidate);else previewMove(i);}});points=boardView.points;}
function render(){const panel=document.querySelector('#record-main aside'),scroll=panel.scrollTop;renderContents();panel.scrollTop=scroll;}
function renderContents(){document.title=(data?.metadata.name || t('棋谱','Game record'))+' · DL';$('download-original').textContent=t('下载 SGF','Download SGF');$('generate-report').textContent=t('查看 AI 报告','View AI report');const reportReady=data?.analysis?.phase==='deep'&&data.metadata.analysis.status==='ready';$('generate-report').setAttribute('aria-disabled',String(!reportReady));if(reportReady)$('generate-report').href='/game/'+id+'/report';else $('generate-report').removeAttribute('href');$('generate-report').title=reportReady?t('查看已生成的中英文报告并保存 PDF','View the prepared English/Chinese report and save PDF'):t('深度分析完成后自动生成报告','Report prepared automatically after deep analysis');$('record-main').hidden=!record;if(!record)return;
 const base=record.nodes[selected],continuations=aiLine&&!trialOffset&&!aiLine.overview?lineContinuations(record,aiLine,analyses,data.analysis?.phase):[],node=trials[trialOffset-1] || aiLine?.frames[aiLine.offset] || base;
 $('trial-controls').hidden=!trialOffset;$('trial-undo').textContent=t('撤回试下','Undo preview');$('trial-clear').textContent=t('返回原局面','Return to original position');
 $('record-name').textContent=data.metadata.name;$('record-players').replaceChildren();for(const side of ['black','white']){const player=document.createElement('div');player.className='record-player record-player-'+side;const stone=document.createElement('span');stone.className='player-stone player-stone-'+side;stone.setAttribute('aria-hidden','true');const colour=document.createElement('span');colour.className='player-colour';colour.textContent=side==='black'?t('黑方','Black'):t('白方','White');const name=document.createElement('strong');name.className='player-name';name.textContent=(record.players[side]||t('未命名棋手','Unnamed player'))+(record.playerRanks?.[side]?' ('+record.playerRanks[side]+')':'');player.append(stone,colour,name);const result=gameResult(record.result),winner=result?.winner;if(result&&(!winner||winner===(side==='black'?'B':'W'))){const badge=document.createElement('span');badge.className='game-result';badge.textContent=t(result.zh,result.en);badge.setAttribute('aria-label',t('棋局结果：','Game result: ')+t(result.zh,result.en));player.append(badge);}$('record-players').append(player);}renderMoveLabel($('move-label'),{depth:node.depth,move:node.move,t,size:record.size,mode:trialOffset?t('试下','Preview'):aiLine?t('AI 变化','AI line'):''});
 renderBoard(node);
 $('board').dataset.preview=node.turn==='B'?'black':'white';$('back-ten').disabled=!trialOffset&&!aiLine&&selected===0;$('forward-ten').disabled=trialOffset<trials.length?false:trialOffset?true:aiLine?aiLine.offset===aiLine.frames.length-1&&!continuations.length:!base.children.length;
 $('first').disabled=!trialOffset&&!aiLine&&selected===0;$('previous').disabled=!trialOffset&&!aiLine&&selected===0;$('next').disabled=$('forward-ten').disabled;$('last').disabled=!trialOffset&&!aiLine&&selected===record.mainLine.at(-1);$('branch-label').textContent=node.children.length>1?t('选择分支','Choose variation'):'';$('branch-select').hidden=node.children.length<2;$('branch-select').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent=t('下一手…','Next move…');$('branch-select').append(empty);for(const child of node.children){const n=record.nodes[child],option=document.createElement('option');option.value=child;option.textContent=(n.move.side==='B'?t('黑','Black'):t('白','White'))+' '+(n.move.index===null?t('停一手','Pass'):coord(n.move.index));$('branch-select').append(option);}
 $('record-comment').textContent=node.comment;$('record-details').textContent=[record.size+' × '+record.size,record.date,record.venue,handicap>0?t('让 '+handicap+' 子','Handicap '+handicap):'',timeControlSummary(record.timeControl,t),record.rules || t('未指定规则','Rules unspecified'),t('贴目 ','Komi ')+record.komi].filter(Boolean).join(' · ');
 drawEvaluationChart($('evaluation-chart'),data.analysis?.positions || [],trialOffset||aiLine?-1:selected,node=>selectPosition(node),{chart:chartMode==='win'?t('逐手黑方胜率，点击或使用方向键选择棋步','Black win rate by move. Click or use arrow keys to select a move.'):t('逐手目差，点击或使用方向键选择棋步','Point advantage by move. Click or use arrow keys to select a move.'),move:n=>t('第 '+n+' 手','Move '+n),variation:t('当前分支未分析','Current variation is not analysed')},chartMode);
 $('chart-score').textContent=t('目差','Score');$('chart-win').textContent=t('胜率 %','Win %');for(const mode of ['score','win'])$('chart-'+mode).setAttribute('aria-pressed',String(chartMode===mode));$('legend-black').textContent=t('黑方领先','Black ahead');$('legend-white').textContent=t('白方领先','White ahead');
 const state=data.metadata.analysis.status,pending=pendingAnalysis(data.metadata.analysis);$('analysis-wait').hidden=!pending&&!!data.analysis&&!trialOffset&&!aiLine&&analyses.has(selected)&&data.metadata.analysis.deep?.status!=='failed'&&state!=='failed'&&state!=='paused';$('analysis-wait').classList.toggle('is-loading',!!pending);const evaluation=trialOffset||aiLine?null:analyses.get(selected);$('analysis-depth').textContent='';
 if(data.analysis){
  const a=data.analysis,network=a.model.match(/b(\d+)c(\d+)/),engine=a.engineVersion.startsWith(a.engine)?a.engineVersion:a.engine+' '+a.engineVersion;
  const phase=a.phase==='quick'?t('快速分析（临时结果）','Quick analysis (preliminary)'):a.phase==='deep'?(a.compute?.instanceType==='g5.xlarge'?t('深度分析（GPU 后备）','Deep analysis (GPU fallback)'):t('深度分析','Deep analysis')):'';
  $('analysis-depth').textContent=[phase,engine+' · '+(network?network.slice(1).join(' × ')+t(' 网络',' network'):a.model)+' · '+(evaluation?.visits??'—')+' / '+a.visits+t(' 次访问',' visits'),analysisCompute(a),t('分析规则：','Analysis rules: ')+a.rules+' · '+t('贴目 ','Komi ')+a.komi,analysisRuntime(a),analysisTotal(a),t('完成于：','Completed: ')+localTimestamp(a.completedAt,document.documentElement.lang==='zh-CN'?'zh':'en')].filter(Boolean).join('\n');
 }
 if(data.analysis&&evaluation){$('analysis-status').textContent=state==='paused'?pausedAnalysisMessage():pending?pendingMessage():data.metadata.analysis.deep?.status==='failed'?terminalAnalysisMessage():'';}
 else $('analysis-status').textContent=aiLine?(pending?pendingMessage():t('AI 推荐变化；后续局面未单独分析。','KataGo recommended line; continuation positions are not separately analysed.')):trialOffset?t('试下局面未分析。','Preview positions are not analysed.'):state==='ready'?t('此分支尚未分析。','This variation has not been analysed.'):state==='limited'?t(analysisQuotaDate(data.metadata)+' 的 AI 分析限额已用完。棋谱已保存，可正常复盘。','The daily AI analysis cap for '+analysisQuotaDate(data.metadata)+' has been reached. Your game is saved and available to replay.'):state==='paused'?pausedAnalysisMessage():state==='failed'?terminalAnalysisMessage():pendingMessage();
 renderSuggestions();
}
function pendingMessage(){
 const state=data.metadata.analysis,stage=pendingAnalysis(state)||state;
 if(state.status==='retry_wait'){const remaining=Math.max(0,Math.ceil((Date.parse(state.retryAt)-Date.now())/1000));return t('AI 分析暂时失败。棋谱和已完成的分析已保存。','AI analysis temporarily failed. Your record and completed analysis are safe.')+'\n'+t('自动重试 ','Automatic retry ')+(state.attempt||1)+'/2 · '+formatAnalysisEstimate(Date.parse(state.retryAt))+'\n'+(remaining>0?t('还需约 '+Math.ceil(remaining/60)+' 分钟。','About '+Math.ceil(remaining/60)+' min until retry.'):t('重试已到期，等待调度。','Retry is due; awaiting dispatch.'))+(data.analysis?'':'\n'+t('每分钟检查一次。','Checking once a minute.'));}
 const deep=stage.phase==='deep'||data.metadata.benchmark?.queueKind==='deep';
 if(data.metadata.benchmark&&!data.metadata.benchmark.workflow){const started=stage.startedAt||state.startedAt;return (state.status==='queued'?t('基准测试排队中。','Benchmark queued.'):t('基准分析运行中 · 已运行 ','Benchmark analysis running · elapsed ')+Math.floor(Math.max(0,Date.now()-Date.parse(started))/60000)+t(' 分钟',' min')+'\n'+t('开始于：','Started: ')+formatAnalysisTime(Date.parse(started)));}
 const wait=analysisWait(stage,data.metadata.moves),completion=analysisCompletion(stage,data.metadata.moves),duration=t(Math.max(1,Math.ceil(wait.seconds/60))+' 分钟',Math.max(1,Math.ceil(wait.seconds/60))+' min');
 const name=deep?t('深度分析','Deep analysis'):t('快速分析','Quick analysis');
 const showing=deep&&data.analysis?t('当前显示快速分析。','Showing quick analysis.')+'\n':'';
 if(wait.phase==='queued'){
  const queue=queueWait(stage),range=queue.seconds;
  const messages={dispatching:t('正在提交 AI 作业。','Submitting the AI job.'),starting:t('GPU 已分配，正在启动工作进程。','GPU allocated; starting the worker.'),setup:t('GPU 已启动，正在准备分析。','GPU started; preparing analysis.'),between_passes:t('快速分析完成，正在准备深度分析。','Quick analysis finished; preparing the deep pass.'),capacity_wait:t('等待 AWS GPU 容量，暂时无法可靠估计开始时间。','Waiting for AWS GPU capacity; a reliable start time is not available.'),busy_unknown:t('前面的作业或准备阶段比预计更久，暂时无法可靠估计开始时间。','Earlier jobs or setup are taking longer than expected; a reliable start time is not available.'),updating:t('作业状态更新中。','Updating the job status.'),unavailable:t('排队中，暂时无法读取等待时间估计。','Queued; the waiting-time estimate is temporarily unavailable.')};
  let message=messages[queue.state]||t('排队中。','In queue.');
  if(Number.isInteger(queue.jobsAhead))message+='\n'+t('前面等待的作业：'+queue.jobsAhead+' · 运行或启动中的作业：'+queue.activeJobs,'Jobs waiting ahead: '+queue.jobsAhead+' · Running or starting: '+queue.activeJobs);
  if(range){
   message+='\n'+t('预计开始：','Estimated start: ')+formatAnalysisEstimate(queue.startsAt.latest);
   if(completion)message+='\n'+t('预计完成：','Estimated finish: ')+formatAnalysisEstimate(completion.timestamp);
  }else message+='\n'+t('开始后处理约 ','Processing after start: ~')+duration;
  return showing+name+' · '+message;
 }
 const progress=wait.phase==='running'?t('预计 '+duration.replace(' ','')+'后完成。',' ready in '+duration+'.'):t('比预计耗时更长。',' is taking longer than expected.');
 const started=Number.isFinite(Date.parse(stage.startedAt))?'\n'+t('开始于：','Started: ')+formatAnalysisTime(Date.parse(stage.startedAt)):'';
 const estimate=completion?'\n'+(wait.phase==='overdue'?t('原预计完成：','Original estimated finish: '):t('预计完成：','Estimated finish: '))+formatAnalysisEstimate(completion.timestamp):'';
 const retry=state.attempt>1?t('自动重试 '+(state.attempt-1)+'/2 · ','Automatic retry '+(state.attempt-1)+'/2 · '):'';
 return showing+retry+name+progress+started+estimate;
}
function pausedAnalysisMessage(){return t('AI 分析已暂停：本站费用达到限额。棋谱和已有分析仍可查看。','AI analysis is paused because the site’s spending threshold was reached. Your game and completed analysis remain available.');}
function terminalAnalysisMessage(){return (data.metadata.analysis.error||t('AI 分析失败。','AI analysis failed.'))+' '+t('已完成两次自动重试。棋谱和已有分析仍可查看。','Both automatic retries have been used. Your record and completed analysis remain available.');}
function formatAnalysisTime(timestamp){return localTimestamp(timestamp,document.documentElement.lang==='zh-CN'?'zh':'en',{seconds:false});}
function formatAnalysisEstimate(timestamp){return formatAnalysisTime(conservativeMinute(timestamp));}
function scheduleStatusTicker(){clearInterval(statusTimer);if(record&&!document.hidden&&pendingAnalysis(data.metadata.analysis))statusTimer=setInterval(()=>{if(trialOffset)return;const message=pendingMessage();if($('analysis-status').textContent!==message)$('analysis-status').textContent=message;},1000);}

function schedulePoll(){clearTimeout(pollTimer);if(record&&!document.hidden&&shouldPollQuick(data.metadata.analysis,data.metadata.benchmark))pollTimer=setTimeout(load,QUICK_POLL_INTERVAL_MS);}
function showLoadError(){
 if(!loadError)return;
 const e=loadError,text=e.kind==='invalid-link'?t('这个棋谱链接无效。','This game link is not valid.'):e.kind==='mismatch'?t('AI 分析与这局棋谱不一致。请稍后刷新页面。','The AI analysis does not match this game record. Refresh the page later.'):e.kind?requestErrorText(e,t,t('找不到这局棋谱。链接可能有误，或棋谱已被删除。','This game could not be found. The link may be wrong, or the game may have been removed.')):t('无法打开这局棋谱。请刷新页面重试。','This game record could not be opened. Refresh the page to try again.');
 const link=document.createElement('a');link.href='/game';link.textContent=t('查看棋谱库','Go to the game library');
 $('record-message').replaceChildren(text+' ',...(record?[]:[link]));
}
async function load(){if(loading)return;loading=true;render();try{if(!/^(?:[0-9]{10,14}|[a-f0-9-]{36})$/.test(id || ''))throw Object.assign(Error('Invalid game link.'),{kind:'invalid-link'});const next=await libraryRequest('/api/library/'+id);const parsed=readSgf(next.sgf);if(next.analysis && next.analysis.sgfSha256!==Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(next.sgf))),b=>b.toString(16).padStart(2,'0')).join(''))throw Object.assign(Error('Analysis does not match this record.'),{kind:'mismatch'});data=next;record=parsed;handicap=Number(parseSgf(next.sgf).nodes[0].HA?.[0]||0);analyses=new Map((data.analysis?.positions || []).map(p=>[p.nodeId,p]));if(selected>=record.nodes.length)selected=0;drawBoard();loadError=null;$('record-message').textContent='';}catch(e){loadError=e;showLoadError();}finally{loading=false;render();schedulePoll();scheduleStatusTicker();}}
function soundCurrentMove(){const node=trials[trialOffset-1]||aiLine?.frames[aiLine.offset]||record?.nodes[selected];if(node?.move&&node.move.index!==null)playStoneSound();}
function selectPosition(node){aiHover=null;aiHoverBlocked=false;prepareStoneSound();const forward=record.nodes[node].depth>record.nodes[selected].depth;selected=node;try{sessionStorage.setItem('weiqi.replay.'+id,String(node));}catch{}trials=[];trialOffset=0;aiLine=null;$('record-message').textContent='';render();if(forward)soundCurrentMove();}
function step(amount){
 if(!record)return;aiHover=null;aiHoverBlocked=false;prepareStoneSound();
 if(aiLine)aiLine.overview=false;
 const movingForward=amount>0,before=[selected,trialOffset,aiLine?.offset].join(':');
 if(amount>0&&aiLine&&!trialOffset&&aiLine.offset===aiLine.frames.length-1){const choice=lineContinuations(record,aiLine,analyses,data.analysis?.phase)[0];if(choice){aiLine=followLineContinuation(aiLine,choice);amount--;}}
 const next=stepReplay(record,{selected,aiLine,trials,trialOffset},amount);
 ({selected,aiLine,trials,trialOffset}=next);
 try{sessionStorage.setItem('weiqi.replay.'+id,String(selected));}catch{}
 $('record-message').textContent='';render();if(movingForward&&before!==[selected,trialOffset,aiLine?.offset].join(':'))soundCurrentMove();
}
function previewMove(index){if(!record)return;aiHover=null;aiHoverBlocked=false;prepareStoneSound();const base=trials[trialOffset-1]||aiLine?.frames[aiLine.offset]||record.nodes[selected];const history=trials.slice(0,trialOffset).map(n=>n.board);if(aiLine)history.push(...aiLine.frames.slice(1,aiLine.offset+1).map(n=>n.board));for(let n=aiLine?.anchor??selected;n!==null;n=record.nodes[n].parent)history.push(record.nodes[n].board);try{const result=play(base.board,index,base.turn==='B'?'black':'white',19,history);trials=trials.slice(0,trialOffset);trials.push({...base,board:result.board,depth:base.depth+1,move:{side:base.turn,index},turn:base.turn==='B'?'W':'B'});trialOffset=trials.length;render();playStoneSound();}catch(e){$('record-message').textContent=e.message;}}
for(const mode of ['score','win'])$('chart-'+mode).onclick=()=>{chartMode=mode;render();};
$('first').onclick=()=>selectPosition(0);$('previous').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('back-ten').onclick=()=>step(-10);$('forward-ten').onclick=()=>step(10);$('last').onclick=()=>selectPosition(record.mainLine.at(-1));$('branch-select').onchange=e=>{if(e.target.value)selectPosition(Number(e.target.value));};
$('trial-undo').onclick=()=>step(-1);$('trial-clear').onclick=clearAiLine;
document.addEventListener('keydown',event=>{if(!record||event.target.closest('input,select,textarea,[contenteditable=true]')||(!aiLine&&!trialOffset&&event.target.closest('[role=slider]')))return;if(event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();step(-1);}else if(event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();step(1);}else if(event.key==='Home'){event.preventDefault();selectPosition(0);}else if(event.key==='End'){event.preventDefault();selectPosition(record.mainLine.at(-1));}},{capture:true});
window.addEventListener('resize',()=>{if(record)render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(pollTimer);clearInterval(statusTimer);render();}else if(data){scheduleStatusTicker();if(shouldPollQuick(data.metadata.analysis,data.metadata.benchmark))schedulePoll();}});
$('download-original').onclick=()=>{if(!data)return;const url=URL.createObjectURL(new Blob([data.sgf],{type:'application/x-go-sgf;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=data.metadata.name.replace(/[^\p{L}\p{N} _-]/gu,'-').slice(0,80)+'.sgf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('site-language-change',()=>{render();showLoadError();});render();load();

// Keep the same controls and listeners while adapting their position to the screen.
const mobileReplay=window.matchMedia('(max-width:850px)');
const replayNavigation=document.querySelector('.record-navigation');
function arrangeReplayControls(){
 // On phones the game summary (name, files, players, result) sits above the board.
 const summary=document.querySelector('.record-summary'),playArea=document.querySelector('#record-main>.play-area');
 if(mobileReplay.matches){if(summary.nextElementSibling!==playArea)playArea.before(summary);}else if(summary.parentElement!==document.querySelector('#record-main>aside'))document.querySelector('#record-main>aside').prepend(summary);
 const target=document.querySelector(mobileReplay.matches?'.play-area':'.record-summary');
 if(mobileReplay.matches)target.insertBefore(replayNavigation,$('trial-controls'));else target.append(replayNavigation);
 document.documentElement.style.setProperty('--record-header-height',document.querySelector('header').getBoundingClientRect().height+'px');
}
// On phones, size the board so that with the board scrolled to the top, the table header and first three suggestions still fit on screen.
// Header and row heights are remembered so the board keeps its size while suggestions are hidden or still loading.
const tableSize={head:40,row:47};
function fitBoardWithTable(){
 const root=document.documentElement.style,card=$('ai-review').closest('.card');
 if(!mobileReplay.matches){root.removeProperty('--record-below-board');return;}
 if(!card.getClientRects().length)return;
 const head=$('ai-alternatives').querySelector('thead'),row=$('ai-alternatives').querySelector('tbody tr');
 if(head?.getClientRects().length)tableSize.head=head.getBoundingClientRect().height;
 if(row?.getClientRects().length)tableSize.row=row.getBoundingClientRect().height;
 const reserve=Math.ceil(card.getBoundingClientRect().top-document.querySelector('#record-main .board-wrap').getBoundingClientRect().bottom+parseFloat(getComputedStyle(card).paddingTop)+tableSize.head+3*tableSize.row+6);
 if(root.getPropertyValue('--record-below-board')!==reserve+'px')root.setProperty('--record-below-board',reserve+'px');
}
mobileReplay.addEventListener('change',()=>{arrangeReplayControls();fitBoardWithTable();});
window.addEventListener('resize',()=>{arrangeReplayControls();fitBoardWithTable();});
arrangeReplayControls();
if(typeof ResizeObserver!=='undefined')new ResizeObserver(fitBoardWithTable).observe($('ai-review').closest('.card'));
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>{document.documentElement.style.setProperty('--record-header-height',document.querySelector('header').getBoundingClientRect().height+'px');}).observe(document.querySelector('header'));

function analysisRuntime(a){
 const engineMs=a.benchmark?.engineMs,elapsed=engineMs??a.elapsedMs;
 if(!Number.isFinite(elapsed))return t('AI 运行时间：未记录','AI runtime: not recorded');
 const seconds=Math.round(elapsed/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remaining=seconds%60;
 const duration=[hours?t(hours+' 小时',hours+' h'):'',minutes?t(minutes+' 分',minutes+' min'):'',t(remaining+' 秒',remaining+' s')].filter(Boolean).join(' ');
 return (Number.isFinite(engineMs)?t('AI 分析时间：','AI analysis time: '):t('AI 运行时间：','AI runtime: '))+duration;
}

function analysisCompute(a){
 const c=a.compute || data.metadata.benchmark;
 if(!c)return t('计算资源：未记录','Compute: not recorded');
 const parts=[];
 if(c.gpu)parts.push(c.gpu+(c.gpuCount?' × '+c.gpuCount:''));
 const cpu=c.vCpu??c.cpu;
 if(Number.isFinite(cpu))parts.push(cpu+' vCPUs');
 if(Number.isFinite(c.memoryGB))parts.push(c.memoryGB+' GB RAM');
 if(c.instanceType)parts.push(c.instanceType);
 else if(c.backend==='fargate-cpu')parts.push('AWS Fargate');
 return t('计算资源：','Compute: ')+(parts.length?parts.join(' · '):t('未记录','not recorded'));
}

function restorePosition(){try{const requested=new URLSearchParams(location.search).get('move');const n=Number(requested===null?sessionStorage.getItem('weiqi.replay.'+id):requested);return Number.isInteger(n)&&n>=0?n:0;}catch{return 0;}}

function analysisTotal(a){
 const elapsed=analysisTotalMillis(a,data?.metadata);
 if(elapsed===null)return t('总耗时：未记录','Total time: not recorded');
 const seconds=Math.round(elapsed/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return t('总耗时：','Total time: ')+(h?h+'h ':'')+m+'m '+String(s).padStart(2,'0')+'s';
}

function clearAiLine(keepTable=false){aiHover=null;if(keepTable!==true)aiHoverBlocked=false;trials=[];trialOffset=0;aiLine=null;$('record-message').textContent='';if(keepTable===true)renderAiTable();else render();}
$('ai-suggestions').onchange=event=>{suggestions=event.target.checked;try{localStorage.setItem('weiqi.aiSuggestions',suggestions?'on':'off');}catch{}if(!suggestions&&aiLine){aiLine=null;trials=[];trialOffset=0;}render();};
$('ai-line-previous').onclick=()=>step(-1);
$('ai-line-next').onclick=()=>step(1);
$('ai-line-clear').onclick=clearAiLine;
$('ai-line-explore').onclick=()=>{if(!aiLine)return;aiHover=null;aiHoverBlocked=false;aiLine.overview=false;aiLine.offset=Math.min(1,aiLine.frames.length-1);render();};
function renderSuggestions(){
 $('ai-suggestions').checked=suggestions;
 $('ai-suggestions-label').textContent=t('棋步点评与 AI 推荐','Move review & AI suggestions');
 $('ai-review-content').hidden=$('ai-review-notes').hidden=!suggestions;
 boardCandidates.clear();boardRecordedMoves.clear();for(const point of points){delete point.dataset.quality;delete point.dataset.aiCandidate;delete point.dataset.nextQuality;delete point.dataset.recordedMove;point.classList.remove('ai-candidate','ai-best','ai-good','next-recorded-move');point.removeAttribute('title');}
 if(!suggestions)return;
 const review=reviewMove(record,selected,analyses,data.analysis?.phase),next=nextMoveComparison(record,selected,analyses,data.analysis?.phase),quality=$('move-quality');
 quality.hidden=!!aiLine||!!trialOffset||!record.nodes[selected].move;
 const names={best:t('最佳','Best'),good:t('好棋','Good'),inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')};
 const last=record.nodes[selected].move?.index;
 if(!aiLine&&!trialOffset&&last!==null&&last!==undefined&&review.quality){points[last].dataset.quality=review.quality;points[last].setAttribute('aria-label',points[last].getAttribute('aria-label')+' · '+names[review.quality]);}
 quality.dataset.quality=review.quality||'';
 quality.textContent=review.unavailable?(!data.analysis?t('AI 推荐将在分析完成后显示。','Suggestions appear when analysis is ready.'):!analyses.has(review.anchor)?t('此 SGF 分支尚未分析。','This SGF branch has not been analysed.'):data.analysis.schemaVersion>=2?t('此局面没有已搜索的候选着法。','No searched candidate moves in this position.'):t('此分析未保存推荐变化；新上传棋谱将包含此功能。','Suggestions were not saved in this analysis. New uploads include them.')):review.played?t('第 '+record.nodes[selected].depth+' 手 · ','Move '+record.nodes[selected].depth+' · ')+(review.side==='B'?t('黑方 ','Black '):t('白方 ','White '))+review.played+' · '+(names[review.quality]||t('未评定','Unrated'))+(review.loss!==null&&review.quality!=='best'?' · '+t('损失 '+review.loss.toFixed(1)+' 目',review.loss.toFixed(1)+' points lost'):'')+(review.preliminary?t('（快速估计）',' (preliminary)'):''):t('AI 推荐首手','Recommended next moves');
 quality.title=t('按估计损失目数评级：好棋 ≤ 0.5；不精确 ≤ 2；失误 ≤ 5；严重失误 > 5。最佳为 KataGo 首选，不代表数学上的完美。','Estimated point loss: Good ≤ 0.5; Inaccuracy ≤ 2; Mistake ≤ 5; Blunder > 5. Best means KataGo’s top choice, not mathematical perfection.');
 $('ai-next-label').hidden=!aiLine&&!trialOffset;
 $('ai-next-label').textContent=aiLine?aiLine.overview?t('完整推荐变化预览；下表评估属于第 '+record.nodes[aiLine.anchor].depth+' 手后的局面。','Full line preview; table evaluations belong to the position after move '+record.nodes[aiLine.anchor].depth+'.'):t('继续点击棋盘上的推荐点，或使用方向键。只显示已保存的变化，不估算后续局面分数。','Click a suggested point or use the arrows to continue. Saved continuations only; no new position scores.'):trialOffset?t('试下局面未分析。','Preview positions are not analysed.'):'';
 if(!preserveAiTable)$('ai-alternatives').replaceChildren();$('ai-alternatives').hidden=!!trialOffset;
 for(const [rank,candidate] of next.alternatives.entries()){
   const label='ABC'[rank],index=gtpPoint(candidate.move,record.size);
   if(!aiLine&&!trialOffset&&index!==null&&record.nodes[selected].board[index]==='.'&&recommendedLine(record,next.anchor,candidate).frames.length>1){
     const point=points[index];point.classList.add('ai-candidate',candidate.order===0?'ai-best':'ai-good');point.dataset.aiCandidate=candidate.move;point.textContent=label;boardCandidates.set(index,{review:next,candidate});
     const loss=Math.max(0,(next.side==='B'?1:-1)*(next.best.blackLead-candidate.blackLead));
     point.title=label+' · '+candidate.move+' · '+(candidate.order===0?t('最佳','Best'):t('也可','Also good'))+' · '+t('比首选损失 ','Loss versus best: ')+loss.toFixed(1)+t(' 目',' points');point.setAttribute('aria-label',point.title+' · '+t('查看推荐变化','View recommended line'));
   }
 }
 const actualNode=record.nodes[selected].children[0],actualMove=record.nodes[actualNode]?.move,actualRow=next.rows.find(row=>row.actual),legend=$('next-recorded-legend');
 legend.hidden=!!aiLine||!!trialOffset||!actualMove;
 legend.replaceChildren();
 if(actualMove?.index===null)legend.textContent=t('下一手实战：停一手','Next recorded move: Pass');
 else{
  const title=document.createElement('span');title.className='next-move-legend-title';title.textContent=t('△ 下一手实战','△ Next recorded move');legend.append(title);
  for(const [quality,zh,en]of [['best','最佳','Best'],['good','好棋','Good'],['inaccuracy','不精确','Inaccuracy'],['mistake','失误','Mistake'],['blunder','严重失误','Blunder'],['unrated','未评定','Unrated']]){const item=document.createElement('span');item.className='next-move-legend-item';const marker=document.createElement('span');marker.className='next-move-swatch';marker.dataset.quality=quality;marker.setAttribute('aria-hidden','true');item.append(marker,document.createTextNode(t(zh,en)));legend.append(item);}
 }
 if(!aiLine&&!trialOffset&&actualMove?.index!==null&&actualMove?.index!==undefined&&record.nodes[selected].board[actualMove.index]==='.'){
   const point=points[actualMove.index],ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),triangle=document.createElementNS(ns,'polygon');
   svg.setAttribute('viewBox','0 0 100 100');svg.setAttribute('aria-hidden','true');svg.classList.add('recorded-triangle');triangle.setAttribute('points','50,8 92,88 8,88');svg.append(triangle);point.replaceChildren(svg);
   if(actualRow?.label){const letter=document.createElement('span');letter.className='recorded-candidate-letter';letter.textContent=actualRow.label;point.append(letter);}
   point.classList.add('next-recorded-move');point.dataset.nextQuality=actualRow?.quality||'unrated';point.dataset.recordedMove=coord(actualMove.index);boardRecordedMoves.set(actualMove.index,actualNode);
   point.title=t('下一手实战：','Next recorded move: ')+(actualMove.side==='B'?t('黑方 ','Black '):t('白方 ','White '))+coord(actualMove.index)+' · '+(names[actualRow?.quality]||t('未评定','Unrated'));point.setAttribute('aria-label',point.title+' · '+t('前往实战着法','Go to recorded move'));
 }
 if(!preserveAiTable&&next.rows.length){
   const table=document.createElement('table');table.className='ai-move-table';table.setAttribute('aria-label',t('下一手选点比较','Next-move comparison'));
   const head=document.createElement('thead'),header=document.createElement('tr');
   for(const label of [t('选点','Move'),t('评价','Assessment'),t('领先（目）','Lead (points)'),t('胜率（%）','Win %')]){const th=document.createElement('th');th.scope='col';th.textContent=label;header.append(th);}head.append(header);table.append(head);
   const body=document.createElement('tbody');
   for(const row of next.rows){
     const tr=document.createElement('tr');tr.dataset.move=row.move;tr.dataset.actual=String(row.actual);if(row.actual)tr.className='ai-recorded-move';if(aiLine?.overview&&row.candidate===aiLine.rootCandidate)tr.classList.add('ai-selected-move');
     const move=document.createElement('th');move.scope='row';const button=document.createElement('button');button.type='button';button.className='ai-move-choice';button.dataset.side=next.side;button.append((row.label?row.label+' · ':'')+(row.move==='pass'?t('停一手','Pass'):row.move));
     const preview=()=>chooseAiRow(next,row);button.onclick=event=>{event.stopPropagation();preview();};tr.onclick=preview;tr.onmouseenter=()=>{if(hoverAiSuggestions.matches)hoverAiRow(next,row);};tr.onmouseleave=leaveAiRow;button.setAttribute('aria-pressed',String(!!aiLine?.overview&&row.candidate===aiLine.rootCandidate));
     button.setAttribute('aria-label',(next.side==='B'?t('黑方','Black'):t('白方','White'))+' · '+button.textContent+' · '+(row.candidate?t('预览完整推荐变化','Preview full recommended line'):t('查看实战着法','View recorded move')));move.append(button);
     if(row.actual){const badge=document.createElement('button');badge.type='button';badge.className='ai-played-badge';badge.textContent='△';badge.title=t('实战','Played');badge.setAttribute('aria-label',t('前往实战着法','Go to recorded move'));badge.onclick=event=>{event.stopPropagation();selectPosition(row.actualNode);};move.append(badge);}
     const rating=document.createElement('td');rating.append(qualityPill(row.quality||'unrated',names[row.quality]||t('未评定','Unrated')));
     const lead=document.createElement('td');
     if(Number.isFinite(row.blackLead)){
      const badge=document.createElement('span'),even=Math.abs(row.blackLead)<.05,side=even?'even':row.blackLead>0?'black':'white',amount=even?'0.0':Math.abs(row.blackLead).toFixed(1);
      badge.className='ai-score-badge ai-score-'+side;badge.textContent=(row.estimated?'≈ ':'')+amount;
      lead.setAttribute('aria-label',(even?t('双方均势','Even position'):side==='black'?t('黑方领先 '+amount+' 目','Black leads by '+amount+' points'):t('白方领先 '+amount+' 目','White leads by '+amount+' points'))+(row.estimated?t('（估计）',' (estimated)'):''));lead.append(badge);
     }else lead.textContent='—';
     const win=document.createElement('td');
     if(Number.isFinite(row.blackWinrate)){
      const black=Math.max(0,Math.min(1,row.blackWinrate))*100,white=100-black,pair=document.createElement('span');pair.className='ai-win-pair';
      for(const [side,value] of [['black',black],['white',white]]){const badge=document.createElement('span');badge.className='ai-score-badge ai-score-'+side;badge.textContent=value.toFixed(1);pair.append(badge);}
      if(row.estimated){const estimate=document.createElement('span');estimate.className='ai-win-estimate';estimate.textContent='≈';win.append(estimate);}
      win.setAttribute('aria-label',t('黑方 '+black.toFixed(1)+'%，白方 '+white.toFixed(1)+'%','Black '+black.toFixed(1)+'%, White '+white.toFixed(1)+'%')+(row.estimated?t('（估计）',' (estimated)'):''));win.append(pair);
     }else win.textContent='—';
     tr.append(move,rating,lead,win);body.append(tr);
   }
   table.append(body);$('ai-alternatives').append(table);
   if(next.rows.some(row=>row.estimated)){const note=document.createElement('small');note.className='ai-comparison-note';note.textContent=t('≈ 表示由实战后的局面估计；该选点的搜索不足。','≈ Estimated from the position after the played move; that choice had insufficient search.');$('ai-alternatives').append(note);}
 }
 if(!preserveAiTable&&next.unavailable){const note=document.createElement('span');note.textContent=!data.analysis?t('AI 推荐将在分析完成后显示。','Suggestions appear when analysis is ready.'):!analyses.has(selected)?t('此 SGF 分支尚未分析。','This SGF branch has not been analysed.'):data.analysis.schemaVersion>=2?t('此局面没有已搜索的候选着法。','No searched candidate moves in this position.'):t('此分析未保存推荐变化；新上传棋谱将包含此功能。','Suggestions were not saved in this analysis. New uploads include them.');$('ai-alternatives').append(note);}
 if(preserveAiTable)for(const row of $('ai-alternatives').querySelectorAll('tr[data-move]')){const chosen=!!aiLine?.overview&&row.dataset.move===aiLine.rootCandidate.move;row.classList.toggle('ai-selected-move',chosen);row.querySelector('.ai-move-choice').setAttribute('aria-pressed',String(chosen));}
 if(aiLine&&!aiLine.overview&&!trialOffset)renderContinuations();
 $('ai-line-controls').hidden=!aiLine;
 $('ai-line-explore').hidden=!aiLine?.overview;$('ai-line-explore').textContent=t('逐手试下','Explore line');
 if(aiLine){$('ai-line-status').textContent=t('从第 '+record.nodes[aiLine.anchor].depth+' 手后开始的推荐变化','Continuation after move '+record.nodes[aiLine.anchor].depth)+' · '+aiLine.offset+'/'+(aiLine.frames.length-1);$('ai-line-previous').disabled=aiLine.offset===0;$('ai-line-next').disabled=aiLine.offset===aiLine.frames.length-1&&!lineContinuations(record,aiLine,analyses,data.analysis?.phase).length;$('ai-line-clear').textContent=t('返回原局面','Return to original position');}
}

function showAiCandidate(review,candidate,overview=false,keepTable=false){trials=[];trialOffset=0;aiLine=startRecommendedLine(record,review,candidate,overview);$('record-message').textContent=aiLine.truncated?t('推荐变化在无法复现的棋步前停止。','The recommended line stops before a move that cannot be replayed.'):'';if(keepTable)renderAiTable();else render();}

function followAiContinuation(choice){prepareStoneSound();trials=[];trialOffset=0;aiLine=followLineContinuation(aiLine,choice);render();soundCurrentMove();}
function renderContinuations(){
 const choices=lineContinuations(record,aiLine,analyses,data.analysis?.phase);$('ai-alternatives').replaceChildren();
 const heading=document.createElement('p');heading.className='ai-continuation-note';heading.textContent=choices.length?t('后续推荐着法（已保存的变化）','Follow-up moves (saved continuations)'):t('此处没有更多已保存的后续着法。可撤回、选择其他推荐变化或返回原局面。','No further saved continuation here. Go back, choose another line, or return to the original position.');$('ai-alternatives').append(heading);
 for(const [rank,choice] of choices.entries()){
  const label=String(aiLine.offset+1),button=document.createElement('button');button.type='button';button.className='ai-continuation-choice';button.textContent=label+' · '+(choice.move==='pass'?t('停一手','Pass'):choice.move);button.onclick=()=>followAiContinuation(choice);$('ai-alternatives').append(button);
  const index=gtpPoint(choice.move,record.size),node=aiLine.frames[aiLine.offset];
  if(index===null||node.board[index]!=='.')continue;
  const point=points[index];point.classList.add('ai-candidate',rank===0?'ai-best':'ai-good');point.dataset.aiCandidate=choice.move;point.textContent=label;point.title=t('已保存的第 '+label+' 手：','Saved continuation '+label+': ')+choice.move;point.setAttribute('aria-label',point.title);boardCandidates.set(index,{continuation:choice});
 }
}

// Keep the origin table mounted while previews change, so pointer entry/exit
// and keyboard focus stay attached to the same rows.
function renderBoard(node){
 points.forEach((p,i)=>{delete p.dataset.quality;delete p.dataset.aiCandidate;delete p.dataset.nextQuality;delete p.dataset.recordedMove;p.removeAttribute('title');p.className='point'+(node.board[i]==='B'?' black':node.board[i]==='W'?' white':'')+(node.move?.index===i?' last':'');p.disabled=node.board[i]!=='.';p.textContent='';if(aiLine&&!trialOffset){for(let n=1;n<=aiLine.offset;n++){const m=aiLine.frames[n].move;if(m.index===i&&node.board[i]===m.side)p.textContent=String(n);}}if(p.textContent)p.classList.add('ai-number');p.setAttribute('aria-label',coord(i)+' '+(node.board[i]==='B'?t('黑子','Black stone'):node.board[i]==='W'?t('白子','White stone'):t('空点','Empty')));});
 $('board').dataset.preview=node.turn==='B'?'black':'white';
}
function renderAiTable(){
 preserveAiTable=true;
 try{
  if(!aiLine?.overview){render();return;}
  const node=aiLine.frames[aiLine.offset];renderBoard(node);boardCandidates.clear();boardRecordedMoves.clear();
  renderMoveLabel($('move-label'),{depth:node.depth,move:node.move,t,size:record.size,mode:t('AI 变化','AI line')});
  for(const row of $('ai-alternatives').querySelectorAll('tr[data-move]')){const chosen=row.dataset.move===aiLine.rootCandidate.move;row.classList.toggle('ai-selected-move',chosen);row.querySelector('.ai-move-choice').setAttribute('aria-pressed',String(chosen));}
  $('ai-line-controls').hidden=false;$('ai-line-status').textContent=t('第 '+record.nodes[aiLine.anchor].depth+' 手后的完整变化预览','Full preview after move '+record.nodes[aiLine.anchor].depth)+' · '+aiLine.offset+'/'+(aiLine.frames.length-1);
  $('ai-line-previous').disabled=aiLine.offset===0;$('ai-line-next').disabled=aiLine.offset===aiLine.frames.length-1;$('ai-line-clear').textContent=t('返回原局面','Return to original position');$('ai-line-explore').hidden=false;$('ai-line-explore').textContent=t('逐手试下','Explore line');
 }finally{preserveAiTable=false;}
}
function chooseAiRow(review,row){
 if(!row.candidate){aiHover=null;if(row.actual)selectPosition(row.actualNode);return;}
 const pinned=aiHover?aiHover.previous.aiLine:aiLine;
 const alreadySelected=pinned?.overview&&pinned.anchor===review.anchor&&pinned.rootCandidate.move===row.candidate.move;
 aiHover=null;
 if(alreadySelected){aiHoverBlocked=true;clearAiLine(true);}
 else{aiHoverBlocked=false;showAiCandidate(review,row.candidate,true,true);}
}
function hoverAiRow(review,row){
 if(!row.candidate||aiHoverBlocked)return;
 aiHover={previous:{aiLine:aiLine?{...aiLine}:null,trials:trials.slice(),trialOffset}};
 showAiCandidate(review,row.candidate,true,true);
}
function leaveAiRow(){
 aiHoverBlocked=false;if(!aiHover)return;
 ({aiLine,trials,trialOffset}=aiHover.previous);aiHover=null;$('record-message').textContent='';renderAiTable();
}
