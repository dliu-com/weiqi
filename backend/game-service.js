import { opposite, play, groupAt, score, gameTree, gameClock, MAX_GAME_MOVES } from '../src/engine.js';
export class GameError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
export function createState() {
  const size = 19;
  return { createdAt: new Date().toISOString(), gameName: null, players: { black: '', white: '' }, revision: 0, size, board: '.'.repeat(size * size), turn: 'black', history: [], captures: { black: 0, white: 0 }, passes: 0, phase: 'play', dead: [], agreed: [], komi: 7.5, result: null, updatedAt: null };
}
export function freshLiveGame(completed,libraryId){
 const next=createState();next.revision=completed.revision+1;next.generation=next.revision;next.updatedAt=new Date().toISOString();if(libraryId)next.lastSavedGame={id:libraryId,generation:completed.generation||0};return next;
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
    next.clock.paused = a.paused; next.clock.since = now;
  } else if (a.type === 'metadata') {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 80) throw new GameError('名称须为 1–80 个字符。');
    if (!a.players || ['black','white'].some(side => typeof a.players[side] !== 'string' || a.players[side].trim().length > 40)) throw new GameError('棋手姓名不能超过 40 个字符。');
    if(a.timeControl!==undefined){
      const clock=a.timeControl;
      if(clock!==null&&(!clock||!Number.isFinite(clock.mainSeconds)||clock.mainSeconds<0||clock.mainSeconds>864000||typeof clock.overtime!=='string'||clock.overtime.length>200))throw new GameError('操作无效。');
      next.timeControl=clock===null?null:{mainSeconds:clock.mainSeconds,overtime:clock.overtime.trim()};
    }
    if(a.playerRanks!==undefined&&(!a.playerRanks||['black','white'].some(side=>typeof a.playerRanks[side]!=='string'||a.playerRanks[side].trim().length>200)))throw new GameError('操作无效。');
    if(a.playerRanks!==undefined)next.playerRanks={black:a.playerRanks.black.trim(),white:a.playerRanks.white.trim()};
    if(a.rules!==undefined&&!['Chinese','Japanese'].includes(a.rules))throw new GameError('操作无效。');
    if(a.komi!==undefined&&(!Number.isFinite(a.komi)||Math.abs(a.komi)>100))throw new GameError('操作无效。');
    if(a.date!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(a.date))throw new GameError('操作无效。');
    next.gameName = a.name.trim(); next.players = {black:a.players.black.trim(),white:a.players.white.trim()};
    if(a.rules!==undefined)next.rules=a.rules;if(a.komi!==undefined)next.komi=a.komi;if(a.date!==undefined)next.date=a.date;
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
    next.tree.head = next.tree.nodes.length - 1;
    next.history.push(entry); next.turn = opposite(current.turn);
  } else throw new GameError('当前棋局不能执行此操作。');
  if (a.type === 'resume' || a.type === 'undo') next.clock.since = now;
  next.revision = current.revision + (heartbeat ? 0 : 1); next.updatedAt = heartbeat ? current.updatedAt : new Date().toISOString();
  if (JSON.stringify(next).length > 350000) throw new GameError('棋谱已达保存上限，请结算当前棋局或重新开始。');
  return next;
}
