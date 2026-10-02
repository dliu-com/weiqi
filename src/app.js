import { t, language, setLanguage, translateError } from './i18n.js';
import { score } from './engine.js';
const $ = id => document.getElementById(id);
const names = { get black() { return t('黑方','Black'); }, get white() { return t('白方','White'); } };
const letters = 'ABCDEFGHJKLMNOPQRST';
const coord = i => letters[i % 19] + (19 - Math.floor(i / 19));
let state = null, busy = false, automatic = true, lastActivity = Date.now(), noticeTimer, pendingConfirmation;
function notice(message) { $('notice').textContent = message; $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => $('notice').hidden = true, 6000); }
async function request(method = 'GET', payload) {
  const headers = {}, options = { method, cache: 'no-store', signal: AbortSignal.timeout(15000), headers };
  if (payload) {
    options.body = JSON.stringify(payload); headers['content-type'] = 'application/json';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.body));
    headers['x-amz-content-sha256'] = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  }
  const response = await fetch('/api/game', options), data = await response.json();
  if (!response.ok) { const error = new Error(data.message || t("同步失败，请稍后重试。","Sync failed. Please try again.")); error.state = data.state; throw error; }
  return data.state;
}
function adopt(next) {
  if (state && next.revision < state.revision) return;
  if (!state || next.board !== state.board || next.history.length !== state.history.length) lastActivity = Date.now();
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
  if (busy || !state) return;
  const revision = state.revision; busy = true; render(); $('sync').textContent = t("正在核对棋局…","Checking the latest position…");
  try {
    const remote = await request(); adopt(remote);
    if (remote.revision !== revision) { notice(t("对方已更新棋局，已同步。请重新操作。","The game has changed and is now synced. Please try your move again.")); return; }
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
function canPlay() { return state && state.phase === 'play'; }
function render() {
  if (!state) return;
  const last = state.history.at(-1), scoring = state.phase === 'scoring', ended = state.phase === 'ended';
  const totals = (scoring || state.result?.reason === 'score') ? score(state.board,19,state.dead,state.komi) : null;
  for (let i = 0; i < 361; i++) {
    const el = points[i], value = state.board[i];
    el.className = 'point' + (value === 'B' ? ' black' : value === 'W' ? ' white' : '') + (state.dead.includes(i) ? ' dead' : '') + (last?.type === 'move' && last.index === i ? ' last' : '') + (totals?.territory[i] ? ' territory-' + totals.territory[i] : '');
    el.setAttribute('aria-label',coord(i) + (value === 'B' ? t(" 黑子"," black stone") : value === 'W' ? t(" 白子"," white stone") : t(" 空点"," empty intersection")) + (state.dead.includes(i) ? t(" 已标记死子"," marked dead") : ''));
    el.setAttribute('aria-disabled',String(busy || ended || (!scoring && !canPlay())));
  }
  $('turn').textContent = ended ? (state.result.winner ? names[state.result.winner] + t("胜"," wins") : t("和棋","Draw")) : scoring ? t("双方数子","Scoring") : t("轮到","To play: ") + names[state.turn];
  $('detail').textContent = ended ? (state.result.reason === 'resign' ? t("对方认输，本局结束。","The opponent resigned. Game over.") : t(`胜差 ${state.result.margin} 点 · 白贴 7.5 点`,`Margin: ${state.result.margin} points · White komi: 7.5`)) : scoring ? t("标记死子，双方确认结果。","Mark dead groups, then both players confirm.") : (canPlay() ? t("点击交叉点落子。","Click an intersection to play.") : t("等待对方落子…","Waiting for the other player…")) + t(" 白贴 7.5 点。"," White komi: 7.5 points.");
  $('black-captures').textContent = state.captures.black; $('white-captures').textContent = state.captures.white;
  $('pass').disabled = busy || !canPlay(); $('undo').disabled = busy || !state.history.length; $('new').disabled = busy; $('resign').disabled = busy || ended;
  $('scoring').hidden = !scoring;
  if (totals) $('score').textContent = t(`黑 ${totals.black} 点 · 白 ${totals.white} + 7.5 点 → ${totals.winner ? names[totals.winner] + '领先 ' + totals.margin + ' 点' : '和棋'}`,`Black ${totals.black} · White ${totals.white} + 7.5 → ${totals.winner ? names[totals.winner] + ' leads by ' + totals.margin + ' points' : 'Draw'}`);
  for (const side of ['black','white']) {
    $('agree-'+side).disabled = busy || state.agreed.includes(side);
    $('agree-'+side).textContent = names[side] + (state.agreed.includes(side) ? t("已确认 ✓"," confirmed ✓") : t("确认"," confirms"));
  }
  $('resume').disabled = busy;
  $('count').textContent = state.history.length + t(" 手"," moves"); $('empty').hidden = state.history.length > 0;
  const fragment = document.createDocumentFragment();
  state.history.slice(-30).forEach((h,j) => { const li = document.createElement('li'); li.value = Math.max(0,state.history.length-30)+j+1; li.textContent = names[h.side] + ' · ' + (h.type === 'pass' ? t("停一手","Pass") : coord(h.index)); fragment.append(li); });
  $('history').replaceChildren(fragment);
}
const svgNS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(svgNS,'svg'); svg.setAttribute('viewBox','0 0 190 190'); svg.setAttribute('aria-hidden','true');
for (let i = 0; i < 19; i++) {
  for (const horizontal of [true,false]) { const line = document.createElementNS(svgNS,'line'); line.setAttribute('x1',horizontal ? 5 : 5+i*10); line.setAttribute('y1',horizontal ? 5+i*10 : 5); line.setAttribute('x2',horizontal ? 185 : 5+i*10); line.setAttribute('y2',horizontal ? 5+i*10 : 185); line.setAttribute('stroke','#634c2b'); line.setAttribute('stroke-width','.35'); svg.append(line); }
}
for (const x of [35,95,155]) for (const y of [35,95,155]) { const c = document.createElementNS(svgNS,'circle'); c.setAttribute('cx',x); c.setAttribute('cy',y); c.setAttribute('r',1.1); c.setAttribute('fill','#46351f'); svg.append(c); }
$('board').append(svg);
const points = Array.from({length:361},(_,i) => {
  const b = document.createElement('button'); b.className='point'; b.style.left=(i%19+.5)/19*100+'%'; b.style.top=(Math.floor(i/19)+.5)/19*100+'%'; b.tabIndex=i===180?0:-1;
  b.addEventListener('click',()=>{ if (busy || !state) return; if (state.phase==='scoring') action({type:'dead',index:i}); else if (canPlay()) action({type:'move',index:i}); });
  b.addEventListener('keydown', e=>{ const offset={ArrowLeft:-1,ArrowRight:1,ArrowUp:-19,ArrowDown:19}[e.key]; if (!offset) return; e.preventDefault(); const n=i+offset; if(n>=0&&n<361 && (Math.abs(offset)===19 || Math.floor(n/19)===Math.floor(i/19))) { b.tabIndex=-1; points[n].tabIndex=0; points[n].focus(); }});
  $('board').append(b); return b;
});
function confirmAction(title,text,operation) { pendingConfirmation = operation; $('confirm-title').textContent=title; $('confirm-text').textContent=text; $('confirm-dialog').showModal(); }
$('cancel-confirm').onclick=()=>$('confirm-dialog').close(); $('accept-confirm').onclick=()=>{ $('confirm-dialog').close(); pendingConfirmation?.(); };
$('new').onclick=()=>confirmAction(t("重新开始？","Start a new game?"),t("将替换云端当前棋局，所有设备都会同步为新局。","This replaces the shared game on every device."),()=>action({type:'new'}));
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
sync();

$('language').onchange=()=>{setLanguage($('language').value); focusBoard(document.body.classList.contains('focus')); $('notice').hidden=true; $('sync').textContent=t('语言已切换','Language updated'); render();};
