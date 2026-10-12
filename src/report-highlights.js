import {keyMoments} from './report-insights.js';
// Keep cached report data intact; key moments use the shared rule and three per side get board reviews.
export const REPORT_MOVE_LIMIT=3;
export function selectReportHighlights(report){
 const eligible=report.problems.filter(m=>['inaccuracy','mistake','blunder'].includes(m.quality)&&Number.isFinite(m.pointLoss)&&m.pointLoss>.5);
 const {scope,...keyMoves}=keyMoments(eligible,report.chart||[]);
 const problems=['B','W'].flatMap(side=>keyMoves[side].slice(0,REPORT_MOVE_LIMIT));
 return {...report,problems,keyMoves,keyScope:scope};
}
