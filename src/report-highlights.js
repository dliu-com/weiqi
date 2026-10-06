// Keep cached report data intact; the reader view highlights three bad moves per side.
export const REPORT_MOVE_LIMIT=3;
export function selectReportHighlights(report){
 const eligible=report.problems.filter(m=>['inaccuracy','mistake','blunder'].includes(m.quality)&&Number.isFinite(m.pointLoss)&&m.pointLoss>.5);
 const problems=['B','W'].flatMap(side=>eligible.filter(m=>m.side===side).sort((a,b)=>b.pointLoss-a.pointLoss||a.move-b.move).slice(0,REPORT_MOVE_LIMIT));
 const players=Object.fromEntries(['B','W'].map(side=>{const player=report.players[side],loss=problems.filter(m=>m.side===side).reduce((total,m)=>total+m.pointLoss,0);return [side,{...player,highlightLossPercent:player.totalPointLoss>0?100*loss/player.totalPointLoss:null}];}));
 return {...report,problems,players};
}
