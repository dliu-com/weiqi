import './site-shell.js';
import {BoardView} from './board-view.js';
import {mountStoneSound,prepareStoneSound,playStoneSound} from './stone-sound.js';
import {localTimestamp} from './site-time.js';
import { t, language, setLanguage, translateError } from './i18n.js';
import { play, opposite, score, gameTree, reviewPosition, gameClock, sgf, MIN_LIBRARY_MOVES, MAX_GAME_MOVES } from './engine.js';
const $ = id => document.getElementById(id);
mountStoneSound($('play-sound'));
const names = { get black() { return t('黑方','Black'); }, get white() { return t('白方','White'); } };
const archiveId = new URLSearchParams(location.search).get('game');
const apiPath = archiveId ? '/api/games/' + encodeURIComponent(archiveId) : '/api/game';
const gameTitle = s => s.gameName || t('现场对弈 · ','Live game · ')+localTimestamp(s.createdAt || s.updatedAt || Date.now(),language);
const letters = 'ABCDEFGHJKLMNOPQRST';
const coord = i => letters[i % 19] + (19 - Math.floor(i / 19));
let syncFailed = false;
function showSyncWarning(failed) {
  syncFailed = failed;
  $('sync-warning').hidden = !failed;
  $('sync-warning').textContent = t('同步中断：无法连接服务器，棋盘可能不是最新状态。请检查网络；连接恢复后会自动更新。','Sync interrupted: the server could not be reached. This board may be out of date. Check your connection; syncing resumes when the connection returns.');
}
let moveStatus = null;
let viewSavedGame = false, pendingSavedGeneration = null, resultRevision = null, countedResult = null;
let reviewing = null, treeRenderKey = '', trialMoves = [];
function previewMove(index) {
  if (reviewing === null || busy || !state) return;
  const base = trialMoves.at(-1) || reviewPosition(state, reviewing);
  const previous = trialMoves.map(position => position.board), tree = gameTree(state);
  for (let id = reviewing; id !== -1; id = tree.nodes[id][0]) previous.push(reviewPosition(state,id).board);
  previous.push(tree.root);
  try {
    const result = play(base.board,index,base.turn,19,previous);
    trialMoves.push({...base,board:result.board,turn:opposite(base.turn),captures:{...base.captures,[base.turn]:base.captures[base.turn]+result.captured.length},last:{type:'move',index}});
    render();playStoneSound();
  } catch(error) { notice(translateError(error.message)); }
}
let state = null, busy = false, polling = false, automatic = true, lastActivity = Date.now(), noticeTimer, pendingConfirmation;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6000); }
async function request(method = 'GET', payload) {
  const headers = {}, options = { method, cache: 'no-store', signal: AbortSignal.timeout(10000), headers };
  if (payload) {
    options.body = JSON.stringify(payload); headers['content-type'] = 'application/json';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body));
    headers['x-amz-content-sha256'] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  }
  const response = await fetch(apiPath, options), data = await response.json();
  if (!response.ok) { const error = new Error(data.message || t("同步失败，请稍后重试。","Sync failed. Please try again.")); error.state = data.state; error.httpStatus = response.status; throw error; }
  showSyncWarning(false);
  return data.state;
}
function adopt(next) {
  if (state && (next.revision < state.revision || (next.revision === state.revision && (next.clockVersion || 0) < (state.clockVersion || 0)))) return;
  if (!state || next.board !== state.board || next.history.length !== state.history.length) lastActivity = Date.now();
  if (moveStatus && moveStatus.phase !== 'submitting' && state && next.revision > state.revision) moveStatus = null;
  if (state && gameTree(next).nodes.length < gameTree(state).nodes.length) { reviewing = null; trialMoves = []; treeRenderKey = ''; }
  if (state && (state.generation || 0) !== (next.generation || 0)) reviewing = null;
  if (reviewing !== null && reviewing >= gameTree(next).nodes.length) reviewing = null;
  const freshGame=state&&(state.generation||0)!==(next.generation||0),previousGeneration=state?.generation||0,previousMoves=state?.history.length||0;
  const newStone=state&&!freshGame&&next.history.length===state.history.length+1&&next.history.at(-1)?.type==='move';
  state = next; render();if(newStone)playStoneSound();
  if (pendingSavedGeneration !== null && next.lastSavedGame?.generation === pendingSavedGeneration) {
    pendingSavedGeneration = null; location.assign('/game/' + encodeURIComponent(next.lastSavedGame.id));
  }
  if(freshGame)notice(next.lastSavedGame?.generation===previousGeneration?t('棋局已保存到棋谱库，新一局已准备好。','Game saved to the library. A new game is ready.'):previousMoves>MAX_GAME_MOVES?t(`超过 ${MAX_GAME_MOVES} 手，本局未保存。新一局已准备好。`,`Over ${MAX_GAME_MOVES} moves, so the game was not saved. A new game is ready.`):t(`不足 ${MIN_LIBRARY_MOVES} 手，本局未保存。新一局已准备好。`,`Under ${MIN_LIBRARY_MOVES} moves, so the game was not saved. A new game is ready.`));
}
async function sync(manual = false) {
  if (busy || polling) return;
  polling = true;
  try { adopt(await request(!archiveId && automatic && document.visibilityState === 'visible' ? 'POST' : 'GET', !archiveId && automatic && document.visibilityState === 'visible' ? {action:{type:'heartbeat'}} : undefined)); $('sync').textContent = t("已同步 · ","Synced · ") + localTimestamp(Date.now(),language); }
  catch { showSyncWarning(true); $('sync').textContent = t("连接失败，请重试","Connection failed. Please retry."); if (manual) notice(t("无法读取云端棋局，请检查网络。","Unable to load the game. Check your connection.")); }
  finally { polling = false; }
}
async function action(action) {
  const metadata = action.type === 'metadata';
  if (busy || !state || (!metadata && (archiveId || reviewing !== null))) return;
  const revision = state.revision;
  const status = moveStatus = action.type === 'move' ? {side:state.turn,phase:'submitting'} : null;
  busy = true;
  const slowTimer = setTimeout(() => { if (status && moveStatus === status) { status.slow = true; render(); } if (busy) $('sync').textContent = t("正在核对棋局…","Checking the latest position…"); }, 1500);
  try {
    const remote = await request(); adopt(remote);
    if (remote.revision !== revision) { moveStatus = null; $('sync').textContent = t('已同步最新棋局','Latest position synced'); notice(t("对方已更新棋局，已同步。请重新操作。","The game has changed and is now synced. Please try your move again.")); return; }
    adopt(await request('POST', { expectedRevision: revision, action }));
    moveStatus = null;
    $('sync').textContent = t("已保存 · ","Saved · ") + localTimestamp(Date.now(),language);
  } catch (e) {
    if (!e.httpStatus) showSyncWarning(true);
    if (moveStatus) moveStatus.phase = 'failed';
    render();
    if (e.state) adopt(e.state);
    notice(translateError(e.message) || t("保存失败，请重新同步。","Save failed. Please sync again."));
    // Recover an uncertain POST without replaying an action that may already have succeeded.
    try { adopt(await request()); if (moveStatus && state.revision === revision + 1 && state.history.at(-1)?.index === action.index && state.history.at(-1)?.side === moveStatus.side) moveStatus = null; $('sync').textContent = t("已重新同步，请核对棋局","Synced again. Please check the position."); }
    catch { showSyncWarning(true); $('sync').textContent = t("连接失败，请同步后重试","Connection failed. Sync and try again."); }
  } finally { clearTimeout(slowTimer); busy = false; render(); }
}
function canPlay() { return state && !archiveId && reviewing === null && state.phase === 'play' && !state.clock?.paused && state.history.length < MAX_GAME_MOVES; }
function render() {
  if (!state) return;
  $('game-name').textContent = gameTitle(state);
  $('player-names').textContent = names.black + (state.players?.black ? ': ' + state.players.black : '') + ' · ' + names.white + (state.players?.white ? ': ' + state.players.white : '');
  $('edit-game').textContent=t('编辑棋局信息','Edit game info');
  for(const [id,zh,en] of [['live-black-rank-label','黑方段级位','Black rank'],['live-white-rank-label','白方段级位','White rank'],['live-date-label','日期','Date'],['live-rules-label','规则','Rules'],['live-komi-label','贴目','Komi']])$(id).textContent=t(zh,en);
  for(const option of document.querySelectorAll('#live-rules option'))option.textContent=option.value==='Chinese'?t('中国规则','Chinese rules'):t('日本规则','Japanese rules');
  $('edit-game').disabled = state.phase==='ended';
  const review = reviewing === null ? null : reviewPosition(state, reviewing);
  const displayed = (review && trialMoves.at(-1)) || review || state;
  $('board').dataset.preview = !busy && (review || canPlay()) ? displayed.turn : '';
  const last = review ? displayed.last : state.history.at(-1), scoring = state.phase === 'scoring', ended = state.phase === 'ended';
  const totals = !review && (scoring || state.result?.reason === 'score') ? score(state.board,19,state.dead,state.komi) : null;
  for (let i = 0; i < 361; i++) {
    const el = points[i], value = displayed.board[i];
    el.className = 'point' + (value === 'B' ? ' black' : value === 'W' ? ' white' : '') + ((!review && state.dead.includes(i)) ? ' dead' : '') + (last?.type === 'move' && last.index === i ? ' last' : '') + (totals?.territory[i] ? ' territory-' + totals.territory[i] : '');
    el.setAttribute('aria-label',coord(i) + (value === 'B' ? t(" 黑子"," black stone") : value === 'W' ? t(" 白子"," white stone") : t(" 空点"," empty intersection")) + ((!review && state.dead.includes(i)) ? t(" 已标记死子"," marked dead") : ''));
    el.setAttribute('aria-disabled',String(busy || (!review && (!!archiveId || ended || (!scoring && !canPlay())))));
  }
  $('turn').textContent = ended ? (state.result.winner ? names[state.result.winner] + t("胜"," wins") : state.result.reason==='unfinished' ? t('未完成','Unfinished') : t("和棋","Draw")) : scoring ? t("双方数子","Scoring") : t("轮到","To play: ") + names[state.turn];
  $('detail').textContent = ended ? (state.result.reason==='unfinished' ? t('本局未完成。','The game was not finished.') : state.result.reason === 'resign' ? t("对方认输，本局结束。","The opponent resigned. Game over.") : state.result.reason==='agreed'?t('双方约定结果，棋局已保存。','Agreed result; game saved.'):t(`胜差 ${state.result.margin} 目 · 黑贴 ${state.komi} 目`,`Margin: ${state.result.margin} points · White komi: ${state.komi}`)) : scoring ? t("标记所有死子，然后确认胜负。","Mark all dead stones, then confirm the result.") : (canPlay() ? '' : state.history.length >= MAX_GAME_MOVES ? t(`已达 ${MAX_GAME_MOVES} 手上限，请点击“新一局”选择结果。`,`${MAX_GAME_MOVES}-move limit reached. Select New game to choose the result.`) : t("等待对方落子…","Waiting for the other player…")) + t(' 黑贴 '+state.komi+' 目。',' White komi: '+state.komi+' points.');
  $('black-captures').textContent = displayed.captures.black; $('white-captures').textContent = displayed.captures.white;
  const undoSide = state.history.at(-1)?.side;
  $('undo').textContent = undoSide ? t('悔棋（' + names[undoSide] + '）', 'Undo ' + names[undoSide]) : t('悔棋','Undo');
  for (const side of ['black','white']) {
    $('resign-' + side).textContent = names[side] + t('认输',' resigns');
    $('resign-' + side).disabled = !!archiveId || reviewing !== null || ended;
  }
  $('undo').dataset.side = undoSide || '';
  $('pass').textContent = names[state.turn] + t('停一手',' passes');
  $('pass').disabled = !canPlay(); $('undo').disabled = !!archiveId || reviewing !== null || !state.history.length; $('new').disabled = !!archiveId || reviewing !== null;
  $('scoring').hidden = !totals;
  $('scoring-help').hidden = ended;
  $('scoring-actions').hidden = ended || !!archiveId;
  if (totals) $('score').textContent = t(`黑 ${totals.black} 目 · 白 ${totals.white} + ${state.komi} 目 → ${totals.winner ? names[totals.winner] + '胜 ' + totals.margin + ' 目' : '和棋'}`,`Black ${totals.black} · White ${totals.white} + ${state.komi} → ${totals.winner ? names[totals.winner] + ' wins by ' + totals.margin + ' points' : 'Draw'}`);
  $('confirm-score').disabled = !!archiveId || reviewing !== null;
  $('count').textContent = state.history.length + t(" 手"," moves");
  if (archiveId && !review) { $('turn').textContent = t('已归档棋局','Archived game'); $('detail').textContent = t('选择棋谱节点查看历史局面。','Select a tree node to review an earlier position.'); }
  if (!archiveId && !review && state.phase === 'play' && state.clock?.paused) $('detail').textContent = t('计时已暂停，请恢复计时后继续。','Clock paused. Resume it to continue playing.');
  if (review) {
    $('turn').textContent = trialMoves.length ? t('试下 · 轮到','Preview · To play: ') + names[displayed.turn] : t('复盘 · 第 ' + review.depth + ' 手', 'Review · Move ' + review.depth);
    $('detail').textContent = t('可在此局面试下，不保存、不影响当前棋局。选择其他节点或返回当前棋局即清除。', 'Try moves here without saving or changing the live game. Selecting another node or returning to live clears them.');
  }
  const pendingMove = moveStatus && (moveStatus.phase !== 'submitting' || moveStatus.slow) ? moveStatus : null;
  if (pendingMove && !review && !archiveId) {
    $('turn').textContent = names[moveStatus.side] + (moveStatus.phase === 'submitting' ? t(' · 正在提交…',' · Submitting…') : t(' · 未发送',' · Not sent'));
    $('detail').textContent = moveStatus.phase === 'submitting' ? t('正在核对并保存落子，请稍候。','Checking and saving your move. Please wait.') : t('落子未发送，请检查网络后重试。','Move not sent. Check your connection and try again.');
  }
  $('turn').className = 'turn-label' + (!review && (state.phase === 'play' || state.result?.winner) ? ' turn-' + (pendingMove?.side || state.result?.winner || state.turn) : '');
  $('new').textContent=t('新一局','New game');$('end-game-cancel').textContent=t('取消','Cancel');
  renderResultDialog();
  if (review) $('turn').className = 'turn-label turn-' + displayed.turn;
  $('trial-controls').hidden = !review;
  $('trial-undo').disabled = !trialMoves.length;
  $('trial-reset').disabled = !trialMoves.length;
  $('trial-undo').textContent = t('撤回试下','Undo preview');
  $('trial-reset').textContent = t('清除试下','Clear preview');
  renderTree();
  renderClock();

}

