import {readSgf} from './sgf.js';
import {reviewMove,recommendedLine,moveCoordinate} from './ai-review.js';

// Shared by the report API and local preview. Metrics reuse the replay ratings.
export const REPORT_SCHEMA_VERSION=4;
const badRatings=new Set(['inaccuracy','mistake','blunder']);
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const percentile=(values,fraction)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),position=(sorted.length-1)*fraction,lower=Math.floor(position);return sorted[lower]+(sorted[Math.ceil(position)]-sorted[lower])*(position-lower);};
export function summariseLosses(items){
 const rated=items.filter(m=>m.quality&&Number.isFinite(m.pointLoss)),bad=rated.filter(m=>badRatings.has(m.quality)&&m.pointLoss>.5),points=bad.map(m=>m.pointLoss),win=bad.filter(m=>Number.isFinite(m.winrateLoss)),counts={inaccuracy:0,mistake:0,blunder:0};
 for(const m of bad)counts[m.quality]++;
 const total=points.reduce((a,b)=>a+b,0),topFive=[...points].sort((a,b)=>b-a).slice(0,5).reduce((a,b)=>a+b,0),worst=[...bad].sort((a,b)=>b.pointLoss-a.pointLoss||a.move-b.move)[0],worstWin=[...win].sort((a,b)=>b.winrateLoss-a.winrateLoss||a.move-b.move)[0];
 return {moves:items.length,ratedMoves:rated.length,unratedMoves:items.length-rated.length,estimatedMoves:rated.filter(m=>m.estimated).length,badMoves:bad.length,badPercent:rated.length?bad.length/rated.length*100:null,badEstimatedMoves:bad.filter(m=>m.estimated).length,meanPointLoss:average(rated.map(m=>m.pointLoss)),totalBadPointLoss:total,meanBadPointLoss:average(points),medianBadPointLoss:percentile(points,.5),p90BadPointLoss:percentile(points,.9),maxBadPointLoss:worst?.pointLoss??null,worstPointLossMove:worst?.move??null,topFiveBadPointLoss:topFive,topFiveLossPercent:total?topFive/total*100:null,winrateRatedBadMoves:win.length,meanBadWinrateLoss:average(win.map(m=>m.winrateLoss)),maxBadWinrateLoss:worstWin?.winrateLoss??null,worstWinrateLossMove:worstWin?.move??null,winrateDrops10pp:win.filter(m=>m.winrateLoss>=10).length,winrateDrops20pp:win.filter(m=>m.winrateLoss>=20).length,availableLeadsLost:bad.filter(m=>{const sign=m.side==='B'?1:-1;return sign*m.bestEvaluation?.blackLead>0&&sign*m.playedEvaluation?.blackLead<0;}).length,availableWinningChancesLost:bad.filter(m=>{const own=value=>m.side==='B'?value:1-value;return Number.isFinite(m.bestEvaluation?.blackWinrate)&&Number.isFinite(m.playedEvaluation?.blackWinrate)&&own(m.bestEvaluation.blackWinrate)>.5&&own(m.playedEvaluation.blackWinrate)<.5;}).length,counts,lossBuckets:[{from:.5,to:2},{from:2,to:5},{from:5,to:10},{from:10,to:null}].map(range=>{const values=points.filter(v=>v>range.from&&(range.to===null||v<=range.to));return {...range,count:values.length,totalPointLoss:values.reduce((a,b)=>a+b,0)};})};
}
export function buildAiReport(source,analysis,metadata,now=new Date()) {
 const record=readSgf(source),evaluations=new Map(analysis.positions.map(p=>[p.nodeId,p]));
 if(analysis.phase!=='deep'||record.mainLine.some(id=>!evaluations.has(id)))throw Object.assign(Error('A complete deep analysis is required to generate this report.'),{statusCode:409});
 const reviews=record.mainLine.slice(1).map(id=>{
  const node=record.nodes[id],r=reviewMove(record,id,evaluations,'deep'),before=evaluations.get(r.anchor),after=evaluations.get(id),side=node.move.side,played=r.played??moveCoordinate(node.move,record.size),sign=side==='B'?1:-1;
  const playedCandidate=before?.candidates?.find(c=>c.move===played);
  const playedWin=!r.estimated?playedCandidate?.blackWinrate:after?.blackWinrate;
  return {nodeId:id,move:node.depth,side,played,quality:r.quality,pointLoss:r.quality==='best'?0:r.loss,estimated:r.estimated,best:r.best,bestEvaluation:r.best?{blackLead:r.best.blackLead,blackWinrate:r.best.blackWinrate}:null,alternatives:r.alternatives,playedEvaluation:{blackLead:!r.estimated?playedCandidate?.blackLead:after?.blackLead,blackWinrate:playedWin},winrateLoss:r.quality==='best'?0:Number.isFinite(playedWin)&&Number.isFinite(r.best?.blackWinrate)?Math.max(0,sign*(r.best.blackWinrate-playedWin)*100):null};
 });
 const players={};for(const side of ['B','W']){const own=reviews.filter(m=>m.side===side);players[side]={name:record.players[side==='B'?'black':'white'],...summariseLosses(own),segments:[{from:1,to:60},{from:61,to:180},{from:181,to:Infinity}].map(range=>({from:range.from,to:Math.min(range.to,record.mainLine.length-1),...summariseLosses(own.filter(m=>m.move>=range.from&&m.move<=range.to))}))};}
 const eligible=reviews.filter(m=>m.best&&Number.isFinite(m.pointLoss)&&m.pointLoss>.5&&badRatings.has(m.quality)).sort((a,b)=>b.pointLoss-a.pointLoss||a.move-b.move);
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
