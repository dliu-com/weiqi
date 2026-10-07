// Position helpers for Quick AI analysis. Copyright 2026 DL; AGPL-3.0-only.
// Boards are 361-character strings of B, W and '.' like the rest of the site.
import {BOARD_COLUMNS} from './board-geometry.js';
import {groupAt,play} from './engine.js';
export const emptyBoard=()=>'.'.repeat(361);
export const coordinate=i=>BOARD_COLUMNS[i%19]+(19-Math.floor(i/19));
export const setPoint=(board,i,value)=>board.slice(0,i)+value+board.slice(i+1);
export const otherSide=side=>side==='B'?'W':'B';
export const rotatePoint=i=>i%19*19+18-Math.floor(i/19);
export const rotateBoard=board=>Array.from(board,(_,i)=>board[(18-i%19)*19+Math.floor(i/19)]).join('');
export const stoneCounts=board=>({black:[...board].filter(s=>s==='B').length,white:[...board].filter(s=>s==='W').length});
export function invalidStones(board){
 const seen=new Set(),invalid=[];
 for(let i=0;i<361;i++){if(board[i]==='.'||seen.has(i))continue;const g=groupAt(board,i,19);for(const s of g.group)seen.add(s);if(!g.liberties.length)invalid.push(...g.group);}
 return invalid.sort((a,b)=>a-b);
}
export function legalMove(board,index,side,history){return play(board,index,side==='B'?'black':'white',19,history).board;}
// Numbers each move of a KataGo principal variation; captured stones lose their number.
export function previewSequence(board,side,pv=[]){
 let next=board,player=side,depth=0;const numbers=new Map(),history=[board];
 for(const move of pv){
  depth++;if(/^pass$/i.test(move)){player=otherSide(player);continue;}
  const match=/^([A-HJ-T])(\d{1,2})$/i.exec(move);if(!match)break;
  const x=BOARD_COLUMNS.indexOf(match[1].toUpperCase()),y=19-Number(match[2]);if(y<0||y>18)break;
  const i=y*19+x;try{next=legalMove(next,i,player,history);}catch{break;}
  history.push(next);numbers.set(i,depth);for(const s of numbers.keys())if(next[s]==='.')numbers.delete(s);player=otherSide(player);
 }
 return {board:next,numbers};
}
const sgfPoint=i=>String.fromCharCode(97+i%19,97+Math.floor(i/19));
export function setupSgf(board,{side='B',rules='japanese',komi=6.5}={}){
 const points=colour=>[...board].flatMap((s,i)=>s===colour?'['+sgfPoint(i)+']':[]).join('');
 return '(;FF[4]GM[1]CA[UTF-8]SZ[19]RU['+rules+']KM['+Number(komi)+']PL['+side+']'+(points('B')?'AB'+points('B'):'')+(points('W')?'AW'+points('W'):'')+')';
}
export function sequenceSgf(frames,settings){
 const root=setupSgf(frames[0].board,{...settings,side:frames[0].turn}).slice(0,-1);
 return root+frames.slice(1).map(f=>';'+f.move.side+'['+(f.move.index===null?'':sgfPoint(f.move.index))+']').join('')+')';
}
export function framesFromRecord(record){
 return record.mainLine.map(id=>{const n=record.nodes[id];return {board:n.board,turn:n.turn,move:n.move?{side:n.move.side,index:n.move.index??null}:null};});
}
