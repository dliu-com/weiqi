// AI analysis page. Copyright 2026 DL; AGPL-3.0-only.
// One photo request reads the board; each analysis is a single short cloud request. Moves stay in this browser.
import './site-shell.js';
import {language,t} from './i18n.js';
import {BoardView} from './board-view.js';
import {readSgf} from './sgf.js';
import {PositionError,positionRequest,cloudPosition} from './position-api.js';
import {emptyBoard,coordinate,setPoint,otherSide,rotateBoard,rotatePoint,stoneCounts,invalidStones,legalMove,previewSequence,sequenceSgf,framesFromRecord} from './analysis-position.js';

const $=id=>document.getElementById(id);
const main=$('analysis-main'),labels=[...document.querySelectorAll('[data-zh]')].map(el=>({el,en:el.textContent,zh:el.dataset.zh}));
const localKey='weiqi.local-analysis.v1',finePointer=matchMedia('(hover:hover) and (pointer:fine)'),phone=matchMedia('(max-width:850px)');
const READ_TIMEOUT=60000,ANALYSE_TIMEOUT=60000,MAX_PHOTO=1050000;
// A photo cannot show earlier captures or ko history, so always score by area (Chinese rules). Komi is 7.5, or 0.5 when chosen.
const RULES='chinese',KOMI_OPTIONS=[7.5,0.5];
const nearestKomi=value=>Number.isFinite(value)&&value<4?0.5:7.5;

let stage='check',busy=null,board=emptyBoard(),side='B',tool='B',review=new Set(),undo=[];
let frames=[{board,turn:side,move:null}],cursor=0,analysis=null,pinned=null,hovered=null,autoAnalyse=false;
let photo=null,showPhoto=false,failed=false,fromPhoto=false,status=null,komi=7.5;
let generation=0,abort=null,abortReason=null,ticker=null,work=null,restoring=true;

const view=new BoardView($('board'),{onPoint:pointClicked});

const serverZh={
 'Invalid photo or position.':'照片或局面无效。',
 'AI is paused by the project spending safeguard.':'AI 已因项目费用保护暂停，请稍后再试。',
 'The spending safeguard is unavailable. Retry later.':'费用保护暂时不可用，请稍后再试。',
 'This request was already used, or today’s public analysis allowance is exhausted.':'今日公共分析额度已用完，请明天再试。',
 'The usage safeguard is unavailable. Retry later.':'用量保护暂时不可用，请稍后再试。',
 'The concurrency safeguard is unavailable.':'服务暂时繁忙，请稍后再试。',
 'Two positions are being processed. Wait a few seconds and try again.':'已有两个局面正在处理，请等几秒再试。',
 'Could not reliably detect the whole board. Try a closer photo with every grid edge visible.':'无法可靠识别整张棋盘。请靠近一些拍摄，并让四条边线都在画面内。',
 'Could not analyse this position. Check the stones and next player.':'无法分析此局面。请检查棋子和下一手。',
 'The position service could not finish. Try again shortly.':'服务未能完成，请稍后再试。',
 'The position service is unavailable.':'服务暂时不可用，请稍后再试。',
 'The position service could not finish.':'服务未能完成，请稍后再试。',
 'Position analysis is not configured.':'服务暂未开放。',
 'The network connection failed.':'网络连接失败，请检查网络后重试。',
 'Use a photo smaller than 25 MB.':'请使用小于 25 MB 的照片。',
 'Use a photo no larger than 18 megapixels.':'请使用不超过 1800 万像素的照片。',
 'This photo is too large. Try a smaller image.':'照片太大，请换一张较小的照片。',
 'This file could not be opened as a photo. Use a JPEG or PNG image.':'无法打开此文件。请使用 JPEG 或 PNG 照片。'
};
function errorText(error){
 if(error?.name==='AbortError')return abortReason==='timeout'?t('请求超时，请重试。','The request took too long. Please try again.'):t('已取消。','Cancelled.');
 const message=error instanceof PositionError||serverZh[error?.message]?error.message:'The position service could not finish. Try again shortly.';
 return t(serverZh[message]||'服务未能完成，请稍后再试。',message);
}
function say(zh,en,tone=''){status={zh,en,tone};}
function sayError(error,prefixZh='',prefixEn=''){status={zh:prefixZh+errorText(error),en:prefixEn+errorText(error),tone:'error',error};}
const seconds=ms=>(ms/1000).toFixed(ms<10000?1:0);
const moveName=m=>m.x<0||m.y<0?'pass':coordinate(m.y*19+m.x);
const letter=rank=>String.fromCharCode(65+rank);
const sideName=s=>s==='B'?t('黑方','Black'):t('白方','White');

