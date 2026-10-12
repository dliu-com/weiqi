// Game phases by move number, and short facts computed from the saved report.
export const GAME_PHASES=[{key:'opening',from:1,to:60},{key:'middle',from:61,to:150},{key:'endgame',from:151,to:Infinity}];
const rated=m=>['best','good','inaccuracy','mistake','blunder'].includes(m.quality)&&Number.isFinite(m.pointLoss)&&m.pointLoss>=0;
const sum=values=>values.reduce((a,b)=>a+b,0);
export function gamePhases(moves){
 return GAME_PHASES.filter(p=>p.from<=moves).map(p=>({...p,to:Math.min(p.to,moves)}));
}
export function phaseLosses(reviews,moves){
 return gamePhases(moves).map(phase=>({...phase,...Object.fromEntries(['B','W'].map(side=>{
  const own=reviews.filter(m=>m.side===side&&m.move>=phase.from&&m.move<=phase.to&&rated(m)),losses=own.map(m=>m.pointLoss);
  return [side,{moves:own.length,totalPointLoss:sum(losses),meanPointLoss:losses.length?sum(losses)/losses.length:null,errors:own.filter(m=>m.quality==='mistake'||m.quality==='blunder').length}];
 }))}));
}
// Share of positions after each move where one side had the better chances.
export function favouredByPhase(chart,moves){
 return gamePhases(moves).map(phase=>{
  const points=chart.filter(p=>p.move>=phase.from&&p.move<=phase.to&&Number.isFinite(p.blackWinrate)),
   black=points.filter(p=>p.blackWinrate>.5).length,white=points.filter(p=>p.blackWinrate<.5).length,side=black>white?'B':white>black?'W':null;
  return {...phase,positions:points.length,side,percent:points.length?100*Math.max(black,white)/points.length:null};
 }).filter(p=>p.positions);
}
// First move from which one side's chances stayed at or above the threshold.
export function decidedFrom(chart,threshold=.9){
 const points=chart.filter(p=>p.move>=1&&Number.isFinite(p.blackWinrate)),last=points.at(-1);
 if(!last)return null;
 const side=last.blackWinrate>=threshold?'B':1-last.blackWinrate>=threshold?'W':null;
 if(!side)return null;
 const own=p=>side==='B'?p.blackWinrate:1-p.blackWinrate;
 let index=points.length-1;
 while(index>0&&own(points[index-1])>=threshold)index--;
 return {side,move:points[index].move};
}
// The lead changes hands only when the other side moves more than one point ahead.
export function leadChanges(chart,margin=1){
 let leader=null,since=null,changes=0;
 for(const p of chart){
  if(p.move<1||!Number.isFinite(p.blackLead))continue;
  const side=p.blackLead>margin?'B':p.blackLead<-margin?'W':null;
  if(!side||side===leader)continue;
  if(leader)changes++;
  leader=side;since=p.move;
 }
 return {changes,leader,since};
}
// Black lead at the end of each phase, its change during the phase and the biggest lead inside it.
export function phaseLeads(chart,moves){
 const leadAt=move=>chart.find(p=>p.move===move&&Number.isFinite(p.blackLead))?.blackLead;
 return gamePhases(moves).map(phase=>{
  const points=chart.filter(p=>p.move>=phase.from&&p.move<=phase.to&&Number.isFinite(p.blackLead)),end=leadAt(phase.to),start=leadAt(phase.from-1);
  if(!points.length||!Number.isFinite(end))return null;
  const peak=points.reduce((a,b)=>Math.abs(b.blackLead)>Math.abs(a.blackLead)?b:a);
  return {...phase,end,change:Number.isFinite(start)?end-start:null,peak:{move:peak.move,lead:peak.blackLead}};
 }).filter(Boolean);
}
export function topLossShare(reviews,side,count=5){
 const losses=reviews.filter(m=>m.side===side&&rated(m)).map(m=>m.pointLoss).sort((a,b)=>b-a),total=sum(losses),top=sum(losses.slice(0,count));
 return {total,top,percent:total>0?100*top/total:null};
}
