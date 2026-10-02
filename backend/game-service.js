import { opposite, play, groupAt, score, gameTree, gameClock } from '../src/engine.js';
export class GameError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
export function createState() {
  const size = 19;
  return { createdAt: new Date().toISOString(), gameName: null, players: { black: '', white: '' }, revision: 0, size, board: '.'.repeat(size * size), turn: 'black', history: [], captures: { black: 0, white: 0 }, passes: 0, phase: 'play', dead: [], agreed: [], komi: 7.5, result: null, updatedAt: null };
}
export function transition(current, request) {
  if (!request || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new GameError('棋局版本无效。');
  if (request.expectedRevision !== current.revision) throw new GameError('棋局已更新，请重试。', 409);
  const now = Date.now();
  const a = request.action; if (!a || typeof a.type !== 'string') throw new GameError('操作无效。');
  let next = structuredClone(current);
  next.tree = structuredClone(gameTree(current));
  next.createdAt ||= current.updatedAt || new Date().toISOString();
  next.clock = gameClock(current, now);
  if (next.clock.since !== null) next.clock.since = now;
  if (a.type === 'clock') {
    if (current.phase !== 'play' || typeof a.paused !== 'boolean') throw new GameError('当前棋局不能执行此操作。');
    next.clock.paused = a.paused; next.clock.since = now;
  } else if (a.type === 'metadata') {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 80) throw new GameError('名称须为 1–80 个字符。');
    if (!a.players || ['black','white'].some(side => typeof a.players[side] !== 'string' || a.players[side].trim().length > 40)) throw new GameError('棋手姓名不能超过 40 个字符。');
    next.gameName = a.name.trim(); next.players = {black:a.players.black.trim(),white:a.players.white.trim()};
  } else if (a.type === 'players') {
    if (!a.players || ['black','white'].some(side => typeof a.players[side] !== 'string' || a.players[side].trim().length > 40)) throw new GameError('棋手姓名不能超过 40 个字符。');
    next.players = { black: a.players.black.trim(), white: a.players.white.trim() };
  } else if (a.type === 'rename') {
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.trim().length > 80) throw new GameError('名称须为 1–80 个字符。');
    next.gameName = a.name.trim();
  } else if (a.type === 'new') {
    next = createState();
    next.generation = current.revision + 1;
  } else if (a.type === 'undo') {
    const last = next.history.pop(); if (!last) throw new GameError('还没有可以悔棋的记录。');
    next.tree.head = next.tree.nodes[next.tree.head][0];
    Object.assign(next, { board: last.board, turn: last.side, captures: last.captures, passes: last.passes, phase: 'play', dead: [], agreed: [], result: null });
  } else if (a.type === 'resume' && current.phase === 'scoring') {
    Object.assign(next, { phase: 'play', passes: 0, dead: [], agreed: [] });
  } else if (a.type === 'dead' && current.phase === 'scoring') {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= current.board.length || current.board[a.index] === '.') throw new GameError('请选择要标记的棋子。');
    const g = groupAt(current.board, a.index, current.size).group;
    next.dead = current.dead.includes(a.index) ? current.dead.filter(i => !g.includes(i)) : [...new Set([...current.dead, ...g])];
    next.agreed = [];
  } else if (a.type === 'agree' && current.phase === 'scoring') {
    if (!['black','white'].includes(a.side)) throw new GameError('请选择执棋方。');
    next.agreed = [...new Set([...current.agreed, a.side])];
    if (next.agreed.length === 2) {
      const s = score(next.board, next.size, next.dead, next.komi);
      next.result = { winner: s.winner, reason: 'score', black: s.black, white: s.white, margin: s.margin }; next.phase = 'ended';
    }
  } else if (a.type === 'resign' && current.phase !== 'ended') {
    if (!['black','white'].includes(a.side)) throw new GameError('请选择认输方。');
    next.result = { winner: opposite(a.side), reason: 'resign' }; next.phase = 'ended';
  } else if ((a.type === 'move' || a.type === 'pass') && current.phase === 'play') {
    if (next.clock.paused) throw new GameError('请先恢复计时。');
    if (a.type === 'move' && current.history.length >= 600) throw new GameError('本局已达 600 手，请双方停一手结算或另开新局。');
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
  next.revision = current.revision + 1; next.updatedAt = new Date().toISOString();
  if (JSON.stringify(next).length > 350000) throw new GameError('棋谱已达保存上限，请结算当前棋局或重新开始。');
  return next;
}
