import {readSgf} from './sgf.js';
import {reviewMove,recommendedLine} from './ai-review.js';

// Shared by the report API and local preview. Metrics reuse the replay ratings.
export const REPORT_SCHEMA_VERSION=2;
export function buildAiReport(source,analysis,metadata,now=new Date()) {
 const record=readSgf(source),evaluations=new Map(analysis.positions.map(p=>[p.nodeId,p]));
 if(analysis.phase!=='deep'||record.mainLine.some(id=>!evaluations.has(id)))throw Object.assign(Error('A complete deep analysis is required to generate this report.'),{statusCode:409});
 const reviews=record.mainLine.slice(1).map(id=>{
  const node=record.nodes[id],r=reviewMove(record,id,evaluations,'deep'),before=evaluations.get(r.anchor),after=evaluations.get(id),sign=r.side==='B'?1:-1;
  const playedCandidate=before?.candidates?.find(c=>c.move===r.played);
  const playedWin=!r.estimated?playedCandidate?.blackWinrate:after?.blackWinrate;
  return {nodeId:id,move:node.depth,side:r.side,played:r.played,quality:r.quality,pointLoss:r.loss,estimated:r.estimated,best:r.best,alternatives:r.alternatives,playedEvaluation:{blackLead:!r.estimated?playedCandidate?.blackLead:after?.blackLead,blackWinrate:playedWin},winrateLoss:Number.isFinite(playedWin)&&r.best?Math.max(0,sign*(r.best.blackWinrate-playedWin)*100):null};
 });
 const summarise=items=>{
  const rated=items.filter(m=>m.quality&&Number.isFinite(m.pointLoss)),counts={best:0,good:0,inaccuracy:0,mistake:0,blunder:0};
  for(const m of rated)counts[m.quality]++;
  return {moves:items.length,ratedMoves:rated.length,estimatedMoves:rated.filter(m=>m.estimated).length,meanPointLoss:rated.length?rated.reduce((n,m)=>n+m.pointLoss,0)/rated.length:null,bestMatchPercent:rated.length?counts.best/rated.length*100:null,goodMatchPercent:rated.length?(counts.best+counts.good)/rated.length*100:null,counts};
 };
 const players={};for(const side of ['B','W']){const own=reviews.filter(m=>m.side===side);players[side]={name:record.players[side==='B'?'black':'white'],...summarise(own),segments:[{from:1,to:60},{from:61,to:180},{from:181,to:Infinity}].map(range=>({from:range.from,to:Math.min(range.to,record.mainLine.length-1),...summarise(own.filter(m=>m.move>=range.from&&m.move<=range.to))}))};}
 const eligible=reviews.filter(m=>m.best&&Number.isFinite(m.pointLoss)&&m.pointLoss>.5&&['inaccuracy','mistake','blunder'].includes(m.quality)).sort((a,b)=>b.pointLoss-a.pointLoss||a.move-b.move);
 const ids=new Set([...eligible.filter(m=>m.side==='B').slice(0,5),...eligible.filter(m=>m.side==='W').slice(0,5)].map(m=>m.nodeId));
 const lineData=(anchor,candidate)=>{
  if(!candidate)return null;const line=recommendedLine(record,anchor,candidate),last=line.frames.at(-1);
  return {board:last.board,moves:line.frames.slice(1).map(f=>f.move),truncated:line.truncated};
 };
 const problems=eligible.filter(m=>ids.has(m.nodeId)).map(m=>{
  const node=record.nodes[m.nodeId],anchor=node.parent,played=evaluations.get(anchor)?.candidates?.find(c=>c.move===m.played);
  return {...m,beforeBoard:record.nodes[anchor].board,actualBoard:node.board,playedIndex:node.move.index,playedCandidate:played||null,bestLine:lineData(anchor,m.best),playedLine:lineData(anchor,played)};
 });
 const full=record.nodes[record.mainLine.at(-1)],numbers=[];
 for(const id of record.mainLine.slice(1)){const n=record.nodes[id];if(n.move.index!==null&&full.board[n.move.index]===n.move.side)numbers.push({index:n.move.index,side:n.move.side,label:String(n.depth)});}
 return {schemaVersion:REPORT_SCHEMA_VERSION,id:metadata.id,name:metadata.name,generatedAt:now.toISOString(),game:{players:record.players,result:record.result,date:record.date,rules:analysis.rules,komi:record.komi,moves:record.mainLine.length-1},provenance:{model:analysis.model,modelSha256:analysis.modelSha256,engine:analysis.engineVersion,visits:analysis.visits,compute:analysis.compute,completedAt:analysis.completedAt,endToEndMs:analysis.endToEndMs},players,chart:analysis.positions.map(({nodeId,move,blackLead,blackWinrate})=>({nodeId,move,blackLead,blackWinrate})),overview:{board:full.board,numbers},reviews:reviews.map(({best,alternatives,...m})=>m),problems};
}
