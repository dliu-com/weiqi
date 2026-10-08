// Printed full-game record: final stones carry their move numbers; moves no longer on the board are listed with coordinates.
export function fullGameRecord(overview,reviews){
 const board=overview?.board;if(!Array.isArray(board)&&typeof board!=='string')return null;
 const shown=new Map();
 for(const m of overview.numbers||[])if(Number.isInteger(m.index)&&board[m.index]===m.side)shown.set(m.index,m);
 const visible=new Set([...shown.values()].map(m=>m.label));
 const hidden=(reviews||[]).filter(m=>!visible.has(String(m.move))).map(m=>({move:m.move,side:m.side,at:m.played}));
 return {board,labels:[...shown.values()],hidden};
}
