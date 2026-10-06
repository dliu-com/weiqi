import {t,setLanguage} from './i18n.js';
import {analysisWait,pendingAnalysis,shouldPollQuick,analysisCompletion,analysisTotalMillis} from './analysis-status.js';
import {reviewMove,nextMoveSuggestions,recommendedLine,gtpPoint} from './ai-review.js';
import {play} from './engine.js';
import {stepReplay} from './replay-navigation.js';
import {gameResult} from './game-result.js';
import {drawEvaluationChart} from './evaluation-chart.js';
import {readSgf} from './sgf.js';
import {libraryRequest} from './library-api.js';
const $=id=>document.getElementById(id),id=location.pathname.match(/^\/(?:record|game)\/([0-9]{10,14}|[a-f0-9-]{36})\/?$/)?.[1] || new URLSearchParams(location.search).get('game');
let data=null,record=null,selected=restorePosition(),loading=false,points=[],analyses=new Map(),trials=[],trialOffset=0,autoplay=null,chartMode='score',pollTimer=null,statusTimer=null,aiLine=null,suggestions=true;
const boardCandidates=new Map();
try{suggestions=localStorage.getItem('weiqi.aiSuggestions')!=='off';}catch{}
function coord(index){return 'ABCDEFGHJKLMNOPQRST'[index%record.size]+(record.size-Math.floor(index/record.size));}
function drawBoard(){const size=record.size,board=$('board');board.replaceChildren();const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${size*10} ${size*10}`);for(let i=0;i<size;i++)for(const horizontal of [true,false]){const line=document.createElementNS(ns,'line');line.setAttribute('x1',horizontal?5:5+i*10);line.setAttribute('y1',horizontal?5+i*10:5);line.setAttribute('x2',horizontal?size*10-5:5+i*10);line.setAttribute('y2',horizontal?5+i*10:size*10-5);line.setAttribute('stroke','#634c2b');line.setAttribute('stroke-width','.4');svg.append(line);}
 const stars=size===19?[3,9,15]:size===13?[3,6,9]:[2,4,6];for(const x of stars)for(const y of stars){if(size===9&&x!==y&&x===4||size===9&&x!==y&&y===4)continue;const c=document.createElementNS(ns,'circle');c.setAttribute('cx',5+x*10);c.setAttribute('cy',5+y*10);c.setAttribute('r',1.1);c.setAttribute('fill','#46351f');svg.append(c);}board.append(svg);
 for(const existing of document.querySelectorAll('.coordinates'))existing.remove();
 for(const side of ['top','bottom','left','right']){const rail=document.createElement('div');rail.className='coordinates coordinates-'+side;rail.setAttribute('aria-hidden','true');for(let i=0;i<size;i++){const label=document.createElement('span');label.textContent=side==='top'||side==='bottom'?'ABCDEFGHJKLMNOPQRST'[i]:size-i;rail.append(label);}board.parentElement.append(rail);}
 points=Array.from({length:size*size},(_,i)=>{const p=document.createElement('button');p.type='button';p.className='point';p.tabIndex=i===180?0:-1;p.addEventListener('click',()=>{const choice=boardCandidates.get(i);if(choice)showAiCandidate(choice.review,choice.candidate);else previewMove(i);});p.addEventListener('keydown',event=>{const offset={ArrowUp:-size,ArrowDown:size}[event.key];if(!offset)return;event.preventDefault();event.stopPropagation();const next=i+offset;if(next>=0&&next<size*size&&(Math.abs(offset)===size||Math.floor(next/size)===Math.floor(i/size))){p.tabIndex=-1;points[next].tabIndex=0;points[next].focus();}});p.style.left=(i%size+.5)/size*100+'%';p.style.top=(Math.floor(i/size)+.5)/size*100+'%';p.style.width=100/size+'%';p.style.height=100/size+'%';board.append(p);return p;});
}
function render(){document.title=(data?.metadata.name || t('棋谱','Game record'))+' · DL';$('library-back').textContent=t('棋谱库','Record library');$('download-original').textContent=t('下载 SGF','Download SGF');$('analysis-title').textContent=t('AI 评估','AI evaluation');$('generate-report').textContent=t('查看 / 下载 AI 报告','View / download AI report');const reportReady=data?.analysis?.phase==='deep'&&data.metadata.analysis.status==='ready';$('generate-report').setAttribute('aria-disabled',String(!reportReady));if(reportReady)$('generate-report').href='/record/'+id+'/report';else $('generate-report').removeAttribute('href');$('generate-report').title=reportReady?t('查看已生成的中英文报告并保存 PDF','View the prepared English/Chinese report and save PDF'):t('深度分析完成后自动生成报告','Report prepared automatically after deep analysis');$('record-main').hidden=!record;if(!record)return;
 const base=record.nodes[selected],node=trials[trialOffset-1] || aiLine?.frames[aiLine.offset] || base;
 $('trial-controls').hidden=!trialOffset;$('trial-undo').textContent=t('撤回试下','Undo preview');$('trial-clear').textContent=t('返回棋谱','Return to record');
 $('autoplay').textContent=autoplay?'Ⅱ':'▶';$('autoplay').setAttribute('aria-pressed',String(!!autoplay));$('autoplay').setAttribute('aria-label',autoplay?t('暂停回放','Pause autoplay'):t('自动回放','Autoplay'));$('autoplay').disabled=!base.children.length&&!autoplay;$('record-name').textContent=data.metadata.name;$('record-players').replaceChildren();for(const side of ['black','white']){const player=document.createElement('div');player.className='record-player record-player-'+side;const stone=document.createElement('span');stone.className='player-stone player-stone-'+side;stone.setAttribute('aria-hidden','true');const colour=document.createElement('span');colour.className='player-colour';colour.textContent=side==='black'?t('黑方','Black'):t('白方','White');const name=document.createElement('strong');name.className='player-name';name.textContent=record.players[side]||t('未命名棋手','Unnamed player');player.append(stone,colour,name);const result=gameResult(record.result),winner=result?.winner;if(result&&(!winner||winner===(side==='black'?'B':'W'))){const badge=document.createElement('span');badge.className='game-result';badge.textContent=t(result.zh,result.en);badge.setAttribute('aria-label',t('棋局结果：','Game result: ')+t(result.zh,result.en));player.append(badge);}$('record-players').append(player);}$('move-label').textContent=(trialOffset?t('试下 · ','Preview · '):aiLine?t('AI 变化 · ','AI line · '):'')+t('第 '+node.depth+' 手','Move '+node.depth)+(node.move?' · '+(node.move.side==='B'?t('黑','Black'):t('白','White'))+' '+(node.move.index===null?t('停一手','Pass'):coord(node.move.index)):'');
 points.forEach((p,i)=>{p.className='point'+(node.board[i]==='B'?' black':node.board[i]==='W'?' white':'')+(node.move?.index===i?' last':'');p.disabled=node.board[i]!=='.';p.textContent='';if(aiLine&&!trialOffset){for(let n=1;n<=aiLine.offset;n++){const m=aiLine.frames[n].move;if(m.index===i&&node.board[i]===m.side)p.textContent=String(n);}}if(p.textContent)p.classList.add('ai-number');p.setAttribute('aria-label',coord(i)+' '+(node.board[i]==='B'?t('黑子','Black stone'):node.board[i]==='W'?t('白子','White stone'):t('空点','Empty')));});
 $('board').dataset.preview=node.turn==='B'?'black':'white';$('back-ten').disabled=!trialOffset&&!aiLine&&selected===0;$('forward-ten').disabled=trialOffset<trials.length?false:trialOffset?true:aiLine?aiLine.offset===aiLine.frames.length-1:!base.children.length;
 $('first').disabled=!trialOffset&&!aiLine&&selected===0;$('previous').disabled=!trialOffset&&!aiLine&&selected===0;$('next').disabled=$('forward-ten').disabled;$('last').disabled=!trialOffset&&!aiLine&&selected===record.mainLine.at(-1);$('branch-label').textContent=node.children.length>1?t('选择分支','Choose variation'):'';$('branch-select').hidden=node.children.length<2;$('branch-select').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent=t('下一手…','Next move…');$('branch-select').append(empty);for(const child of node.children){const n=record.nodes[child],option=document.createElement('option');option.value=child;option.textContent=(n.move.side==='B'?t('黑','Black'):t('白','White'))+' '+(n.move.index===null?t('停一手','Pass'):coord(n.move.index));$('branch-select').append(option);}
 $('record-comment').textContent=node.comment;$('record-details').textContent=[record.size+' × '+record.size,record.date,record.rules || t('未指定规则','Rules unspecified'),t('贴目 ','Komi ')+record.komi].filter(Boolean).join(' · ');
 drawEvaluationChart($('evaluation-chart'),data.analysis?.positions || [],trialOffset||aiLine?-1:selected,node=>selectPosition(node),{chart:chartMode==='win'?t('逐手黑方胜率，点击或使用方向键选择棋步','Black win rate by move. Click or use arrow keys to select a move.'):t('逐手点数优势，点击或使用方向键选择棋步','Point advantage by move. Click or use arrow keys to select a move.'),move:n=>t('第 '+n+' 手','Move '+n),variation:t('当前分支未分析','Current variation is not analysed')},chartMode);
 $('chart-score').textContent=t('点数','Score');$('chart-win').textContent=t('胜率 %','Win %');for(const mode of ['score','win'])$('chart-'+mode).setAttribute('aria-pressed',String(chartMode===mode));$('legend-black').textContent=t('黑方领先','Black ahead');$('legend-white').textContent=t('白方领先','White ahead');
 $('chart-help').textContent=data.analysis?(chartMode==='win'?t('黑方胜率，50% 表示双方均势。点击或按住拖动图表浏览棋步。','Black win rate; 50% is even. Click or hold and drag to explore moves.'):t('黑方优势为正，白方优势为负。点击或按住拖动图表浏览棋步。','Positive: Black leads. Negative: White leads. Click or hold and drag to explore moves.')):'';
 const state=data.metadata.analysis.status,pending=pendingAnalysis(data.metadata.analysis);$('analysis-wait').hidden=!pending&&!!data.analysis&&!trialOffset&&!aiLine&&analyses.has(selected)&&data.metadata.analysis.deep?.status!=='failed'&&state!=='failed';$('analysis-wait').classList.toggle('is-loading',!!pending);const evaluation=trialOffset||aiLine?null:analyses.get(selected);$('lead').textContent='';$('lead').hidden=!!aiLine||!!trialOffset;$('winrate').hidden=true;$('lead').dataset.leader='even';$('analysis-depth').textContent='';
 if(data.analysis){
  const a=data.analysis,network=a.model.match(/b(\d+)c(\d+)/),engine=a.engineVersion.startsWith(a.engine)?a.engineVersion:a.engine+' '+a.engineVersion;
  const phase=a.phase==='quick'?t('快速分析（临时结果）','Quick analysis (preliminary)'):a.phase==='deep'?(a.compute?.instanceType==='g5.xlarge'?t('深度分析（GPU 后备）','Deep analysis (GPU fallback)'):t('深度分析','Deep analysis')):'';
  $('analysis-depth').textContent=[phase,engine+' · '+(network?network.slice(1).join(' × ')+t(' 网络',' network'):a.model)+' · '+(evaluation?.visits??'—')+' / '+a.visits+t(' 次访问',' visits'),analysisCompute(a),t('分析规则：','Analysis rules: ')+a.rules+' · '+t('贴目 ','Komi ')+a.komi,analysisRuntime(a),analysisTotal(a),t('完成于：','Completed: ')+new Date(a.completedAt).toLocaleString(document.documentElement.lang==='zh-CN'?'zh-CN':'en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'longOffset'})+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone].filter(Boolean).join('\n');
 }
 if(data.analysis&&evaluation){$('analysis-status').textContent=pending?pendingMessage():data.metadata.analysis.deep?.status==='failed'?terminalAnalysisMessage():'';const lead=evaluation.blackLead;$('lead').textContent=Math.abs(lead)<0.05?t('双方均势','Even position'):lead>0?t('黑方领先 '+lead.toFixed(1)+' 点','Black leads by '+lead.toFixed(1)+' points'):t('白方领先 '+(-lead).toFixed(1)+' 点','White leads by '+(-lead).toFixed(1)+' points');const blackPercent=Math.max(0,Math.min(100,evaluation.blackWinrate*100)),whitePercent=100-blackPercent;$('lead').dataset.leader=Math.abs(lead)<0.05?'even':lead>0?'black':'white';$('winrate').hidden=false;$('black-probability-label').textContent=t('黑方 ','Black ')+blackPercent.toFixed(1)+'%';$('white-probability-label').textContent=t('白方 ','White ')+whitePercent.toFixed(1)+'%';$('black-probability').style.width=blackPercent+'%';$('probability-bar').setAttribute('aria-label',t('胜率：黑方 ','Win probability: Black ')+blackPercent.toFixed(1)+'%, '+t('白方 ','White ')+whitePercent.toFixed(1)+'%');}
 else $('analysis-status').textContent=aiLine?(pending?pendingMessage():t('AI 推荐变化；后续局面未单独分析。','KataGo recommended line; continuation positions are not separately analysed.')):trialOffset?t('试下局面未分析。','Preview positions are not analysed.'):state==='ready'?t('此分支尚未分析。','This variation has not been analysed.'):state==='limited'?t('今日 AI 分析限额已用完。棋谱已保存，可正常复盘。','The daily AI analysis cap has been reached. Your game is saved and available to replay.'):state==='failed'?terminalAnalysisMessage():pendingMessage();
 renderSuggestions();
}
function pendingMessage(){
 const state=data.metadata.analysis,stage=pendingAnalysis(state)||state;
 if(state.status==='retry_wait'){const remaining=Math.max(0,Math.ceil((Date.parse(state.retryAt)-Date.now())/1000));return t('AI 分析暂时失败。棋谱和已完成的结果已保存。','AI analysis temporarily failed. Your record and completed results are safe.')+'\n'+t('自动重试 ','Automatic retry ')+(state.attempt||1)+'/2 · '+formatAnalysisTime(Date.parse(state.retryAt))+'\n'+(remaining>0?t('还需约 '+Math.ceil(remaining/60)+' 分钟。','About '+Math.ceil(remaining/60)+' min until retry.'):t('重试已到期，等待调度。','Retry is due; awaiting dispatch.'))+'\n'+(data.analysis?t('刷新页面查看深度分析重试进度。','Refresh the page to check the deep-analysis retry.'):t('每 15 秒检查一次。','Checking every 15 seconds.'));}
 const deep=stage.phase==='deep'||data.metadata.benchmark?.queueKind==='deep';
 if(data.metadata.benchmark&&!data.metadata.benchmark.workflow){const started=stage.startedAt||state.startedAt;return (state.status==='queued'?t('基准测试排队中。','Benchmark queued.'):t('基准分析运行中 · 已运行 ','Benchmark analysis running · elapsed ')+Math.floor(Math.max(0,Date.now()-Date.parse(started))/60000)+t(' 分钟',' min')+'\n'+t('开始于：','Started: ')+formatAnalysisTime(Date.parse(started)))+'\n'+analysisTotal(null)+' '+(deep?t('刷新页面以查看深度结果。','Refresh the page for deeper results.'):t('每 15 秒检查快速结果。','Quick results are checked every 15 seconds.'));}
 const wait=analysisWait(stage,data.metadata.moves),completion=analysisCompletion(stage,data.metadata.moves),duration=wait.seconds>=90?t(Math.ceil(wait.seconds/60)+' 分钟',Math.ceil(wait.seconds/60)+' min'):t(wait.seconds+' 秒',wait.seconds+' s');
 const deepName=stage.compute?.instanceType==='g5.xlarge'||stage.fallback?t('深度分析（GPU 后备）','Deep analysis (GPU fallback)'):t('深度分析','Deep analysis');
 const name=deep?(data.analysis?t('当前显示快速结果 · ','Quick results shown · ')+deepName:deepName):t('快速分析','Quick analysis');
 const progress=wait.phase==='queued'?t(' · 排队中 · 处理约 '+duration+'，排队另计。',' · queued · ~'+duration+' processing, plus queue wait.'):wait.phase==='running'?t(' · 预计还需约 '+duration+'。',' · ~'+duration+' remaining.'):t(' · 比预计耗时更长。',' · taking longer than estimated.');
 const estimate=completion?'\n'+(wait.phase==='overdue'?t('原预计完成：','Original estimated finish: '):completion.earliest?t('最早预计完成：','Earliest estimated finish: '):t('预计完成：','Estimated finish: '))+formatAnalysisTime(completion.timestamp):'';
 const check=deep?t('刷新页面查看深度结果。','Refresh the page for deeper results.'):t('每 15 秒检查快速结果。','Quick results are checked every 15 seconds.');
 const retry=state.attempt>1?t('自动重试 '+(state.attempt-1)+'/2 · ','Automatic retry '+(state.attempt-1)+'/2 · '):'';
 return retry+name+progress+estimate+'\n'+analysisTotal(null)+'\n'+check;
}
function terminalAnalysisMessage(){return (data.metadata.analysis.error||t('AI 分析失败。','AI analysis failed.'))+' '+t('已完成两次自动重试。棋谱和已有结果仍可查看。','Both automatic retries have been used. Your record and any completed results remain available.');}
function formatAnalysisTime(timestamp){return new Date(timestamp).toLocaleString(document.documentElement.lang==='zh-CN'?'zh-CN':'en-GB',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'longOffset'})+' · '+Intl.DateTimeFormat().resolvedOptions().timeZone;}
function scheduleStatusTicker(){clearInterval(statusTimer);if(record&&!document.hidden&&pendingAnalysis(data.metadata.analysis))statusTimer=setInterval(()=>{if(trialOffset)return;const message=pendingMessage();if($('analysis-status').textContent!==message)$('analysis-status').textContent=message;},1000);}

function schedulePoll(){clearTimeout(pollTimer);if(record&&!document.hidden&&shouldPollQuick(data.metadata.analysis,data.metadata.benchmark))pollTimer=setTimeout(load,15000);}
async function load(){if(loading)return;loading=true;render();try{if(!/^(?:[0-9]{10,14}|[a-f0-9-]{36})$/.test(id || ''))throw Error('Invalid game link.');const next=await libraryRequest('/api/library/'+id);const parsed=readSgf(next.sgf);if(next.analysis && next.analysis.sgfSha256!==Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(next.sgf))),b=>b.toString(16).padStart(2,'0')).join(''))throw Error('Analysis does not match this record.');data=next;record=parsed;analyses=new Map((data.analysis?.positions || []).map(p=>[p.nodeId,p]));if(selected>=record.nodes.length)selected=0;drawBoard();$('record-message').textContent='';}catch(e){$('record-message').textContent=e.message;}finally{loading=false;render();schedulePoll();scheduleStatusTicker();}}
function stopAutoplay(){if(autoplay){clearInterval(autoplay);autoplay=null;}}
function selectPosition(node,keepPlaying=false){if(!keepPlaying)stopAutoplay();selected=node;try{sessionStorage.setItem('weiqi.replay.'+id,String(node));}catch{}trials=[];trialOffset=0;aiLine=null;$('record-message').textContent='';render();}
function step(amount,keepPlaying=false){
 if(!record)return;if(!keepPlaying)stopAutoplay();
 const next=stepReplay(record,{selected,aiLine,trials,trialOffset},amount);
 ({selected,aiLine,trials,trialOffset}=next);
 try{sessionStorage.setItem('weiqi.replay.'+id,String(selected));}catch{}
 if(keepPlaying&&!record.nodes[selected].children.length)stopAutoplay();
 $('record-message').textContent='';render();
}
function previewMove(index){if(!record)return;stopAutoplay();const base=trials[trialOffset-1]||aiLine?.frames[aiLine.offset]||record.nodes[selected];const history=trials.slice(0,trialOffset).map(n=>n.board);if(aiLine)history.push(...aiLine.frames.slice(1,aiLine.offset+1).map(n=>n.board));for(let n=aiLine?.anchor??selected;n!==null;n=record.nodes[n].parent)history.push(record.nodes[n].board);try{const result=play(base.board,index,base.turn==='B'?'black':'white',19,history);trials=trials.slice(0,trialOffset);trials.push({...base,board:result.board,depth:base.depth+1,move:{side:base.turn,index},turn:base.turn==='B'?'W':'B'});trialOffset=trials.length;render();}catch(e){$('record-message').textContent=e.message;}}
for(const mode of ['score','win'])$('chart-'+mode).onclick=()=>{chartMode=mode;render();};
$('first').onclick=()=>selectPosition(0);$('previous').onclick=()=>step(-1);$('next').onclick=()=>step(1);$('back-ten').onclick=()=>step(-10);$('forward-ten').onclick=()=>step(10);$('last').onclick=()=>selectPosition(record.mainLine.at(-1));$('branch-select').onchange=e=>{if(e.target.value)selectPosition(Number(e.target.value));};
$('trial-undo').onclick=()=>step(-1);$('trial-clear').onclick=clearAiLine;
$('autoplay').onclick=()=>{if(autoplay){stopAutoplay();render();return;}trials=[];trialOffset=0;aiLine=null;autoplay=setInterval(()=>{if(document.hidden||!record.nodes[selected].children.length){stopAutoplay();render();return;}step(1,true);},1000);render();};
document.addEventListener('keydown',event=>{if(!record||event.target.closest('input,select,textarea,[contenteditable=true]')||(!aiLine&&!trialOffset&&event.target.closest('[role=slider]')))return;if(event.key==='ArrowLeft'){event.preventDefault();event.stopPropagation();step(-1);}else if(event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();step(1);}else if(event.key==='Home'){event.preventDefault();selectPosition(0);}else if(event.key==='End'){event.preventDefault();selectPosition(record.mainLine.at(-1));}},{capture:true});
window.addEventListener('resize',()=>{if(record)render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopAutoplay();clearTimeout(pollTimer);clearInterval(statusTimer);render();}else if(data){scheduleStatusTicker();if(shouldPollQuick(data.metadata.analysis,data.metadata.benchmark))schedulePoll();}});
$('download-original').onclick=()=>{if(!data)return;const url=URL.createObjectURL(new Blob([data.sgf],{type:'application/x-go-sgf;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=data.metadata.name.replace(/[^\p{L}\p{N} _-]/gu,'-').slice(0,80)+'.sgf';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.querySelectorAll('[data-language]').forEach(b=>b.onclick=()=>{setLanguage(b.dataset.language);render();});render();load();

// Keep the same controls and listeners while adapting their position to the screen.
const mobileReplay=window.matchMedia('(max-width:850px)');
const replayNavigation=document.querySelector('.record-navigation');
function arrangeReplayControls(){
 const target=document.querySelector(mobileReplay.matches?'.play-area':'.record-summary');
 if(mobileReplay.matches)target.insertBefore(replayNavigation,$('trial-controls'));else target.append(replayNavigation);
 const moveTarget=document.querySelector(mobileReplay.matches?'.play-area':'.record-summary .board-heading');
 if(mobileReplay.matches)moveTarget.insertBefore($('move-label'),replayNavigation);else moveTarget.prepend($('move-label'));
 document.documentElement.style.setProperty('--record-header-height',document.querySelector('header').getBoundingClientRect().height+'px');
}
mobileReplay.addEventListener('change',arrangeReplayControls);
window.addEventListener('resize',arrangeReplayControls);
arrangeReplayControls();

function analysisRuntime(a){
 const engineMs=a.benchmark?.engineMs,elapsed=engineMs??a.elapsedMs;
 if(!Number.isFinite(elapsed))return t('AI 运行时间：未记录','AI runtime: not recorded');
 const seconds=Math.round(elapsed/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remaining=seconds%60;
 const duration=[hours?t(hours+' 小时',hours+' h'):'',minutes?t(minutes+' 分',minutes+' min'):'',t(remaining+' 秒',remaining+' s')].filter(Boolean).join(' ');
 return (Number.isFinite(engineMs)?t('AI 分析时间：','AI analysis time: '):t('AI 作业时间（含准备）：','AI job time (including setup): '))+duration;
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
 if(elapsed===null)return t('总时间（含排队与准备）：未记录','Total time (including queue and setup): not recorded');
 const seconds=a?Math.round(elapsed/1000):Math.floor(elapsed/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return (a?t('总时间（含排队与准备）：','Total time (including queue and setup): '):t('总计已等待（含排队与准备）：','Total elapsed (including queue and setup): '))+(h?h+'h ':'')+m+'m '+String(s).padStart(2,'0')+'s';
}

function clearAiLine(){trials=[];trialOffset=0;aiLine=null;$('record-message').textContent='';render();}
$('ai-suggestions').onchange=event=>{suggestions=event.target.checked;try{localStorage.setItem('weiqi.aiSuggestions',suggestions?'on':'off');}catch{}if(!suggestions&&aiLine){aiLine=null;trials=[];trialOffset=0;}render();};
$('ai-line-previous').onclick=()=>step(-1);
$('ai-line-next').onclick=()=>step(1);
$('ai-line-clear').onclick=clearAiLine;
function renderSuggestions(){
 $('ai-suggestions').checked=suggestions;
 $('ai-suggestions-label').textContent=t('棋步点评与 AI 推荐','Move review & AI suggestions');
 $('ai-review-content').hidden=!suggestions;
 boardCandidates.clear();for(const point of points){delete point.dataset.quality;delete point.dataset.aiCandidate;point.classList.remove('ai-candidate','ai-best','ai-good');point.removeAttribute('title');}
 if(!suggestions)return;
 const review=reviewMove(record,selected,analyses,data.analysis?.phase),next=nextMoveSuggestions(record,selected,analyses,data.analysis?.phase),quality=$('move-quality');
 quality.hidden=!!aiLine||!!trialOffset||!record.nodes[selected].move;
 const names={best:t('最佳着法','Best move'),good:t('好棋','Good move'),inaccuracy:t('不精确','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('严重失误','Blunder')};
 const last=record.nodes[selected].move?.index;
 if(!aiLine&&!trialOffset&&last!==null&&last!==undefined&&review.quality){points[last].dataset.quality=review.quality;points[last].setAttribute('aria-label',points[last].getAttribute('aria-label')+' · '+names[review.quality]);}
 quality.dataset.quality=review.quality||'';
 quality.textContent=review.unavailable?(!data.analysis?t('AI 推荐将在分析完成后显示。','Suggestions appear when analysis is ready.'):!analyses.has(review.anchor)?t('此 SGF 分支尚未分析。','This SGF branch has not been analysed.'):data.analysis.schemaVersion>=2?t('此局面没有已搜索的候选着法。','No searched candidate moves in this position.'):t('此分析未保存推荐变化；新上传棋谱将包含此功能。','Suggestions were not saved in this analysis. New uploads include them.')):review.played?t('第 '+record.nodes[selected].depth+' 手 · ','Move '+record.nodes[selected].depth+' · ')+(review.side==='B'?t('黑方 ','Black '):t('白方 ','White '))+review.played+' · '+(names[review.quality]||t('未评定','Unrated'))+(review.loss!==null&&review.quality!=='best'?' · '+t('约损失 '+review.loss.toFixed(1)+' 点','~'+review.loss.toFixed(1)+' points lost'):'')+(review.preliminary?t('（快速估计）',' (preliminary)'):review.estimated?t('（估计）',' (estimated)'):''):t('AI 推荐首手','Recommended next moves');
 quality.title=t('按估计点数损失评级：好棋 ≤ 0.5；不精确 ≤ 2；失误 ≤ 5；严重失误 > 5。最佳着法为 KataGo 首选，不代表数学上的完美。','Estimated point loss: Good ≤ 0.5; Inaccuracy ≤ 2; Mistake ≤ 5; Blunder > 5. Best means KataGo’s top choice, not mathematical perfection.');
 $('ai-next-label').textContent=aiLine?t('AI 推荐变化；后续局面未单独分析。','AI recommended line; continuation positions are not separately analysed.'):trialOffset?t('试下局面未分析。','Preview positions are not analysed.'):(next.side==='B'?t('黑方行棋','Black to move'):t('白方行棋','White to move'))+' · '+t('第 '+(record.nodes[selected].depth+1)+' 手推荐','Suggestions for move '+(record.nodes[selected].depth+1))+(next.preliminary?t('（快速估计）',' (preliminary)'):'');
 $('ai-alternatives').replaceChildren();$('ai-alternatives').hidden=!!aiLine||!!trialOffset;
 for(const [rank,candidate] of next.alternatives.entries()){
   const label='ABC'[rank],index=gtpPoint(candidate.move,record.size);
   if(!aiLine&&!trialOffset&&index!==null&&record.nodes[selected].board[index]==='.'&&recommendedLine(record,next.anchor,candidate).frames.length>1){
     const point=points[index];point.classList.add('ai-candidate',candidate.order===0?'ai-best':'ai-good');point.dataset.aiCandidate=candidate.move;point.textContent=label;boardCandidates.set(index,{review:next,candidate});
     const loss=Math.max(0,(next.side==='B'?1:-1)*(next.best.blackLead-candidate.blackLead));
     point.title=label+' · '+candidate.move+' · '+(candidate.order===0?t('最佳','Best'):t('也可','Also good'))+' · '+t('比首选损失 ','Loss versus best: ')+loss.toFixed(1)+t(' 点',' points');point.setAttribute('aria-label',point.title+' · '+t('查看推荐变化','View recommended line'));
   }
   const button=document.createElement('button');button.type='button';button.textContent=label+' · '+(candidate.order===0?t('最佳：','Best: '):t('也可：','Also good: '))+(candidate.move==='pass'?t('停一手','Pass'):candidate.move);button.setAttribute('aria-pressed',String(aiLine?.candidate.move===candidate.move));button.onclick=()=>showAiCandidate(next,candidate);$('ai-alternatives').append(button);
 }
 if(next.unavailable){const note=document.createElement('span');note.textContent=!data.analysis?t('AI 推荐将在分析完成后显示。','Suggestions appear when analysis is ready.'):!analyses.has(selected)?t('此 SGF 分支尚未分析。','This SGF branch has not been analysed.'):data.analysis.schemaVersion>=2?t('此局面没有已搜索的候选着法。','No searched candidate moves in this position.'):t('此分析未保存推荐变化；新上传棋谱将包含此功能。','Suggestions were not saved in this analysis. New uploads include them.');$('ai-alternatives').append(note);}
 $('ai-line-controls').hidden=!aiLine;
 if(aiLine){$('ai-line-status').textContent=t('从第 '+record.nodes[aiLine.anchor].depth+' 手后开始的推荐变化','Continuation after move '+record.nodes[aiLine.anchor].depth)+' · '+aiLine.offset+'/'+(aiLine.frames.length-1);$('ai-line-previous').disabled=aiLine.offset===0;$('ai-line-next').disabled=aiLine.offset===aiLine.frames.length-1;$('ai-line-clear').textContent=t('返回棋谱','Return to record');}
}

function showAiCandidate(review,candidate){stopAutoplay();trials=[];trialOffset=0;aiLine=recommendedLine(record,review.anchor,candidate);$('record-message').textContent=aiLine.truncated?t('推荐变化在无法复现的棋步前停止。','The recommended line stops before a move that cannot be replayed.'):'';render();}