function clearAnalysis(){analysis=null;pinned=null;hovered=null;}
function resetFrames(){frames=[{board,turn:side,move:null}];cursor=0;clearAnalysis();autoAnalyse=false;}
// While editing, tool is the colour of the next stone (B or W; placing alternates them) or E for Delete.
const nextByCount=()=>{const {black,white}=stoneCounts(board);return black>white?'W':'B';};
function remember(){undo.push({board,review:[...review],tool});if(undo.length>100)undo.shift();}

function startTicker(){stopTicker();ticker=setInterval(()=>{renderProgress();renderAnalyseButton();},250);}
function stopTicker(){if(ticker)clearInterval(ticker);ticker=null;}
function cancelWork(reason='cancel'){
 generation++;abortReason=reason;abort?.abort();abort=null;clearTimeout(work?.timeout);
 if(work?.pendingPhoto&&work.pendingPhoto!==photo)URL.revokeObjectURL(work.pendingPhoto);
 work=null;busy=null;stopTicker();
}

// Photos are reduced to about 1 MB in the browser before the single recognition request.
async function encodePhoto(file,token){
 if(file.size>25*1024*1024)throw Error('Use a photo smaller than 25 MB.');
 const image=new Image();image.src=work.pendingPhoto;
 try{await image.decode();}catch{throw Error('This file could not be opened as a photo. Use a JPEG or PNG image.');}
 if(token!==generation)return null;
 if(image.naturalWidth*image.naturalHeight>18000000)throw Error('Use a photo no larger than 18 megapixels.');
 let edge=3072,blob;
 do{
  const factor=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
  canvas.width=Math.round(image.naturalWidth*factor);canvas.height=Math.round(image.naturalHeight*factor);canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));edge=Math.round(edge*.8);
 }while(blob&&blob.size>MAX_PHOTO&&edge>700);
 if(!blob||blob.size>MAX_PHOTO)throw Error('This photo is too large. Try a smaller image.');
 const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(binary);
}

async function openPhoto(file){
 if(!file)return;
 if(/\.sgf$/i.test(file.name||''))return openSgf(file);
 if(busy==='analysing'||busy==='reading')cancelWork();
 const token=++generation,previous=stage;
 work={kind:'reading',phase:'prepare',started:performance.now(),upload:0,detectStarted:null,pendingPhoto:URL.createObjectURL(file),previous};
 busy='reading';showPhoto=false;failed=false;status=null;abortReason=null;startTicker();render();
 $('board-wrap').scrollIntoView?.({block:'nearest',behavior:'smooth'});
 try{
  const image=await encodePhoto(file,token);if(token!==generation||!image)return;
  work.phase='upload';abort=new AbortController();work.timeout=setTimeout(()=>{if(token===generation){abortReason='timeout';abort?.abort();}},READ_TIMEOUT);render();
  const result=await positionRequest('recognize',{image},{signal:abort.signal,onUploadProgress:value=>{if(token!==generation||!work)return;work.upload=value;if(value>=1&&work.phase==='upload'){work.phase='detect';work.detectStarted=performance.now();}renderProgress();}});
  if(token!==generation)return;
  if(typeof result.board!=='string'||!/^[BW.]{361}$/.test(result.board))throw new PositionError('The position service could not finish. Try again shortly.');
  if(photo)URL.revokeObjectURL(photo);photo=work.pendingPhoto;work.pendingPhoto=null;
  board=result.board;review=new Set((result.review||[]).filter(i=>Number.isInteger(i)&&i>=0&&i<361));undo=[];tool=nextByCount();fromPhoto=true;side='B';
  resetFrames();stage='check';
  status=null;
 }catch(error){
  if(token!==generation)return;
  if(photo)URL.revokeObjectURL(photo);photo=work?.pendingPhoto||null;if(work)work.pendingPhoto=null;
  stage='check';failed=true;fromPhoto=false;showPhoto=!!photo;clearAnalysis();autoAnalyse=false;
  sayError(error,'无法读取这张照片：','Could not read this photo: ');
  status.zh+=' 可以换一张照片，或对照照片在棋盘上摆放棋子。';status.en+=' Try another photo, or place the stones on the board by comparing with the photo.';
 }finally{
  if(token===generation){clearTimeout(work?.timeout);abort=null;work=null;busy=null;stopTicker();render();}
 }
}
function cancelReading(){
 const previous=work?.previous||'check';cancelWork('cancel');
 stage=previous;say('已取消识别。','Photo reading cancelled.');render();
}

