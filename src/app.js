import { t, language, setLanguage, translateError } from './i18n.js';
import { score, gameTree, reviewPosition, gameClock, sgf } from './engine.js';
const $ = id => document.getElementById(id);
const names = { get black() { return t('黑方','Black'); }, get white() { return t('白方','White'); } };
const archiveId = new URLSearchParams(location.search).get('game');
const apiPath = archiveId ? '/api/games/' + encodeURIComponent(archiveId) : '/api/game';
const gameTitle = s => s.gameName || new Date(s.createdAt || s.updatedAt || Date.now()).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB');
const letters = 'ABCDEFGHJKLMNOPQRST';
const coord = i => letters[i % 19] + (19 - Math.floor(i / 19));
let reviewing = null, treeRenderKey = '';
let state = null, busy = false, automatic = true, lastActivity = Date.now(), noticeTimer, pendingConfirmation;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6000); }
async function request(method = 'GET', payload) {
  const headers = {}, options = { method, cache: 'no-store', signal: AbortSignal.timeout(15000), headers };
  if (payload) {
    options.body = JSON.stringify(payload); headers['content-type'] = 'application/json';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body));
    headers['x-amz-content-sha256'] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  }
  const response = await fetch(apiPath, options), data = await response.json();
  if (!response.ok) { const error = new Error(data.message || t("同步失败，请稍后重试。","Sync failed. Please try again.")); error.state = data.state; throw error; }
  return data.state;
}
function adopt(next) {
  if (state && next.revision < state.revision) return;
  if (!state || next.board !== state.board || next.history.length !== state.history.length) lastActivity = Date.now();
  if (state && (state.generation || 0) !== (next.generation || 0)) reviewing = null;
  if (reviewing !== null && reviewing >= gameTree(next).nodes.length) reviewing = null;
  state = next; render();
}
async function sync(manual = false) {
  if (busy) return;
  busy = true;
  try { adopt(await request()); $('sync').textContent = t("已同步 · ","Synced · ") + new Date().toLocaleTimeString(t("zh-CN","en-GB")); }
  catch { $('sync').textContent = t("连接失败，请重试","Connection failed. Please retry."); if (manual) notice(t("无法读取云端棋局，请检查网络。","Unable to load the game. Check your connection.")); }
  finally { busy = false; render(); }
}
async function action(action) {
  const metadata = action.type === 'metadata';
  if (busy || !state || (!metadata && (reviewing !== null || archiveId))) return;
  const revision = state.revision; busy = true; render(); $('sync').textContent = t("正在核对棋局…","Checking the latest position…");
  try {
    const remote = await request(); adopt(remote);
    if (remote.revision !== revision) { $('sync').textContent = t('已同步最新棋局','Latest position synced'); notice(t("对方已更新棋局，已同步。请重新操作。","The game has changed and is now synced. Please try your move again.")); return; }
    adopt(await request('POST', { expectedRevision: revision, action }));
    $('sync').textContent = t("已保存 · ","Saved · ") + new Date().toLocaleTimeString(t("zh-CN","en-GB"));
  } catch (e) {
    if (e.state) adopt(e.state);
    notice(translateError(e.message) || t("保存失败，请重新同步。","Save failed. Please sync again."));
    // Recover an uncertain POST without replaying an action that may already have succeeded.
    try { adopt(await request()); $('sync').textContent = t("已重新同步，请核对棋局","Synced again. Please check the position."); }
    catch { $('sync').textContent = t("保存状态未知，请立即同步后核对","Save status unknown. Sync now to check."); }
  } finally { busy = false; render(); }
}
function canPlay() { return state && !archiveId && reviewing === null && state.phase === 'play' && !state.clock?.paused; }
function render() {
  if (!state) return;
  $('game-name').textContent = gameTitle(state);
  $('player-names').textContent = names.black + (state.players?.black ? ': ' + state.players.black : '') + ' · ' + names.white + (state.players?.white ? ': ' + state.players.white : '');
  $('edit-game').disabled = busy;
  const review = reviewing === null ? null : reviewPosition(state, reviewing);
  const displayed = review || state;
  const last = review ? review.last : state.history.at(-1), scoring = state.phase === 'scoring', ended = state.phase === 'ended';
  const totals = !review && (scoring || state.result?.reason === 'score') ? score(state.board,19,state.dead,state.komi) : null;
  for (let i = 0; i < 361; i++) {
    const el = points[i], value = displayed.board[i];
    el.className = 'point' + (value === 'B' ? ' black' : value === 'W' ? ' white' : '') + ((!review && state.dead.includes(i)) ? ' dead' : '') + (last?.type === 'move' && last.index === i ? ' last' : '') + (totals?.territory[i] ? ' territory-' + totals.territory[i] : '');
    el.setAttribute('aria-label',coord(i) + (value === 'B' ? t(" 黑子"," black stone") : value === 'W' ? t(" 白子"," white stone") : t(" 空点"," empty intersection")) + ((!review && state.dead.includes(i)) ? t(" 已标记死子"," marked dead") : ''));
    el.setAttribute('aria-disabled',String(!!archiveId || reviewing !== null || busy || ended || (!scoring && !canPlay())));
  }
  $('turn').textContent = ended ? (state.result.winner ? names[state.result.winner] + t("胜"," wins") : t("和棋","Draw")) : scoring ? t("双方数子","Scoring") : t("轮到","To play: ") + names[state.turn];
  $('detail').textContent = ended ? (state.result.reason === 'resign' ? t("对方认输，本局结束。","The opponent resigned. Game over.") : t(`胜差 ${state.result.margin} 点 · 白贴 7.5 点`,`Margin: ${state.result.margin} points · White komi: 7.5`)) : scoring ? t("标记死子，双方确认结果。","Mark dead groups, then both players confirm.") : (canPlay() ? t("点击交叉点落子。","Click an intersection to play.") : t("等待对方落子…","Waiting for the other player…")) + t(" 白贴 7.5 点。"," White komi: 7.5 points.");
  $('black-captures').textContent = displayed.captures.black; $('white-captures').textContent = displayed.captures.white;
  $('pass').disabled = busy || !canPlay(); $('undo').disabled = !!archiveId || reviewing !== null || busy || !state.history.length; $('new').disabled = !!archiveId || reviewing !== null || busy; $('resign').disabled = !!archiveId || reviewing !== null || busy || ended;
  $('scoring').hidden = !totals;
  $('scoring-help').hidden = ended;
  $('scoring-actions').hidden = ended || !!archiveId;
  if (totals) $('score').textContent = t(`黑 ${totals.black} 点 · 白 ${totals.white} + 7.5 点 → ${totals.winner ? names[totals.winner] + '领先 ' + totals.margin + ' 点' : '和棋'}`,`Black ${totals.black} · White ${totals.white} + 7.5 → ${totals.winner ? names[totals.winner] + ' leads by ' + totals.margin + ' points' : 'Draw'}`);
  for (const side of ['black','white']) {
    $('agree-'+side).disabled = busy || state.agreed.includes(side);
    $('agree-'+side).textContent = names[side] + (state.agreed.includes(side) ? t("已确认 ✓"," confirmed ✓") : t("确认"," confirms"));
  }
  $('resume').disabled = busy;
  $('count').textContent = state.history.length + t(" 手"," moves"); $('empty').hidden = state.history.length > 0;
  if (archiveId && !review) { $('turn').textContent = t('已归档棋局','Archived game'); $('detail').textContent = t('选择棋谱节点查看历史局面。','Select a tree node to review an earlier position.'); }
  if (!archiveId && !review && state.phase === 'play' && state.clock?.paused) $('detail').textContent = t('计时已暂停，请恢复计时后继续。','Clock paused. Resume it to continue playing.');
  if (review) {
    $('turn').textContent = t('复盘 · 第 ' + review.depth + ' 手', 'Review · Move ' + review.depth);
    $('detail').textContent = t('仅查看历史。返回当前棋局后才能落子。', 'Viewing history only. Return to live to play.');
  }
  $('turn').className = 'turn-label' + (!archiveId && !review && state.phase === 'play' ? ' turn-' + state.turn : '');
  renderTree();
  renderClock();

}

