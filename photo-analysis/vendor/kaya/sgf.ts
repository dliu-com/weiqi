import type { DetectedStone } from './types';

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';

function coord(col: number, row: number): string {
  return ALPHA[col] + ALPHA[row];
}

/**
 * Build an SGF string representing a static board position (no moves).
 * Uses AB (add black) and AW (add white) properties on the root node.
 */
export function buildSGF(boardSize: number, stones: DetectedStone[]): string {
  const black = stones.filter(s => s.color === 'black');
  const white = stones.filter(s => s.color === 'white');

  let props = `GM[1]FF[4]SZ[${boardSize}]AP[Kaya Board Recognition]`;

  if (black.length > 0) {
    props += 'AB' + black.map(s => `[${coord(s.x, s.y)}]`).join('');
  }
  if (white.length > 0) {
    props += 'AW' + white.map(s => `[${coord(s.x, s.y)}]`).join('');
  }

  return `(;${props}\n)`;
}