function selectReview(id) { reviewing = id; trialMoves = []; render(); }
$('trial-undo').onclick = () => { trialMoves.pop(); render(); };
$('trial-reset').onclick = () => { trialMoves = []; render(); };
function renderTree() {
  const tree = gameTree(state), selected = reviewing === null ? tree.head : reviewing, active = new Set();
  for (let id = tree.head; id !== -1; id = tree.nodes[id][0]) active.add(id);
  $('review-status').textContent = archiveId ? t('已归档棋局 · 试下不会保存','Archived game · Preview moves are not saved') : reviewing === null
    ? ''
    : t('正在复盘 · 云端棋局继续同步', 'Reviewing · Live game still syncs');
  $('review-status').hidden = !$('review-status').textContent;
  $('review-start').setAttribute('aria-label',t('查看初始棋盘','Review initial position'));
  $('review-prev').setAttribute('aria-label',t('查看上一手','Review previous move'));
  $('review-next').setAttribute('aria-label',t('查看下一手','Review next move'));
  $('review-prev').disabled = selected === -1;
  $('review-next').disabled = !tree.nodes.some((n,id) => n[0] === selected && (archiveId || active.has(id)));
  $('review-live').disabled = !archiveId && reviewing === null;
  const key = [state.players?.black,state.players?.white,state.generation || 0,tree.nodes.length,tree.head,reviewing,language].join(':');
  if (key === treeRenderKey) return;
  treeRenderKey = key;
  const scroll = $('history').scrollTop;
  const children = new Map();
  tree.nodes.forEach((node,id) => { if (!archiveId && !active.has(id)) return; if (!children.has(node[0])) children.set(node[0],[]); children.get(node[0]).push(id); });
  const fragment = document.createDocumentFragment();
  const pending = [{id:-1,depth:0,branch:0}];
  while (pending.length) {
    const {id,depth,branch} = pending.pop(), node = tree.nodes[id], button = document.createElement('button');
    button.type = 'button'; button.className = 'tree-node' + (node ? ' tree-' + node[1] : '') + (active.has(id) ? ' active-path' : '');
    button.style.marginLeft = Math.min(branch,6) * 12 + 'px';
    button.setAttribute('aria-pressed', String(selected === id));
    button.title = node?.[4] ? localTimestamp(node[4],language) : t('落子时间未记录','Move time not recorded');
    const description = (branch ? '↳ ' : '') + (node ? depth + '. ' + names[node[1]] + (state.players?.[node[1]] ? ' (' + state.players[node[1]] + ')' : '') + ' · ' + (node[2] === null ? t('停一手','Pass') : coord(node[2])) : t('初始棋盘','Initial position')) + (id === tree.head ? (archiveId ? t(' · 最后局面',' · Final position') : t(' · 当前',' · Live')) : '');
    const label = document.createElement('span'); label.className = 'tree-label'; label.textContent = description;
    if (node) { const marker = document.createElement('span'); marker.className = 'tree-stone'; marker.setAttribute('aria-hidden','true'); button.append(marker); }
    button.append(label);
    button.title = description + ' · ' + button.title;
    button.setAttribute('aria-label',button.title);
    button.onclick = () => selectReview(id);
    if (node?.[4]) { const time = document.createElement('small'); time.textContent = localTimestamp(node[4],language); button.append(time); }
    fragment.append(button);
    const next = children.get(id) || [];
    for (let i = next.length - 1; i >= 0; i--) pending.push({id:next[i],depth:depth+1,branch:branch+(next.length > 1 ? 1 : 0)});
  }
  $('history').replaceChildren(fragment); $('history').scrollTop = scroll;
}
$('review-start').onclick = () => { if (state) selectReview(-1); };
$('review-prev').onclick = () => { if (!state) return; const tree = gameTree(state), id = reviewing === null ? tree.head : reviewing; if (id !== -1) selectReview(tree.nodes[id][0]); };
$('review-next').onclick = () => {
  if (!state) return;
  const tree = gameTree(state), id = reviewing === null ? tree.head : reviewing;
  // Prefer the current game's continuation at a fork.
  let next = archiveId ? tree.nodes.findIndex(n => n[0] === id) : -1;
  for (let p = tree.head; p !== -1; p = tree.nodes[p][0]) if (tree.nodes[p][0] === id) { next = p; break; }
  if (next !== -1) selectReview(next);
};
$('review-live').onclick = () => { if (archiveId) { location.href = './'; return; } reviewing = null; trialMoves = []; render(); };

