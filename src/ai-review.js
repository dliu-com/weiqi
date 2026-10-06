import {play} from './engine.js';

export function gtpPoint(move,size=19) {
  if(move?.toLowerCase()==='pass')return null;
  if(typeof move!=='string'||!/^[A-HJ-T](?:[1-9]|1[0-9])$/i.test(move))throw Error('Invalid AI coordinate');
  return (size-Number(move.slice(1)))*size+'ABCDEFGHJKLMNOPQRST'.indexOf(move[0].toUpperCase());
}
export function moveCoordinate(move,size=19) {
  return move.index===null?'pass':'ABCDEFGHJKLMNOPQRST'[move.index%size]+(size-Math.floor(move.index/size));
}

// All scores are stored from Black's perspective. Loss is from the played side's.
export function reviewMove(record,selected,analyses,phase) {
  const node=record.nodes[selected],anchor=node.move?node.parent:selected;
  const before=analyses.get(anchor),after=analyses.get(selected);
  const candidates=before?.candidates||[],best=candidates.find(c=>c.order===0);
  if(!best)return {anchor,alternatives:[],unavailable:true};
  const side=node.move?.side||node.turn,sign=side==='B'?1:-1;
  const played=node.move?moveCoordinate(node.move,record.size):null;
  const candidate=candidates.find(c=>c.move===played);
  const estimated=!candidate||candidate.visits<Math.max(2,best.visits*.03);
  const playedLead=!estimated?candidate.blackLead:after?.blackLead;
  const loss=node.move&&Number.isFinite(playedLead)?Math.max(0,sign*(best.blackLead-playedLead)):null;
  const quality=!node.move?null:played===best.move?'best':loss===null?null:loss<=.5?'good':loss<=2?'inaccuracy':loss<=5?'mistake':'blunder';
  const alternatives=candidates.filter(c=>c.move!==played&&c.visits>=Math.max(phase==='quick'?1:2,Math.ceil(best.visits*.03))&&sign*(best.blackLead-c.blackLead)<=1&&sign*(best.blackWinrate-c.blackWinrate)<=.05).slice(0,3);
  return {anchor,side,played,quality,loss,estimated,preliminary:phase==='quick',alternatives,best};
}

// Candidate searches belong to the displayed position and its player to move.
// Reviewing the last recorded move separately uses its parent position.
export function nextMoveSuggestions(record,selected,analyses,phase) {
  const node=record.nodes[selected],candidates=analyses.get(selected)?.candidates||[];
  const best=candidates.find(c=>c.order===0),side=node.turn,sign=side==='B'?1:-1;
  if(!best)return {anchor:selected,side,alternatives:[],unavailable:true};
  const alternatives=candidates.filter(c=>c===best||(c.visits>=Math.max(phase==='quick'?1:2,Math.ceil(best.visits*.03))&&sign*(best.blackLead-c.blackLead)<=1&&sign*(best.blackWinrate-c.blackWinrate)<=.05)).sort((a,b)=>a.order-b.order).slice(0,3);
  return {anchor:selected,side,best,alternatives,preliminary:phase==='quick'};
}

// Compare alternatives for this position with the next recorded move. The
// recorded choice is retained even when it falls outside the good-move filter.
export function nextMoveComparison(record,selected,analyses,phase) {
  const next=nextMoveSuggestions(record,selected,analyses,phase),sign=next.side==='B'?1:-1;
  const rows=next.alternatives.map((candidate,rank)=>{
    const loss=Math.max(0,sign*(next.best.blackLead-candidate.blackLead));
    return {move:candidate.move,label:'ABC'[rank],candidate,actual:false,loss,estimated:false,
      quality:candidate.order===0?'best':loss<=.5?'good':loss<=2?'inaccuracy':loss<=5?'mistake':'blunder',
      blackWinrate:candidate.blackWinrate};
  });
  const actualNode=record.nodes[selected].children[0],node=record.nodes[actualNode];
  if(next.best&&node?.move&&node.move.side===next.side){
    const review=reviewMove(record,actualNode,analyses,phase),move=moveCoordinate(node.move,record.size);
    const candidate=analyses.get(selected)?.candidates?.find(c=>c.move===move);
    const row=rows.find(r=>r.move===move),best=review.quality==='best';
    const actual={move,actual:true,actualNode,loss:best?0:review.loss,quality:review.quality,
      estimated:!best&&review.estimated,blackWinrate:best||!review.estimated?candidate?.blackWinrate:analyses.get(actualNode)?.blackWinrate};
    if(row)Object.assign(row,actual);else rows.push({...actual,label:null,candidate});
  }
  return {...next,rows};
}

// Preview on a separate board tree; never mutate the uploaded record.
export function recommendedLine(record,anchor,candidate) {
  const base=record.nodes[anchor],frames=[base],history=[];
  for(let n=anchor;n!==null;n=record.nodes[n].parent)history.push(record.nodes[n].board);
  const simpleKo=!record.rules||/japanese|korean|日本|韩国|韓國/i.test(record.rules);
  const pv=candidate.pv?.[0]===candidate.move?candidate.pv.slice(0,12):[candidate.move];
  let truncated=false;
  for(const move of pv){
    const previous=frames.at(-1),side=previous.turn;
    try {
      const koHistory=simpleKo?(frames.length>1?[frames.at(-2).board]:base.parent===null?[]:[record.nodes[base.parent].board]):history;
      const index=gtpPoint(move,record.size),board=index===null?previous.board:play(previous.board,index,side==='B'?'black':'white',record.size,koHistory).board;
      frames.push({...previous,board,depth:previous.depth+1,turn:side==='B'?'W':'B',move:{side,index},children:[],comment:''});
      history.push(board);
    } catch {truncated=true;break;}
  }
  return {anchor,candidate,frames,offset:Math.min(1,frames.length-1),truncated};
}
