export const opposite = side => side === 'black' ? 'white' : 'black';
export const stone = side => side === 'black' ? 'B' : 'W';
// Shorter live games are not saved to the library or analysed.
export const MIN_LIBRARY_MOVES = 50;
// Hard cap for live and recorded games, counting passes like the library does.
export const MAX_GAME_MOVES = 400;
// Standard 19 × 19 placements. Handicap 1 has no stones; Black just plays first.
export function handicapBoard(count) {
  if (!Number.isInteger(count) || count < 0 || count > 9) throw new Error('Choose 0–9 handicap stones.');
  const points = [[15,3],[3,15],[15,15],[3,3],[3,9],[15,9],[9,3],[9,15]], board = Array(361).fill('.');
  const placed = count === 1 ? [] : count === 5 ? points.slice(0,4).concat([[9,9]]) : count === 7 ? points.slice(0,6).concat([[9,9]]) : count === 9 ? points.concat([[9,9]]) : points.slice(0,count);
  for (const [x,y] of placed) board[y*19+x] = 'B';
  return board.join('');
}
export function standardKomi(rules, handicap = 0) {
  if (Number(handicap) > 0) return 0.5;
  return /chinese|中国|中國|aga/i.test(rules || '') ? 7.5 : 6.5;
}
export function neighbors(index, size) {
  const x = index % size, y = Math.floor(index / size);
  return [x > 0 ? index - 1 : -1, x < size - 1 ? index + 1 : -1, y > 0 ? index - size : -1, y < size - 1 ? index + size : -1].filter(i => i >= 0);
}
export function groupAt(board, index, size) {
  const color = board[index], group = new Set(), liberties = new Set(), pending = [index];
  if (!color || color === '.') return { group: [], liberties: [] };
  while (pending.length) {
    const i = pending.pop(); if (group.has(i)) continue; group.add(i);
    for (const n of neighbors(i, size)) {
      if (board[n] === '.') liberties.add(n);
      else if (board[n] === color && !group.has(n)) pending.push(n);
    }
  }
  return { group: [...group], liberties: [...liberties] };
}
export function play(board, index, side, size, previous = []) {
  if (!Number.isInteger(index) || index < 0 || index >= size * size || board[index] !== '.') throw new Error('请选择空的交叉点。');
  const next = board.split(''); next[index] = stone(side); const captured = [];
  for (const n of neighbors(index, size)) {
    if (next[n] === stone(opposite(side))) {
      const g = groupAt(next, n, size);
      if (!g.liberties.length) for (const p of g.group) { next[p] = '.'; captured.push(p); }
    }
  }
  if (!groupAt(next, index, size).liberties.length) throw new Error('禁入点：此处落子后没有气。');
  const position = next.join('');
  if (previous.includes(position)) throw new Error('禁止全局同形：请先在别处落子。');
  return { board: position, captured };
}
// Chinese area scoring: stones plus empty regions bounded by one color.
// Players mark agreed dead groups first; mixed-border regions remain neutral.
export function score(board, size, dead = [], komi = 7.5) {
  const b = board.split(''); for (const i of dead) b[i] = '.';
  let black = b.filter(c => c === 'B').length, white = b.filter(c => c === 'W').length;
  const visited = new Set(), territory = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== '.' || visited.has(i)) continue;
    const region = [], borders = new Set(), pending = [i];
    while (pending.length) {
      const p = pending.pop(); if (visited.has(p)) continue;
      visited.add(p); region.push(p);
      for (const n of neighbors(p, size)) {
        if (b[n] === '.') { if (!visited.has(n)) pending.push(n); }
        else borders.add(b[n]);
      }
    }
    if (borders.size === 1) {
      const color = [...borders][0]; if (color === 'B') black += region.length; else white += region.length;
      for (const p of region) territory[p] = color;
    }
  }
  const margin = black - white - komi;
  return { black, white, komi, margin: Math.abs(margin), winner: margin > 0 ? 'black' : margin < 0 ? 'white' : null, territory };
}