async function openSgf(file){
 if(!file)return;
 if(busy)cancelWork();
 const token=++generation;
 try{
  if(file.size>256*1024)throw Error('Use an SGF no larger than 256 KB.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()),record=readSgf(text);
  if(token!==generation)return;
  if(record.size!==19)throw Error('Use a 19 × 19 SGF.');
  frames=framesFromRecord(record);cursor=frames.length-1;board=frames[cursor].board;side=frames[cursor].turn;
  if(/(?:^|[;\]\s])KM\s*\[/.test(text))komi=nearestKomi(record.komi);
  if(photo)URL.revokeObjectURL(photo);photo=null;showPhoto=false;failed=false;fromPhoto=false;
  review=new Set();undo=[];clearAnalysis();autoAnalyse=false;stage='play';
  status=null;
 }catch(error){
  if(token!==generation)return;
  say('无法打开 SGF：'+error.message,'Cannot open this SGF: '+error.message,'error');
 }
 render();
}

function editPoint(i){
 const current=board[i];
 // Black and White only place on empty points; only Delete removes stones.
 if(tool==='E'?current==='.':current!=='.')return;
 remember();board=setPoint(board,i,tool==='E'?'.':tool);
 if(tool!=='E')tool=otherSide(tool);
 review.delete(i);resetFrames();status=null;render();
}
function chooseTool(key){
 tool=key;render();
}
function pointClicked(i){
 if(busy)return;
 if(stage==='check')return editPoint(i);
 if(stage!=='play')return;
// Continuations are previewed only from the suggestion table; a tap on the board, including on A/B/C, plays the move.
 if(pinned!==null){pinned=null;hovered=null;return renderPreview();}
 hovered=null;playMove(i);
}
function playMove(index){
 if(busy||stage!=='play')return;
 let next=board;
 if(index!==null){
  try{next=legalMove(board,index,side,frames.slice(0,cursor+1).map(f=>f.board));}
  catch{say('这里不能落子：请选择有气的空点，且不能立即回提劫。','You cannot play there: choose an empty point with liberties, and do not retake a ko immediately.','error');return render();}
 }
 const wasAuto=autoAnalyse,mover=side;clearAnalysis();
 frames=frames.slice(0,cursor+1);frames.push({board:next,turn:otherSide(mover),move:{side:mover,index}});cursor++;board=next;side=otherSide(mover);
 if(index===null)say(mover==='B'?'黑方停一手。':'白方停一手。',mover==='B'?'Black passed.':'White passed.');else status=null;
 render();if(wasAuto)analyse();
}
function navigate(target){
 if(busy||stage!=='play')return;
 const next=Math.max(0,Math.min(frames.length-1,target));if(next===cursor)return;
 const wasAuto=autoAnalyse;clearAnalysis();cursor=next;board=frames[cursor].board;side=frames[cursor].turn;status=null;render();if(wasAuto)analyse();
}

async function analyse(){
 if(busy)return;
 const bad=invalidStones(board);
 if(bad.length){say('这些棋子没有气，请先修正：'+bad.map(coordinate).join(', '),'These stones have no liberties. Fix them first: '+bad.map(coordinate).join(', '),'error');return render();}
 const token=++generation;abortReason=null;
 work={kind:'analysing',started:performance.now(),previous:stage};busy='analysing';showPhoto=false;clearAnalysis();status=null;startTicker();
 abort=new AbortController();work.timeout=setTimeout(()=>{if(token===generation){abortReason='timeout';abort?.abort();}},ANALYSE_TIMEOUT);render();
 try{
  const result=await positionRequest('analyze',cloudPosition(frames,cursor,side,RULES,komi),{signal:abort.signal});
  if(token!==generation)return;
  if(!Array.isArray(result.moves))throw new PositionError('The position service could not finish. Try again shortly.');
  analysis={...result,moves:result.moves.slice(0,4),elapsedMs:performance.now()-work.started};
  stage='play';autoAnalyse=true;status=null;
 }catch(error){
  if(token!==generation)return;
  if(error?.name==='AbortError'&&abortReason==='cancel')say('已取消分析。','Analysis cancelled.');
  else sayError(error,'分析未完成：','Analysis did not finish: ');
 }finally{
  if(token===generation){clearTimeout(work?.timeout);abort=null;work=null;busy=null;stopTicker();render();if(analysis)(phone.matches?$('board-wrap'):$('result-card')).scrollIntoView?.({block:phone.matches?'start':'nearest',behavior:'smooth'});}
 }
}
function cancelAnalysis(){cancelWork('cancel');say('已取消分析。','Analysis cancelled.');render();}

function saveLocal(){
 if(restoring)return;
 try{
  if(stage==='check'&&frames.length===1&&!/[BW]/.test(board)){localStorage.removeItem(localKey);$('local-save').textContent='';return;}
  localStorage.setItem(localKey,JSON.stringify({sgf:sequenceSgf(frames,{rules:RULES,komi}),cursor,side,editing:stage==='check'}));
  $('local-save').textContent='';
 }catch{$('local-save').textContent=t('此浏览器无法保存局面。','This browser can’t save the position.');}
}
function restoreLocal(){
 try{
  const saved=JSON.parse(localStorage.getItem(localKey)||'null');if(!saved)return;
  const record=readSgf(saved.sgf);frames=framesFromRecord(record);komi=nearestKomi(record.komi);
  cursor=Math.max(0,Math.min(frames.length-1,Number.isInteger(saved.cursor)?saved.cursor:frames.length-1));board=frames[cursor].board;
  side={B:'B',W:'W',black:'B',white:'W'}[saved.side]||frames[cursor].turn;frames[cursor].turn=side;
  stage=saved.editing?'check':'play';tool=nextByCount();
  say('已恢复上次的局面。上传新照片会替换它。','Restored your last position. A new photo will replace it.');
 }catch{say('无法恢复上次的局面，请重新上传照片或打开 SGF。','Could not restore your last position. Upload a photo or open an SGF again.','error');}
}

function translate(){
 document.documentElement.lang=language==='zh'?'zh-CN':'en';
 document.title=t('AI 分析','AI analysis')+' · DL Weiqi';
 for(const {el,en,zh} of labels)el.textContent=t(zh,en);
 const aria={'board':['分析棋盘','Analysis board'],'sequence-first':['第一手','First move'],'sequence-previous':['上一手','Previous move'],'sequence-next':['下一手','Next move'],'sequence-last':['最后一手','Last move']};
 for(const [id,[zh,en]] of Object.entries(aria))$(id).setAttribute('aria-label',t(zh,en));
 document.querySelector('.tool-switch').setAttribute('aria-label',t('下一颗棋子','Next stone'));
 document.querySelector('.side-switch').setAttribute('aria-label',t('下一手','Next to play'));
 $('stage-photo').alt=t('你的棋盘照片','Your board photo');
 for(const [id,key] of [['tool-B','B'],['tool-W','W'],['tool-E','D'],['undo','Ctrl+Z']])$(id).title=t('快捷键 ','Shortcut: ')+key;
}

function renderSteps(){
 const states=stage==='check'?['current','todo']:['done',analysis?'done':'current'];
 states.forEach((state,i)=>{
  const li=$('step-'+(i+1)),button=li.querySelector('button');li.dataset.state=state;
  if(state==='current')li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');
  button.disabled=!!busy||!(i===0&&stage==='play');
  if(button.disabled)button.removeAttribute('title');else button.title=t('返回第 1 步修改棋子','Go back to step 1 to edit the stones');
 });
}
function editStones(){
 if(busy)return;
 stage='check';tool=side;undo=[];review=new Set();clearAnalysis();autoAnalyse=false;fromPhoto=false;
 status=frames.length>1?{zh:'修改棋子会从当前局面开始新的棋谱。',en:'Changing stones starts a new sequence from this position.',tone:''}:null;render();
}
function renderProgress(){
 if(busy!=='reading'||!work)return;
 const elapsed=performance.now()-work.started,order=['prepare','upload','detect'],at=order.indexOf(work.phase);
 order.forEach((phase,i)=>{$('stage-'+phase).dataset.state=i<at?'done':i===at?'current':'todo';});
 const percent=work.phase==='prepare'?Math.min(10,elapsed/150):work.phase==='upload'?10+30*work.upload:40+55*(1-Math.exp(-(performance.now()-(work.detectStarted||performance.now()))/9000));
 $('progress-fill').style.width=percent.toFixed(1)+'%';
 const s=Math.floor(elapsed/1000);
 $('progress-time').textContent=s>=25?t(s+' 秒 · 比平时慢，请稍候…',s+' s · slower than usual…'):t(s+' 秒 · 通常 10–20 秒',s+' s · usually 10–20 s');
 $('stage-label').textContent=t('正在识别棋盘… '+s+' 秒','Reading the board… '+s+' s');
}
function renderAnalyseButton(){
 const button=$('analyse');
 if(busy==='analysing'&&work)button.textContent=t('正在分析… '+Math.floor((performance.now()-work.started)/1000)+' 秒','Analysing… '+Math.floor((performance.now()-work.started)/1000)+' s');
 else button.textContent=t('AI 分析','AI Analyse');
 button.hidden=!!analysis&&!busy;button.disabled=!!busy;button.classList.toggle('is-loading',busy==='analysing');
}
function renderBoard(){
 const preview=stage==='play'&&analysis&&!busy?(pinned??hovered):null,move=preview!==null?analysis.moves[preview]:null;
 let shown=board,numbers=new Map();
 if(move){const p=previewSequence(board,side,move.pv?.length?move.pv:[moveName(move)]);shown=p.board;numbers=p.numbers;}
 const interactive=!busy,last=!move&&stage==='play'?frames[cursor].move?.index??null:null;
 view.render(shown,{last,turn:stage==='check'&&tool!=='E'?tool:side,interactive,numbers});
 if(!interactive||move||(stage==='play'&&pinned!==null))view.element.dataset.preview='';else if(stage==='check'&&tool==='E')view.element.dataset.preview='erase';
 const bad=move?new Set():new Set(invalidStones(board));
 view.points.forEach((point,i)=>{
  delete point.dataset.candidateQuality;
  if(stage==='check'&&review.has(i))point.classList.add('review');
  if(bad.has(i))point.classList.add('invalid');
 });
 if(stage==='play'&&analysis&&!move&&!busy)analysis.moves.forEach((m,rank)=>{
  if(m.x<0||m.y<0)return;const point=view.points[m.y*19+m.x];
// Markers take the colour of their rating in the table, so a weak suggestion never looks like a good one.
  point.classList.add('ai-candidate');point.dataset.candidateQuality=qualityOf(m,rank);point.textContent=letter(rank);
  point.setAttribute('aria-label',t('AI 推荐 ','AI suggestion ')+letter(rank)+' · '+moveName(m)+' · '+t('在此落子','play here'));
 });
 const mode=busy==='reading'?'reading':showPhoto&&photo?'photo':'none';
 $('photo-stage').dataset.mode=mode;
 const src=busy==='reading'?work?.pendingPhoto:photo;
 if(mode==='reading'||mode==='photo'){if(src&&$('stage-photo').getAttribute('src')!==src)$('stage-photo').src=src;$('stage-photo').hidden=false;}else $('stage-photo').hidden=true;
 $('stage-label').hidden=!(mode==='reading'||(mode==='photo'&&failed));
 if(mode==='photo'&&failed)$('stage-label').textContent=t('无法读取这张照片','Could not read this photo');
}
function qualityOf(m,rank){
 const loss=m.relativePointsLost??m.pointsLost??0;
 return rank===0?'best':loss<=.5?'good':loss<=2?'inaccuracy':loss<=5?'mistake':'blunder';
}
function renderResult(){
 $('result-card').hidden=!analysis||busy!==null||stage!=='play';
 if(!analysis)return;
 const lead=Number(analysis.rootScoreLead)||0,even=Math.abs(lead)<.05;
 $('lead').textContent=even?t('双方均势','Even position'):lead>0?t('黑方领先 '+lead.toFixed(1)+' 目','Black leads by '+lead.toFixed(1)+' points'):t('白方领先 '+(-lead).toFixed(1)+' 目','White leads by '+(-lead).toFixed(1)+' points');
 $('lead').dataset.leader=even?'even':lead>0?'black':'white';
 const black=Math.max(0,Math.min(100,(Number(analysis.rootWinRate)||0)*100)),white=100-black;
 $('black-probability-label').textContent=t('黑方 ','Black ')+black.toFixed(1)+'%';$('white-probability-label').textContent=t('白方 ','White ')+white.toFixed(1)+'%';
 $('black-probability').style.width=black+'%';$('probability-bar').setAttribute('aria-label',t('胜率：黑方 ','Win probability: Black ')+black.toFixed(1)+'%, '+t('白方 ','White ')+white.toFixed(1)+'%');
 const names={best:t('最佳','Best'),good:t('好棋','Good'),inaccuracy:t('欠佳','Inaccuracy'),mistake:t('失误','Mistake'),blunder:t('大恶手','Blunder')};
 const rows=analysis.moves.map((m,rank)=>{
  const tr=document.createElement('tr'),th=document.createElement('th'),button=document.createElement('button');
  th.scope='row';button.type='button';button.className='ai-move-choice';button.dataset.side=side;
  button.textContent=letter(rank)+' · '+(moveName(m)==='pass'?t('停一手','Pass'):moveName(m));
  button.onclick=event=>{event.stopPropagation();togglePreview(rank);};th.append(button);
  const quality=qualityOf(m,rank),rating=document.createElement('td');rating.dataset.quality=quality;rating.textContent=names[quality];
  const leadCell=document.createElement('td'),badge=document.createElement('span'),value=Number(m.scoreLead)||0,level=Math.abs(value)<.05?'even':value>0?'black':'white',amount=level==='even'?'0.0':Math.abs(value).toFixed(1);
  badge.className='ai-score-badge ai-score-'+level;badge.textContent=amount;leadCell.append(badge);
  leadCell.setAttribute('aria-label',level==='even'?t('双方均势','Even position'):level==='black'?t('黑方领先 '+amount+' 目','Black leads by '+amount+' points'):t('白方领先 '+amount+' 目','White leads by '+amount+' points'));
  const win=document.createElement('td'),pair=document.createElement('span'),b=Math.max(0,Math.min(1,Number(m.winRate)||0))*100;pair.className='ai-win-pair';
  for(const [colour,v] of [['black',b],['white',100-b]]){const s=document.createElement('span');s.className='ai-score-badge ai-score-'+colour;s.textContent=v.toFixed(1);pair.append(s);}
  win.setAttribute('aria-label',t('黑方 '+b.toFixed(1)+'%，白方 '+(100-b).toFixed(1)+'%','Black '+b.toFixed(1)+'%, White '+(100-b).toFixed(1)+'%'));win.append(pair);
  tr.append(th,rating,leadCell,win);
  tr.onclick=()=>togglePreview(rank);
  tr.onpointerenter=event=>{if(event.pointerType==='mouse'&&finePointer.matches&&pinned===null){hovered=rank;renderPreview();}};
  tr.onpointerleave=event=>{if(event.pointerType==='mouse'&&hovered===rank){hovered=null;renderPreview();}};
  return tr;
 });
 $('suggestions').replaceChildren(...rows);
 renderSelection();
 $('analysis-time').textContent=seconds(analysis.elapsedMs)+t(' 秒',' s')+(analysis.rootVisits?' · '+analysis.rootVisits+t(' 次搜索',' visits'):'')+' · '+t('贴 '+komi+' 目','komi '+komi)+' · '+t(sideName(side)+'下',sideName(side)+' to play');
}
function renderSelection(){
 if(!analysis)return;
 [...$('suggestions').rows].forEach((tr,rank)=>{tr.setAttribute('aria-selected',String(pinned===rank||(pinned===null&&hovered===rank)));tr.querySelector('.ai-move-choice')?.setAttribute('aria-pressed',String(pinned===rank));});
 const chosen=pinned!==null?analysis.moves[pinned]:null;
 $('play-preview').hidden=!chosen;$('clear-preview').hidden=pinned===null;
 if(chosen)$('play-preview').textContent=t('下这一手 ','Play ')+letter(pinned)+' · '+(moveName(chosen)==='pass'?t('停一手','Pass'):moveName(chosen));
}
function renderPreview(){renderBoard();renderSelection();}
function togglePreview(rank){pinned=pinned===rank?null:rank;hovered=null;renderPreview();}

function render(){
 main.dataset.stage=stage;
 const reading=busy==='reading';
 renderSteps();
 $('upload-box').hidden=stage!=='check'||reading;
 $('photo-button').textContent=failed?t('换一张照片','Try another photo'):t('上传照片','Upload photo');
 $('progress-card').hidden=!reading;
 if(reading)renderProgress();
 $('status').hidden=!status||reading;
 if(status){$('status').textContent=t(status.zh,status.en);$('status').dataset.tone=status.tone;}
 $('check-card').hidden=stage!=='check'||reading;document.querySelector('.tool-switch').hidden=$('check-card').hidden;
 if(stage==='check'){
  const {black,white}=stoneCounts(board);
  $('count-B').textContent=black;$('count-W').textContent=white;$('check-summary').setAttribute('aria-label',t('黑子 '+black+'，白子 '+white,black+' black, '+white+' white'));
  for(const key of ['B','W','E'])$('tool-'+key).setAttribute('aria-pressed',String(tool===key));
  $('review-note').hidden=!review.size;
  $('review-note').textContent=t('请对照照片检查橙色圆圈。','Check the orange rings against the photo.');
  $('photo-thumb').hidden=!photo;if(photo&&$('thumb-photo').getAttribute('src')!==photo)$('thumb-photo').src=photo;
  $('photo-thumb').setAttribute('aria-pressed',String(showPhoto));
  $('photo-thumb').lastElementChild.textContent=showPhoto?t('返回棋盘','Back to board'):t('对照照片','Compare with photo');
  $('undo').disabled=!undo.length;
 }
 const bad=invalidStones(board);
 $('invalid-note').hidden=!bad.length||stage!=='check';
 $('invalid-note').textContent=t('没有气：','No liberties: ')+bad.map(coordinate).join(', ');
 // Next to play and komi belong to step 1; during the analysis the card only appears to run, retry or cancel a request.
 $('analysis-settings').hidden=reading||(stage==='play'&&!!analysis&&!busy);
 $('settings-title').hidden=$('settings-fields').hidden=stage!=='check';
 $('side-B').setAttribute('aria-pressed',String(side==='B'));$('side-W').setAttribute('aria-pressed',String(side==='W'));
 $('side-B').disabled=$('side-W').disabled=!!busy;
 for(const value of KOMI_OPTIONS){$('komi-'+value).setAttribute('aria-pressed',String(komi===value));$('komi-'+value).disabled=!!busy;}
 renderAnalyseButton();
 $('cancel-analysis').hidden=busy!=='analysing';
 $('analyse-note').textContent=busy==='analysing'?t('KataGo 正在云端运行，通常需要 5 秒。','KataGo is running in the cloud; this usually takes 5 s.'):'';$('analyse-note').hidden=!$('analyse-note').textContent;
 const setup=frames[0].board;
 $('sequence-controls').hidden=stage!=='play';
 $('sequence-position').textContent=t('第 '+cursor+' / '+(frames.length-1)+' 手','Move '+cursor+' / '+(frames.length-1));
 $('sequence-first').disabled=$('sequence-previous').disabled=!!busy||cursor===0;
 $('sequence-next').disabled=$('sequence-last').disabled=!!busy||cursor===frames.length-1;
 $('sequence-pass').textContent=t(sideName(side)+'停一手',sideName(side)+' passes');$('sequence-pass').disabled=!!busy;
 renderResult();
 $('file-actions').hidden=stage!=='play'||reading;
 $('edit-stones').disabled=!!busy;
 renderBoard();
 saveLocal();
}

$('photo-file').onchange=event=>{const file=event.target.files[0];event.target.value='';openPhoto(file);};
$('sgf-file').onchange=event=>{const file=event.target.files[0];event.target.value='';openSgf(file);};
const pickPhoto=()=>$('photo-file').click(),pickSgf=()=>$('sgf-file').click();
$('photo-button').onclick=pickPhoto;$('new-photo').onclick=pickPhoto;
$('sgf-button').onclick=pickSgf;$('open-sgf').onclick=pickSgf;
$('cancel-reading').onclick=cancelReading;$('cancel-analysis').onclick=cancelAnalysis;
$('hide-photo').onclick=()=>{showPhoto=false;render();};
$('photo-thumb').onclick=()=>{showPhoto=!showPhoto;render();};
for(const key of ['B','W','E'])$('tool-'+key).onclick=()=>chooseTool(key);
$('undo').onclick=()=>{const last=undo.pop();if(!last)return;board=last.board;review=new Set(last.review);tool=last.tool||tool;resetFrames();render();};
$('rotate').onclick=()=>{remember();board=rotateBoard(board);review=new Set([...review].map(rotatePoint));resetFrames();render();};
$('clear').onclick=()=>{if(!/[BW]/.test(board))return;remember();board=emptyBoard();review=new Set();side=tool='B';resetFrames();say('棋盘已清空，可用“撤销”恢复。','Board cleared. Use Undo to bring the stones back.');render();};
for(const value of KOMI_OPTIONS)$('komi-'+value).onclick=()=>{if(busy||komi===value)return;komi=value;clearAnalysis();autoAnalyse=false;render();};
for(const value of ['B','W'])$('side-'+value).onclick=()=>{if(busy||side===value)return;side=value;frames=frames.slice(0,cursor+1);frames[cursor]={...frames[cursor],turn:side};clearAnalysis();autoAnalyse=false;render();};
$('analysis-settings').onsubmit=event=>{event.preventDefault();analyse();};
$('sequence-first').onclick=()=>navigate(0);$('sequence-previous').onclick=()=>navigate(cursor-1);
$('sequence-next').onclick=()=>navigate(cursor+1);$('sequence-last').onclick=()=>navigate(frames.length-1);
$('sequence-pass').onclick=()=>playMove(null);
$('play-preview').onclick=()=>{const m=pinned!==null?analysis?.moves[pinned]:null;if(m){pinned=null;playMove(m.x<0||m.y<0?null:m.y*19+m.x);}};
$('clear-preview').onclick=()=>{pinned=null;hovered=null;renderPreview();};
$('edit-stones').onclick=editStones;
$('step-1').querySelector('button').onclick=editStones;

for(const zone of [$('board-wrap'),$('upload-box')]){
 zone.addEventListener('dragover',event=>{if(!event.dataTransfer?.types?.includes('Files'))return;event.preventDefault();zone.classList.add('drag-over');});
 zone.addEventListener('dragleave',event=>{if(!zone.contains(event.relatedTarget))zone.classList.remove('drag-over');});
 zone.addEventListener('drop',event=>{event.preventDefault();zone.classList.remove('drag-over');const file=event.dataTransfer?.files?.[0];if(file)openPhoto(file);});
}
document.addEventListener('paste',event=>{const file=[...(event.clipboardData?.files||[])].find(f=>f.type.startsWith('image/'));if(file&&!/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName||'')){event.preventDefault();openPhoto(file);}});
document.addEventListener('keydown',event=>{
 if(/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName||'')||event.altKey)return;
 const key=event.key.toLowerCase();
 if(event.key==='Escape'){if(pinned!==null||hovered!==null){pinned=null;hovered=null;renderPreview();}else if(showPhoto){showPhoto=false;render();}return;}
 if(stage==='check'&&!busy){
  if((event.ctrlKey||event.metaKey)&&key==='z'){event.preventDefault();$('undo').click();return;}
  if(event.ctrlKey||event.metaKey)return;
  const next={b:'B',w:'W',d:'E',e:'E'}[key];if(next)chooseTool(next);
 }
 if(stage==='play'&&!busy&&!event.ctrlKey&&!event.metaKey&&!event.target?.classList?.contains('point')){
  if(event.key==='ArrowLeft'){event.preventDefault();navigate(cursor-1);}else if(event.key==='ArrowRight'){event.preventDefault();navigate(cursor+1);}
 }
});
// On phones the heading and steps sit above the board, so the AI results can follow the board directly.
function arrangeIntro(){
 const intro=$('analysis-intro'),panel=document.querySelector('#analysis-main>.workspace-panel'),playArea=document.querySelector('#analysis-main>.play-area');
 if(phone.matches){if(intro.nextElementSibling!==playArea)playArea.before(intro);}else if(intro.parentElement!==panel)panel.prepend(intro);
}
// On phones the Black/White/Delete tools and Undo sit right under the board, so editing never needs scrolling.
function arrangeTools(){
 const tools=document.querySelector('.tool-switch'),toolbar=document.querySelector('#check-card .editor-toolbar'),undo=$('undo');
 if(phone.matches){if(tools.previousElementSibling!==$('board-wrap'))$('board-wrap').after(tools);if(undo.parentElement!==tools)tools.append(undo);}
 else{if(tools.parentElement!==$('check-card'))$('review-note').before(tools);if(undo.parentElement!==toolbar)toolbar.prepend(undo);}
 tools.classList.toggle('on-board',phone.matches);
}
phone.addEventListener?.('change',()=>{arrangeIntro();arrangeTools();});arrangeIntro();arrangeTools();
window.addEventListener('site-language-change',()=>{translate();render();});
window.addEventListener('pagehide',()=>{cancelWork();if(photo)URL.revokeObjectURL(photo);});

restoreLocal();restoring=false;translate();render();
