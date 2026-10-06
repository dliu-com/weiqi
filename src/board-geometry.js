// Shared geometry for interactive boards and the report's printable SVG boards.
export const BOARD_COLUMNS='ABCDEFGHJKLMNOPQRST';
// Map a canonical SGF point to its displayed point; clicks retain canonical IDs.
export function boardDisplayPoint(index,quarterTurns=0){
 let x=index%19,y=Math.floor(index/19);
 for(let n=0;n<((quarterTurns%4)+4)%4;n++){const before=x;x=18-y;y=before;}
 return y*19+x;
}
export function boardGeometry(origin=5,step=10){const end=origin+18*step;return {lines:Array.from({length:19},(_,i)=>{const p=origin+i*step;return [{x1:origin,y1:p,x2:end,y2:p},{x1:p,y1:origin,x2:p,y2:end}];}).flat(),stars:[3,9,15].flatMap(x=>[3,9,15].map(y=>({cx:origin+x*step,cy:origin+y*step}))),labels:Array.from({length:19},(_,i)=>({position:origin+i*step,column:BOARD_COLUMNS[i],row:19-i}))};}
