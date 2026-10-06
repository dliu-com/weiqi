export function estimatedAnalysisSeconds(positions,visits=10) {
  // Approximate local debug-engine timing, with headroom; queue wait is separate.
  return Math.max(10,Math.ceil((3+positions*.1*visits/10)*1.5));
}
export function analysisWait(analysis,moves,now=Date.now()) {
  const seconds=analysis.estimatedSeconds || estimatedAnalysisSeconds(moves+1);
  if(analysis.status!=='running')return {phase:'queued',seconds};
  const elapsed=Math.max(0,(now-Date.parse(analysis.startedAt))/1000);
  return Number.isFinite(elapsed)&&elapsed<seconds?{phase:'running',seconds:Math.ceil(seconds-elapsed)}:{phase:'overdue',seconds};
}
export function pendingAnalysis(analysis) {
  if(analysis.quick||analysis.deep){
    if(analysis.deep?.status==='ready')return null;
    if(analysis.status==='retry_wait')return {...analysis,phase:analysis.quick?.status==='ready'?'deep':'quick'};
    for(const phase of ['quick','deep']){const stage=analysis[phase];if(stage&&['queued','running'].includes(stage.status))return {...stage,phase};}
    return null;
  }
  return ['queued','running'].includes(analysis.status)?analysis:null;
}

export function shouldPollQuick(analysis,benchmark=null){
  if(benchmark?.queueKind==='deep'||analysis.phase==='deep'||analysis.available||analysis.status==='ready')return false;
  if(analysis.quick)return ['queued','running','retry_wait'].includes(analysis.quick.status)&&analysis.deep?.status!=='ready';
  return !analysis.deep&&['queued','running'].includes(analysis.status);
}

export function analysisCompletion(analysis,moves,now=Date.now()){
 const start=analysis.status==='running'?Date.parse(analysis.startedAt):now;
 if(!Number.isFinite(start))return null;
 const seconds=analysis.estimatedSeconds||estimatedAnalysisSeconds(moves+1);
 return {timestamp:start+seconds*1000,earliest:analysis.status!=='running'};
}

export function analysisTotalMillis(analysis,metadata,now=Date.now()) {
 if(Number.isFinite(analysis?.endToEndMs))return analysis.endToEndMs;
 const origin=analysis?.enqueuedAt||metadata?.analysis?.enqueuedAt;
 const start=Date.parse(origin),end=analysis?.completedAt?Date.parse(analysis.completedAt):now;
 return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,end-start):null;
}
