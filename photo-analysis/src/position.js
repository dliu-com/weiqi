// Standalone photo-position helpers. Copyright 2026 DL; AGPL-3.0-only.
export const columns='ABCDEFGHJKLMNOPQRST';
export const emptyBoard=()=>Array(361).fill(null);
export const coordinate=i=>columns[i%19]+(19-Math.floor(i/19));
export const defaultKomi=rules=>['chinese','aga'].includes(rules)?7.5:6.5;
export function rotateBoard(board){return board.map((_,i)=>board[(18-i%19)*19+Math.floor(i/19)]);}
export const rotatePoint=i=>i%19*19+18-Math.floor(i/19);
export function validCorners(corners,width,height){
 if(corners.length!==4||corners.some(([x,y])=>!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>=width||y<0||y>=height))return false;
 const crosses=corners.map(([x,y],i)=>{const b=corners[(i+1)%4],c=corners[(i+2)%4];return (b[0]-x)*(c[1]-b[1])-(b[1]-y)*(c[0]-b[0]);});
 const area=Math.abs(corners.reduce((sum,[x,y],i)=>{const b=corners[(i+1)%4];return sum+x*b[1]-y*b[0];},0))/2;
 return crosses.every(v=>v>0)&&area>width*height*.05;
}
const neighbours=i=>[i%19?i-1:-1,i%19<18?i+1:-1,i>=19?i-19:-1,i<342?i+19:-1].filter(n=>n>=0);
function group(board,start){const stones=new Set(),liberties=new Set(),todo=[start];while(todo.length){const i=todo.pop();if(stones.has(i))continue;stones.add(i);for(const n of neighbours(i)){if(!board[n])liberties.add(n);else if(board[n]===board[start]&&!stones.has(n))todo.push(n);}}return {stones,liberties};}
export function invalidStones(board){const seen=new Set(),invalid=[];for(let i=0;i<361;i++){if(!board[i]||seen.has(i))continue;const g=group(board,i);for(const s of g.stones)seen.add(s);if(!g.liberties.size)invalid.push(...g.stones);}return invalid;}
export function previewSequence(board,side,pv){
 let next=board.slice(),player=side;const numbers=new Map(),history=new Set([next.join(',')]);let depth=0;
 for(const move of pv||[]){depth++;if(move.toLowerCase()==='pass'){player=player==='black'?'white':'black';continue;}
  const match=/^([A-HJ-T])(\d{1,2})$/i.exec(move);if(!match)break;const x=columns.indexOf(match[1].toUpperCase()),y=19-Number(match[2]);if(y<0||y>18)break;const i=y*19+x;if(next[i])break;
  const attempt=next.slice();attempt[i]=player;for(const n of neighbours(i)){if(attempt[n]&&attempt[n]!==player){const g=group(attempt,n);if(!g.liberties.size)for(const s of g.stones)attempt[s]=null;}}
  if(!group(attempt,i).liberties.size||history.has(attempt.join(',')))break;
  next=attempt;history.add(next.join(','));numbers.set(i,depth);for(const s of numbers.keys())if(!next[s])numbers.delete(s);player=player==='black'?'white':'black';
 }
 return {board:next,numbers};
}
export function setupSgf(board,{side='black',rules='japanese',komi=6.5}={}){
 const points=colour=>board.flatMap((s,i)=>s===colour?'['+String.fromCharCode(97+i%19,97+Math.floor(i/19))+']':[]).join('');
 return '(;FF[4]GM[1]CA[UTF-8]SZ[19]RU['+rules+']KM['+Number(komi)+']PL['+(side==='black'?'B':'W')+']'+(points('black')?'AB'+points('black'):'')+(points('white')?'AW'+points('white'):'')+')';
}

export function sequenceSgf(frames,settings){
 const root=setupSgf(frames[0].board,{...settings,side:frames[0].turn}).slice(0,-1);
 return root+frames.slice(1).map(f=>';'+(f.move.side==='black'?'B':'W')+'['+(f.move.index===null?'':String.fromCharCode(97+f.move.index%19,97+Math.floor(f.move.index/19)))+']').join('')+')';
}