// Compact persistent tree: [parent node, moving side, intersection (null = pass), changes].
// Changes preserve captures without duplicating a 361-point board at every node.
export function gameTree(state) {
  if (state.tree) return state.tree;
  const first = state.history[0];
  const tree = { root: first?.board || state.board, captures: first?.captures || state.captures, turn: first?.side || state.turn, nodes: [], head: -1 };
  state.history.forEach((move, i) => {
    const after = state.history[i + 1]?.board || state.board;
    const changes = [];
    for (let p = 0; p < after.length; p++) if (move.board[p] !== after[p]) changes.push([p, after[p]]);
    tree.nodes.push([i - 1, move.side, move.type === 'pass' ? null : move.index, changes]);
    tree.head = i;
  });
  return tree;
}
export function reviewPosition(state, id) {
  const tree = gameTree(state);
  if (!Number.isInteger(id) || id < -1 || id >= tree.nodes.length) throw new Error('Invalid review node');
  const path = [];
  for (let n = id; n !== -1; n = tree.nodes[n][0]) path.push(n);
  const board = tree.root.split(''), captures = { ...tree.captures };
  let turn = tree.turn;
  for (const n of path.reverse()) {
    const [,side,,changes] = tree.nodes[n];
    for (const [point,value] of changes) { if (value === '.' && board[point] === stone(opposite(side))) captures[side]++; board[point] = value; }
    turn = opposite(side);
  }
  const node = tree.nodes[id];
  return { board: board.join(''), captures, turn, depth: path.length, last: node ? { type: node[2] === null ? 'pass' : 'move', index: node[2] } : null };
}
export function gameClock(state, now = Date.now()) {
  const clock = { black: 0, white: 0, paused: false, since: null, ...state.clock };
  const last = clock.lastSeen;
  const expired = state.phase === 'play' && !clock.paused && Number.isFinite(last) && now - last >= 60000;
  clock.autoPaused = expired;
  const until = expired ? last : now;
  if (state.phase === 'play' && !clock.paused && clock.since !== null) clock[state.turn] += Math.max(0, until - clock.since);
  return clock;
}
export function sgf(state) {
  const escape = value => String(value).replace(/\\/g,'\\\\').replace(/\]/g,'\\]').replace(/\r\n?/g,'\n');
  const prop = (key,value) => value === null || value === undefined || value === '' ? '' : key+'['+escape(value)+']';
  const tree=gameTree(state), children=new Map();
  tree.nodes.forEach((node,id)=>{if(!children.has(node[0]))children.set(node[0],[]);children.get(node[0]).push(id);});
  const coord = i => String.fromCharCode(97+i%19,97+Math.floor(i/19));
  let root=';GM[1]FF[4]CA[UTF-8]SZ[19]'+prop('RU',state.rules||'Chinese')+prop('KM',state.komi??7.5)+prop('HA',state.handicap||null)+prop('GN',state.gameName || '现场对弈休闲棋局')+prop('DT',state.date||state.createdAt?.slice(0,10))+prop('PB',state.players?.black)+prop('PW',state.players?.white)+prop('BR',state.playerRanks?.black)+prop('WR',state.playerRanks?.white)+prop('TM',state.timeControl?.mainSeconds)+prop('OT',state.timeControl?.overtime);
  if(state.result)root+=prop('RE',state.result.reason==='unfinished'?'Void':(state.result.winner==='black'?'B':state.result.winner==='white'?'W':'0')+(state.result.winner?'+'+(state.result.reason==='resign'?'R':state.result.reason==='agreed'?'':state.result.margin):''));
  for(const side of ['B','W']) { const points=[...tree.root].flatMap((s,i)=>s===side?[coord(i)]:[]); if(points.length)root+='A'+side+points.map(p=>'['+p+']').join(''); }
  root+=prop('C','Shared Go game. Times are elapsed wall-clock seconds, not a time limit. Move times unavailable for moves made before timing was enabled.');
  const sequence = parent => {
    const branches=(children.get(parent)||[]).map(id=>{
      const [,side,index,,playedAt,times]=tree.nodes[id];
      let value=';'+(side==='black'?'B':'W')+'['+(index===null?'':coord(index))+']';
      const metadata=[playedAt ? 'Played at: '+playedAt : 'Played at: unavailable'];
      if(times)metadata.push('Black total: '+(times[0]/1000).toFixed(1)+' s','White total: '+(times[1]/1000).toFixed(1)+' s');
      if(id===tree.head)metadata.push('Current live position');
      value+=prop('C',metadata.join('\n'));
      return value+sequence(id);
    });
    return branches.length>1 ? branches.map(b=>'('+b+')').join('') : branches.join('');
  };
  return '('+root+sequence(-1)+')';
}
