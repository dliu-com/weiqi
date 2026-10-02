export const opposite = side => side === 'black' ? 'white' : 'black';
export const stone = side => side === 'black' ? 'B' : 'W';
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
