export function estimatedAnalysisSeconds(positions,visits=10) {
  // Approximate local debug-engine timing, with headroom; queue wait is separate.
  return Math.max(10,Math.ceil((3+positions*.1*visits/10)*1.5));
}
export const QUICK_POLL_INTERVAL_MS=60000;
export const conservativeMinute=timestamp=>Math.ceil(timestamp/60000)*60000;
export function analysisWait(analysis,moves,now=Date.now()) {
  const seconds=analysis.estimatedSeconds || estimatedAnalysisSeconds(moves+1);
  if(analysis.status!=='running')return {phase:'queued',seconds};
  const elapsed=Math.max(0,(now-Date.parse(analysis.startedAt))/1000);
  return Number.isFinite(elapsed)&&elapsed<seconds?{phase:'running',seconds:Math.ceil(seconds-elapsed)}:{phase:'overdue',seconds};
}
export function pendingAnalysis(analysis) {
  if(analysis.status==='paused')return null;
  if(analysis.quick||analysis.deep){
    if(analysis.deep?.status==='ready')return null;
    if(analysis.status==='retry_wait')return {...analysis,phase:analysis.quick?.status==='ready'?'deep':'quick'};
    for(const phase of ['quick','deep']){const stage=analysis[phase];if(stage&&['queued','running'].includes(stage.status))return {...stage,phase,queueStatus:analysis.queueStatus};}
    return null;
  }
  return ['queued','running'].includes(analysis.status)?analysis:null;
}

export function shouldPollQuick(analysis,benchmark=null){
  if(analysis.status==='paused')return false;
  if(benchmark?.queueKind==='deep'||analysis.phase==='deep'||analysis.available||analysis.status==='ready')return false;
  if(analysis.quick)return ['queued','running','retry_wait'].includes(analysis.quick.status)&&analysis.deep?.status!=='ready';
  return !analysis.deep&&['queued','running'].includes(analysis.status);
}

export function analysisCompletion(analysis,moves,now=Date.now()){
 const seconds=analysis.estimatedSeconds||estimatedAnalysisSeconds(moves+1);
 if(analysis.status==='running'){
  const start=Date.parse(analysis.startedAt);
  return Number.isFinite(start)?{timestamp:start+seconds*1000,earliest:false}:null;
 }
 const range=analysis.queueStatus?.startsAt;
 if(!range||!Number.isFinite(range.earliest)||!Number.isFinite(range.latest)||range.latest<now)return null;
 // Both passes share one GPU; the queue forecast already describes the start
 // of the currently pending pass (quick, or deep when quick is complete).
 return {timestamp:range.latest+seconds*1000,windowStart:range.earliest+seconds*1000,earliest:false};
}
export function queueWait(analysis,now=Date.now()){
 const queue=analysis.queueStatus||{state:'unavailable'},range=queue.startsAt;
 if(!range||!Number.isFinite(range.earliest)||!Number.isFinite(range.latest))return {...queue,seconds:null};
 if(range.latest<now)return {...queue,state:queue.basis==='typical_startup'?'capacity_wait':'busy_unknown',seconds:null,expired:true};
 return {...queue,seconds:{earliest:Math.max(0,Math.ceil((range.earliest-now)/1000)),latest:Math.max(0,Math.ceil((range.latest-now)/1000))}};
}

export function analysisTotalMillis(analysis,metadata,now=Date.now()) {
 if(Number.isFinite(analysis?.endToEndMs))return analysis.endToEndMs;
 const origin=analysis?.enqueuedAt||metadata?.analysis?.enqueuedAt;
 const start=Date.parse(origin),end=analysis?.completedAt?Date.parse(analysis.completedAt):now;
 return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):null;
}