function renderClock() {
  if (!state) return;
  const saved = reviewing !== null ? gameTree(state).nodes[reviewing]?.[5] : null;
  const clock = reviewing === null ? gameClock(state) : {black:saved?.[0] || 0,white:saved?.[1] || 0,paused:true};
  const format = ms => { const seconds = Math.floor(ms/1000); return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':'); };
  $('black-time').textContent = names.black + ' ' + (reviewing !== null && !saved ? '—' : format(clock.black));
  $('white-time').textContent = names.white + ' ' + (reviewing !== null && !saved ? '—' : format(clock.white));
  $('pause-clock').disabled = !!archiveId || reviewing !== null || state.phase !== 'play';
  $('pause-clock').textContent = state.clock?.paused ? t('恢复计时','Resume clock') : t('暂停计时','Pause clock');
  $('clock-note').textContent = reviewing !== null ? t('该手结束时的累计用时','Total time at this move') : !state.clock?.since ? '' : state.phase !== 'play' ? t('计时已停止','Clock stopped') : state.clock?.paused ? t('计时已暂停','Clock paused') : clock.autoPaused ? t('无人在线，计时自动暂停','No active page · Clock automatically paused') : t('所有页面离线 1 分钟后自动暂停','Auto-pauses after all pages are inactive for 1 minute');
  $('clock-note').hidden = !$('clock-note').textContent;
}
$('pause-clock').onclick = () => { if (state) action({type:'clock',paused:!state.clock?.paused}); };
$('download-sgf').onclick = () => {
  if (!state) return;
  const url = URL.createObjectURL(new Blob([sgf(state)],{type:'application/x-go-sgf;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download=(state.gameName || state.createdAt || 'weiqi').replace(/[^\p{L}\p{N} _-]/gu,'-').slice(0,80)+'.sgf'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
setInterval(renderClock,1000);
const boardView=new BoardView($('board'),{onPoint:i=>{if(busy||!state)return;prepareStoneSound();if(reviewing!==null){previewMove(i);return;}if(archiveId)return;if(state.phase==='scoring')action({type:'dead',index:i});else if(canPlay())action({type:'move',index:i});}});
const points=boardView.points;
function confirmAction(title,text,operation,acceptLabel=t('确认','Confirm')) { $('accept-confirm').textContent=acceptLabel; $('confirm-title').className=''; const revision = state.revision; pendingConfirmation = () => { if (state.revision !== revision) { notice(t('棋局已更新，请重新确认。','The game has changed. Please confirm again.')); return; } operation(); }; $('confirm-title').textContent=title; $('confirm-text').textContent=text; $('confirm-dialog').showModal(); }
$('cancel-confirm').onclick=()=>$('confirm-dialog').close(); $('accept-confirm').onclick=()=>{ $('confirm-dialog').close(); pendingConfirmation?.(); };
function renderResultDialog(){
  const counted=score(state.board,state.size,state.dead,state.komi),short=state.history.length<MIN_LIBRARY_MOVES,long=state.history.length>MAX_GAME_MOVES;
  $('result-label').textContent=t('本局结果','Game result');
  $('result-options').setAttribute('aria-label',t('结果','Result'));
  $('result-count-summary').textContent=t(`自动数子：黑 ${counted.black} 目 · 白 ${counted.white} + ${state.komi} 目`,`Automatic count: Black ${counted.black} · White ${counted.white} + ${state.komi}`);
  $('result-count-winner').textContent=counted.winner?t(`${names[counted.winner]}胜 ${counted.margin} 目`,`${names[counted.winner]} wins by ${counted.margin} points`):t('和棋','Draw');
  $('result-count-winner').dataset.winner=counted.winner||'draw';
  for(const side of ['black','white']){$('result-score-'+side+'-text').textContent=t(names[side]+'胜',names[side]+' wins by');$('result-resign-'+side+'-text').textContent=t(names[side]+'中盘胜',names[side]+' wins by resignation');}
  for(const unit of document.querySelectorAll('#result-options .result-unit'))unit.textContent=t('目','points');
  $('result-draw-text').textContent=t('和棋','Draw');$('result-unfinished-text').textContent=t('未完成','Unfinished');
  document.querySelector('#result-options [data-row="draw"]').hidden=!!counted.winner&&!document.querySelector('#result-options input[value="draw"]').checked;
  $('result-short').hidden=!short&&!long;$('result-short').textContent=long?t(`超过 ${MAX_GAME_MOVES} 手：本局不会保存到棋谱库，也不做 AI 分析。`,`Over ${MAX_GAME_MOVES} moves: this game will not be saved to the library or analysed.`):t(`不足 ${MIN_LIBRARY_MOVES} 手：本局不会保存到棋谱库，也不做 AI 分析。`,`Under ${MIN_LIBRARY_MOVES} moves: this game will not be saved to the library or analysed.`);
  $('end-game-confirm').textContent=short||long?t('结束本局','End game'):viewSavedGame?t('保存并查看棋谱','Save and view game'):t('保存并开始新一局','Save and start a new game');
  $('end-game-confirm').disabled=busy;$('end-game-cancel').textContent=t('取消','Cancel');
}
const selectResult=value=>{const input=document.querySelector(`#result-options input[value="${value}"]`);if(input)input.checked=true;};
// One dialog for every ending; the automatic count is selected unless a resign button opened it.
function chooseGameResult(openSaved = false, preset = null){
  if(!state||busy||archiveId||reviewing!==null)return;
  viewSavedGame=openSaved;
  if(state.phase==='ended'){sync(true);return;}
  const counted=score(state.board,state.size,state.dead,state.komi);
  countedResult={choice:counted.winner?'score-'+counted.winner:'draw',margin:counted.margin};resultRevision=state.revision;
  for(const side of ['black','white']){$('margin-'+side).value=counted.winner===side?counted.margin:'';$('margin-'+side).setCustomValidity('');}
  for(const input of document.querySelectorAll('#result-options input[name="result"]'))input.checked=false;
  selectResult(preset||countedResult.choice);render();$('end-game-dialog').showModal();
}
function finishGame(result){pendingSavedGeneration=viewSavedGame&&state.history.length>=MIN_LIBRARY_MOVES&&state.history.length<=MAX_GAME_MOVES?(state.generation||0):null;return action(result);}
for(const side of ['black','white']){
  const margin=$('margin-'+side);
  margin.onfocus=()=>selectResult('score-'+side);margin.oninput=()=>{margin.setCustomValidity('');selectResult('score-'+side);};
  document.querySelector(`#result-options input[value="score-${side}"]`).onchange=()=>{if(!margin.value)margin.focus();};
}
$('end-game-form').onsubmit=event=>{
  event.preventDefault();
  if(!state||busy)return;
  if(state.revision!==resultRevision||state.phase==='ended'){$('end-game-dialog').close();notice(t('棋局已更新，请重新确认。','The game has changed. Please confirm again.'));return;}
  const choice=document.querySelector('#result-options input[name="result"]:checked')?.value;if(!choice)return;
  const [kind,side]=choice.split('-');let result;
  if(kind==='score'){
    const input=$('margin-'+side),margin=Number(input.value);
    if(!input.value||!(margin>0&&margin<=400&&Number.isInteger(margin*2))){input.setCustomValidity(t('请输入有效的胜负目数。','Enter a valid winning margin (in steps of 0.5).'));input.reportValidity();return;}
    result=choice===countedResult.choice&&margin===countedResult.margin?{type:'finish'}:{type:'result',winner:side,reason:'score',margin};
  } else if(kind==='resign')result={type:'resign',side:opposite(side)};
  else if(kind==='draw')result=countedResult.choice==='draw'?{type:'finish'}:{type:'result',reason:'draw'};
  else result={type:'result',reason:'unfinished'};
  $('end-game-dialog').close();finishGame(result);
};
$('new').onclick=()=>chooseGameResult(false);
$('end-game-cancel').onclick=()=>$('end-game-dialog').close();
$('undo').onclick=()=>confirmAction(t('撤回' + names[state.history.at(-1)?.side] + '的上一手？','Undo ' + names[state.history.at(-1)?.side] + '’s last move?'),t("永久删除最近一手，不保留分支；双方设备都会更新。请先征得对方同意。","Permanently remove the last move on all devices; no variation is saved. Please agree with your opponent first."),()=>action({type:'undo'}));
for (const side of ['black','white']) $('resign-' + side).onclick=()=>chooseGameResult(false,'resign-'+opposite(side));
$('pass').onclick=()=>action({type:'pass'}); $('resume').onclick=()=>action({type:'resume'});
$('confirm-score').onclick=()=>chooseGameResult(true);
$('auto').onchange=()=>{automatic=$('auto').checked; if(automatic){lastActivity=Date.now();sync(true);}};
setInterval(()=>{ if(!automatic)return; if(Date.now()-lastActivity>=10*60*1000){automatic=false;$('auto').checked=false;$('sync').textContent=t("10 分钟无落子，已暂停自动同步","Auto-sync paused after 10 minutes without a move");return;} if(document.visibilityState==='visible')sync(); },5000);
window.addEventListener('focus',()=>{if(automatic)sync();}); window.addEventListener('online',()=>{if(automatic)sync();}); document.addEventListener('visibilitychange',()=>{if(automatic&&document.visibilityState==='visible')sync();});
if (archiveId) {
  automatic = false; $('auto').checked = false; document.querySelector('.sync-card').hidden = true;
}
sync();

let editRevision;
$('edit-game').onclick = () => {
  if (!state) return;
  editRevision = state.revision;
  $('name-input').value = gameTitle(state);
  $('black-input').value = state.players?.black || '';
  $('white-input').value = state.players?.white || '';
  $('black-rank-input').value=state.playerRanks?.black||'';$('white-rank-input').value=state.playerRanks?.white||'';
  $('live-date').value=state.date||state.createdAt?.slice(0,10)||'';$('live-rules').value=state.rules||'Chinese';$('live-komi').value=state.komi;
  $('edit-error').textContent = '';
  $('edit-dialog').showModal();
};
$('cancel-edit').onclick = () => $('edit-dialog').close();
$('live-rules').onchange = () => { $('live-komi').value = $('live-rules').value === 'Japanese' ? 6.5 : 7.5; };
$('edit-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  if (editRevision !== state.revision) { $('edit-error').textContent = t('棋局已更新，请关闭后重新编辑。','The game changed. Close and reopen this editor.'); return; }
  const name = $('name-input').value.trim(), players = { black:$('black-input').value.trim(), white:$('white-input').value.trim() };
  const playerRanks={black:$('black-rank-input').value.trim(),white:$('white-rank-input').value.trim()};
  await action({type:'metadata', name, players, playerRanks, date:$('live-date').value,rules:$('live-rules').value,komi:Number($('live-komi').value)});
  if (state.gameName === name && state.players?.black === players.black && state.players?.white === players.white && state.playerRanks?.black===playerRanks.black && state.playerRanks?.white===playerRanks.white) $('edit-dialog').close();
  else $('edit-error').textContent = t('保存失败，请关闭后重试。','Not saved. Close and try again.');
};

window.addEventListener('site-language-change',()=>{ showSyncWarning(syncFailed); $('notice').hidden=true; $('sync').textContent=t('语言已切换','Language updated'); render();});
