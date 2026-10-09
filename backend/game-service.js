import { opposite, play, groupAt, score, gameTree, gameClock, byoyomiSettings, spendTime, handicapBoard, standardKomi, MAX_GAME_MOVES } from '../src/engine.js';
export class GameError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
export function createState() {
  const size = 19;
  return { createdAt: new Date().toISOString(), gameName: null, players: { black: '', white: '' }, revision: 0, size, board: '.'.repeat(size * size), turn: 'black', history: [], captures: { black: 0, white: 0 }, passes: 0, phase: 'play', dead: [], agreed: [], komi: 7.5, result: null, updatedAt: null };
}
// Finished live games are dated like library game IDs, by the London calendar.
export const londonDate=ms=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(ms);return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');};
export function freshLiveGame(completed,libraryId){
 const next=createState();next.revision=completed.revision+1;next.generation=next.revision;next.updatedAt=new Date().toISOString();if(libraryId)next.lastSavedGame={id:libraryId,generation:completed.generation||0};
 // Lets every open /play page explain how the previous game ended.
 if(completed.result)next.lastResult={generation:completed.generation||0,winner:completed.result.winner??null,reason:completed.result.reason};
 return next;
}
export function transition(current, request) {
  const heartbeat = request?.action?.type === 'heartbeat';
  if (!heartbeat && (!request || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) throw new GameError('棋局版本无效。');
  if (!heartbeat && request.expectedRevision !== current.revision) throw new GameError('棋局已更新，请重试。', 409);
  const now = Date.now();
  const a = request.action; if (!a || typeof a.type !== 'string') throw new GameError('操作无效。');
  let next = structuredClone(current);
  next.tree = structuredClone(gameTree(current));
  // Live games retain only the path to the current position, including legacy
  // trees whose older undo implementation left abandoned variations behind.
  const livePath = [];
  for (let id = next.tree.head; id !== -1; id = next.tree.nodes[id][0]) livePath.push(id);
  next.tree.nodes = livePath.reverse().map((id,index) => [index - 1,...next.tree.nodes[id].slice(1)]);
  next.tree.head = next.tree.nodes.length - 1;
  next.createdAt ||= current.updatedAt || new Date().toISOString();
  next.clock = gameClock(current, now);
  // Legacy clocks cannot reconstruct presence before this version. Start presence tracking now.
  if (!Number.isFinite(current.clock?.lastSeen)) next.clock = {black:current.clock?.black || 0,white:current.clock?.white || 0,paused:current.clock?.paused || false,since:current.clock?.since ?? null};
  if (next.clock.since !== null) next.clock.since = now;
  next.clock.lastSeen = now;
  next.clock.autoPaused = false;
  next.clockVersion = (current.clockVersion || 0) + 1;
  if (heartbeat) {
    // Presence renewals keep the game revision unchanged, so they do not invalidate moves or dialogs.
  } else if (a.type === 'clock') {
    if (current.phase !== 'play' || typeof a.paused !== 'boolean') throw new GameError('当前棋局不能执行此操作。');
    if (next.clock.timedOut) throw new GameError('计时已停止。');
    next.clock.paused = a.paused; next.clock.since = now;
  } else if (a.type === 'metadata') {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 80) throw new GameError('名称须为 1–80 个字符。');
    if (!a.players || ['black','white'].some(side => typeof a.players[side] !== 'string' || a.players[side].trim().length > 40)) throw new GameError('棋手姓名不能超过 40 个字符。');
    // Live games are count-up (null) or byo-yomi, fixed once the first move is played.
    if(a.timeControl!==undefined){
      const clock=a.timeControl,byo=clock&&byoyomiSettings(clock);
      if(clock!==null&&(!byo||!Number.isInteger(clock.mainSeconds)||clock.mainSeconds<0||clock.mainSeconds>36000||byo.periods<1||byo.periods>100||byo.period<1000||byo.period>3600000))throw new GameError('用时设置无效。');
      const value=clock&&{mainSeconds:clock.mainSeconds,overtime:clock.overtime};
      if(JSON.stringify(value)!==JSON.stringify(current.timeControl??null)&&(current.history.length||current.phase!=='play'))throw new GameError('第一手之后不能更改用时。');
      next.timeControl=value;
    }
    if(a.playerRanks!==undefined&&(!a.playerRanks||['black','white'].some(side=>typeof a.playerRanks[side]!=='string'||a.playerRanks[side].trim().length>200)))throw new GameError('操作无效。');
    if(a.playerRanks!==undefined)next.playerRanks={black:a.playerRanks.black.trim(),white:a.playerRanks.white.trim()};
    if(a.rules!==undefined&&!['Chinese','Japanese'].includes(a.rules))throw new GameError('操作无效。');
    if(a.handicap!==undefined&&(!Number.isInteger(a.handicap)||a.handicap<0||a.handicap>9))throw new GameError('操作无效。');
    const handicap=a.handicap??current.handicap??0;
    if(handicap!==(current.handicap||0)&&(current.history.length||current.phase!=='play'))throw new GameError('第一手之后不能更改让子。');
    next.gameName = a.name.trim(); next.players = {black:a.players.black.trim(),white:a.players.white.trim()};
    if(a.rules!==undefined)next.rules=a.rules;
    if(handicap!==(current.handicap||0)){
      next.board=handicapBoard(handicap);next.turn=handicap>1?'white':'black';
      next.tree={root:next.board,captures:{black:0,white:0},turn:next.turn,nodes:[],head:-1};
    }
    next.handicap=handicap;
    // Komi follows the rules and handicap; clients cannot set it directly.
    next.komi=standardKomi(next.rules||'Chinese',handicap);
    if(!current.history.length&&(handicap!==(current.handicap||0)||JSON.stringify(next.timeControl??null)!==JSON.stringify(current.timeControl??null))){
      const byo=byoyomiSettings(next.timeControl);
      delete next.clock.timedOut;delete next.clock.left;delete next.clock.turnBase;
      if(byo){next.clock.left={black:{main:byo.main,periods:byo.periods},white:{main:byo.main,periods:byo.periods}};next.clock.turnBase=next.clock[next.turn];}
    }
  } else if (a.type === 'players') {
    if (!a.players || ['black','white'].some(side => typeof a.players[side] !== 'string' || a.players[side].trim().length > 40)) throw new GameError('棋手姓名不能超过 40 个字符。');
    next.players = { black: a.players.black.trim(), white: a.players.white.trim() };
  } else if (a.type === 'rename') {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 80) throw new GameError('名称须为 1–80 个字符。');
    next.gameName = a.name.trim();
  } else if (a.type === 'new') {
    throw new GameError('请结束并保存当前棋局；下一局会自动开始。');
  } else if (a.type === 'undo') {
    const last = next.history.pop(); if (!last) throw new GameError('还没有可以悔棋的记录。');
    next.tree.nodes.pop();
    next.tree.head = next.tree.nodes.length - 1;
    Object.assign(next, { board: last.board, turn: last.side, captures: last.captures, passes: last.passes, phase: 'play', dead: [], agreed: [], result: null });
    // Undo restores the remaining byo-yomi time from before the move.
    if (last.left && !next.clock.timedOut) { next.clock.left = last.left; next.clock.turnBase = next.clock[last.side]; }
  } else if (a.type === 'resume' && current.phase === 'scoring') {
    Object.assign(next, { phase: 'play', passes: 0, dead: [], agreed: [] });
  } else if (a.type === 'dead' && current.phase === 'scoring') {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= current.board.length || current.board[a.index] === '.') throw new GameError('请选择要标记的棋子。');
    const g = groupAt(current.board, a.index, current.size).group;
    next.dead = current.dead.includes(a.index) ? current.dead.filter(i => !g.includes(i)) : [...new Set([...current.dead, ...g])];
    next.agreed = [];
  } else if (a.type === 'finish' && ['play','scoring'].includes(current.phase)) {
    const result = score(next.board, next.size, next.dead, next.komi);
    next.result = { winner: result.winner, reason: 'score', black: result.black, white: result.white, margin: result.margin };
    next.phase = 'ended';
  } else if (a.type === 'agree' && current.phase === 'scoring') {
    if (!['black','white'].includes(a.side)) throw new GameError('请选择执棋方。');
    next.agreed = [...new Set([...current.agreed, a.side])];
    if (next.agreed.length === 2) {
      const s = score(next.board, next.size, next.dead, next.komi);
      next.result = { winner: s.winner, reason: 'score', black: s.black, white: s.white, margin: s.margin }; next.phase = 'ended';
    }
  } else if(a.type==='result'&&current.phase!=='ended'){
    if(a.reason===undefined){
      if(!['black','white','draw'].includes(a.winner))throw new GameError('请选择执棋方。');
      next.result={winner:a.winner==='draw'?null:a.winner,reason:'agreed'};
    } else if(a.reason==='unfinished')next.result={winner:null,reason:'unfinished'};
    else if(a.reason==='draw')next.result={winner:null,reason:'score',margin:0};
    else {
      if(!['black','white'].includes(a.winner))throw new GameError('请选择执棋方。');
      if(a.reason==='resign')next.result={winner:a.winner,reason:'resign'};
      else if(a.reason==='score'&&typeof a.margin==='number'&&a.margin>0&&a.margin<=400&&Number.isInteger(a.margin*2))next.result={winner:a.winner,reason:'score',margin:a.margin};
      else throw new GameError('请输入有效的胜负目数。');
    }
    next.phase='ended';
  } else if (a.type === 'resign' && current.phase !== 'ended') {
    if (!['black','white'].includes(a.side)) throw new GameError('请选择认输方。');
    next.result = { winner: opposite(a.side), reason: 'resign' }; next.phase = 'ended';
  } else if ((a.type === 'move' || a.type === 'pass') && current.phase === 'play') {
    if (next.clock.paused) throw new GameError('请先恢复计时。');
    if (current.history.length >= MAX_GAME_MOVES) throw new GameError('本局已达 400 手上限，请点击“新一局”选择结果。');
    const entry = { type: a.type, side: current.turn, board: current.board, captures: { ...current.captures }, passes: current.passes };
    if (a.type === 'move') {
      let move;
      try { move = play(current.board, a.index, current.turn, current.size, [current.board, ...current.history.map(h => h.board)]); }
      catch (e) { throw new GameError(e.message); }
      next.board = move.board; next.captures[current.turn] += move.captured.length; entry.index = a.index; next.passes = 0;
    } else { next.passes++; if (next.passes >= 2) next.phase = 'scoring'; }
    const changes = [];
    for (let i = 0; i < next.board.length; i++) if (current.board[i] !== next.board[i]) changes.push([i, next.board[i]]);
    next.tree.nodes.push([next.tree.head, current.turn, a.type === 'pass' ? null : a.index, changes, new Date(now).toISOString(), [next.clock.black,next.clock.white]]);
    next.clock.since = now;
    const byo = byoyomiSettings(next.timeControl);
    if (byo && !next.clock.timedOut) {
      const left = next.clock.left || {black:{main:byo.main,periods:byo.periods},white:{main:byo.main,periods:byo.periods}};
      entry.left = structuredClone(left);
      next.clock.left = {...left,[current.turn]:spendTime(left[current.turn],next.clock[current.turn]-(next.clock.turnBase||0),byo.period)};
      next.clock.turnBase = next.clock[opposite(current.turn)];
    }
    next.tree.head = next.tree.nodes.length - 1;
    next.history.push(entry); next.turn = opposite(current.turn);
  } else throw new GameError('当前棋局不能执行此操作。');
  if (a.type === 'resume' || a.type === 'undo') next.clock.since = now;
  if (next.clock.timedOut) next.clock.since = null;
  if (next.phase === 'ended' && current.phase !== 'ended') next.date = londonDate(now);
  next.revision = current.revision + (heartbeat ? 0 : 1); next.updatedAt = heartbeat ? current.updatedAt : new Date().toISOString();
  if (JSON.stringify(next).length > 350000) throw new GameError('棋谱已达保存上限，请结算当前棋局或重新开始。');
  return next;
}