function selectReview(id) { reviewing = id; render(); }
function renderTree() {
  const tree = gameTree(state), selected = reviewing === null ? tree.head : reviewing;
  $('review-status').textContent = archiveId ? t('已归档棋局 · 只读复盘','Archived game · Read-only review') : reviewing === null
    ? t('当前棋局 · 点击任一节点复盘', 'Live game · Select any node to review')
    : t('正在复盘 · 云端棋局继续同步', 'Reviewing · Live game still syncs');
  $('review-start').setAttribute('aria-label',t('查看初始棋盘','Review initial position'));
  $('review-prev').setAttribute('aria-label',t('查看上一手','Review previous move'));
  $('review-next').setAttribute('aria-label',t('查看下一手','Review next move'));
  $('review-prev').disabled = selected === -1;
  $('review-next').disabled = !tree.nodes.some(n => n[0] === selected);
  $('review-live').disabled = !archiveId && reviewing === null;
  const key = [state.players?.black,state.players?.white,state.generation || 0,tree.nodes.length,tree.head,reviewing,language].join(':');
  if (key === treeRenderKey) return;
  treeRenderKey = key;
  const scroll = $('history').scrollTop;
  const children = new Map(), active = new Set();
  tree.nodes.forEach((node,id) => { if (!children.has(node[0])) children.set(node[0],[]); children.get(node[0]).push(id); });
  for (let id = tree.head; id !== -1; id = tree.nodes[id][0]) active.add(id);
  const fragment = document.createDocumentFragment();
  const pending = [{id:-1,depth:0,branch:0}];
  while (pending.length) {
    const {id,depth,branch} = pending.pop(), node = tree.nodes[id], button = document.createElement('button');
    button.type = 'button'; button.className = 'tree-node' + (node ? ' tree-' + node[1] : '') + (active.has(id) ? ' active-path' : '');
    button.style.marginLeft = Math.min(branch,6) * 12 + 'px';
    button.setAttribute('aria-pressed', String(selected === id));
    button.title = node?.[4] ? new Date(node[4]).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB') : t('落子时间未记录','Move time not recorded');
    const description = (branch ? '↳ ' : '') + (node ? depth + '. ' + names[node[1]] + (state.players?.[node[1]] ? ' (' + state.players[node[1]] + ')' : '') + ' · ' + (node[2] === null ? t('停一手','Pass') : coord(node[2])) : t('初始棋盘','Initial position')) + (id === tree.head ? (archiveId ? t(' · 最后局面',' · Final position') : t(' · 当前',' · Live')) : '');
    const label = document.createElement('span'); label.className = 'tree-label'; label.textContent = description;
    if (node) { const marker = document.createElement('span'); marker.className = 'tree-stone'; marker.setAttribute('aria-hidden','true'); button.append(marker); }
    button.append(label);
    button.title = description + ' · ' + button.title;
    button.setAttribute('aria-label',button.title);
    button.onclick = () => selectReview(id);
    if (node?.[4]) { const time = document.createElement('small'); time.textContent = new Date(node[4]).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-GB'); button.append(time); }
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
  let next = tree.nodes.findIndex(n => n[0] === id);
  for (let p = tree.head; p !== -1; p = tree.nodes[p][0]) if (tree.nodes[p][0] === id) { next = p; break; }
  if (next !== -1) selectReview(next);
};
$('review-live').onclick = () => { if (archiveId) { location.href = './'; return; } reviewing = null; render(); };

function renderClock() {
  if (!state) return;
  const saved = reviewing !== null ? gameTree(state).nodes[reviewing]?.[5] : null;
  const clock = reviewing === null ? gameClock(state) : {black:saved?.[0] || 0,white:saved?.[1] || 0,paused:true};
  const format = ms => { const seconds = Math.floor(ms/1000); return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':'); };
  $('black-time').textContent = names.black + ' ' + (reviewing !== null && !saved ? '—' : format(clock.black));
  $('white-time').textContent = names.white + ' ' + (reviewing !== null && !saved ? '—' : format(clock.white));
  $('pause-clock').disabled = busy || !!archiveId || reviewing !== null || state.phase !== 'play';
  $('pause-clock').textContent = state.clock?.paused ? t('恢复计时','Resume clock') : t('暂停计时','Pause clock');
  $('clock-note').textContent = reviewing !== null ? t('该手结束时的累计用时','Total time at this move') : !state.clock?.since ? t('首手落子后开始计时','Timing starts after the first move') : state.phase !== 'play' ? t('计时已停止','Clock stopped') : state.clock?.paused ? t('计时已暂停','Clock paused') : t('累计用时 · 关闭网页后继续计时','Elapsed time · Continues while the page is closed');
}
$('pause-clock').onclick = () => { if (state) action({type:'clock',paused:!state.clock?.paused}); };
$('download-sgf').onclick = () => {
  if (!state) return;
  const url = URL.createObjectURL(new Blob([sgf(state)],{type:'application/x-go-sgf;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download=(state.gameName || state.createdAt || 'weiqi').replace(/[^\p{L}\p{N} _-]/gu,'-').slice(0,80)+'.sgf'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
setInterval(renderClock,1000);
const svgNS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(svgNS,'svg'); svg.setAttribute('viewBox','0 0 190 190'); svg.setAttribute('aria-hidden','true');
for (let i = 0; i < 19; i++) {
  for (const horizontal of [true,false]) { const line = document.createElementNS(svgNS,'line'); line.setAttribute('x1',horizontal ? 5 : 5+i*10); line.setAttribute('y1',horizontal ? 5+i*10 : 5); line.setAttribute('x2',horizontal ? 185 : 5+i*10); line.setAttribute('y2',horizontal ? 5+i*10 : 185); line.setAttribute('stroke','#634c2b'); line.setAttribute('stroke-width','.35'); svg.append(line); }
}
for (const x of [35,95,155]) for (const y of [35,95,155]) { const c = document.createElementNS(svgNS,'circle'); c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r',1.1); c.setAttribute('fill','#46351f'); svg.append(c); }
$('board').append(svg);
for (const side of ['top','bottom','left','right']) {
  const rail = document.createElement('div');
  rail.className = 'coordinates coordinates-' + side;
  rail.setAttribute('aria-hidden','true');
  for (let i = 0; i < 19; i++) {
    const label = document.createElement('span');
    label.textContent = side === 'top' || side === 'bottom' ? letters[i] : 19 - i;
    rail.append(label);
  }
  $('board').parentElement.append(rail);
}

const points = Array.from({length:361},(_,i) => {
  const b = document.createElement('button'); b.className='point'; b.style.left=(i%19+.5)/19*100+'%'; b.style.top=(Math.floor(i/19)+.5)/19*100+'%'; b.tabIndex=i===180?0:-1;
  b.addEventListener('click',()=>{ if (busy || !state || archiveId || reviewing !== null) return; if (state.phase==='scoring') action({type:'dead',index:i}); else if (canPlay()) action({type:'move',index:i}); });
  b.addEventListener('keydown', e=>{ const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-19,ArrowDown:19}[e.key]; if (!offset) return; e.preventDefault(); const n=i+offset; if(n>=0&&n<361 && (Math.abs(offset)===19 || Math.floor(n/19)===Math.floor(i/19))) { b.tabIndex=-1; points[n].tabIndex=0; points[n].focus(); }});
  $('board').append(b); return b;
});
function confirmAction(title,text,operation) { const revision = state.revision; pendingConfirmation = () => { if (state.revision !== revision) { notice(t('棋局已更新，请重新确认。','The game has changed. Please confirm again.')); return; } operation(); }; $('confirm-title').textContent=title; $('confirm-text').textContent=text; $('confirm-dialog').showModal(); }
$('cancel-confirm').onclick=()=>$('confirm-dialog').close(); $('accept-confirm').onclick=()=>{ $('confirm-dialog').close(); pendingConfirmation?.(); };
$('new').onclick=()=>confirmAction(t("重新开始？","Start a new game?"),t("当前棋局会存入历史记录，所有设备都会同步为新局。","This archives the current game and starts a new one on every device."),()=>action({type:'new'}));
$('undo').onclick=()=>confirmAction(t("悔棋？","Undo the last move?"),t("撤回最近一手，双方设备都会更新。请先征得对方同意。","Undo the last move on all devices. Please agree with your opponent first."),()=>action({type:'undo'}));
$('resign').onclick=()=>{ const side=state.turn; confirmAction(names[side]+t("认输？"," resigns?"),t("确认后本局结束。","Confirm to end this game."),()=>action({type:'resign',side})); };
$('pass').onclick=()=>action({type:'pass'}); $('resume').onclick=()=>action({type:'resume'});
for(const side of ['black','white']) $('agree-'+side).onclick=()=>action({type:'agree',side});
$('rules').onclick=()=>$('rules-dialog').showModal(); $('close-rules').onclick=()=>$('rules-dialog').close();
function focusBoard(on) { document.body.classList.toggle('focus',on); $('focus').textContent=on?t("退出专注 ↙","Exit focus ↙"):t("专注棋盘 ↗","Focus board ↗"); $('focus').setAttribute('aria-pressed',String(on)); }
$('focus').onclick=()=>focusBoard(!document.body.classList.contains('focus')); document.addEventListener('keydown',e=>{if(e.key==='Escape')focusBoard(false);});
$('auto').onchange=()=>{automatic=$('auto').checked; if(automatic){lastActivity=Date.now();sync(true);}};
$('refresh').onclick=()=>sync(true);
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
  $('edit-error').textContent = '';
  $('edit-dialog').showModal();
};
$('cancel-edit').onclick = () => $('edit-dialog').close();
$('edit-form').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  if (editRevision !== state.revision) { $('edit-error').textContent = t('棋局已更新，请关闭后重新编辑。','The game changed. Close and reopen this editor.'); return; }
  const name = $('name-input').value.trim(), players = { black:$('black-input').value.trim(), white:$('white-input').value.trim() };
  await action({type:'metadata', name, players});
  if (state.gameName === name && state.players?.black === players.black && state.players?.white === players.white) $('edit-dialog').close();
  else $('edit-error').textContent = t('保存失败，请关闭后重试。','Not saved. Close and try again.');
};

document.querySelectorAll('[data-language]').forEach(button => button.onclick=()=>{setLanguage(button.dataset.language); focusBoard(document.body.classList.contains('focus')); $('notice').hidden=true; $('sync').textContent=t('语言已切换','Language updated'); render();});
