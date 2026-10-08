const time=value=>typeof value==='number'?value:Date.parse(value);
const seconds=stage=>Number.isFinite(stage?.estimatedSeconds)&&stage.estimatedSeconds>0?stage.estimatedSeconds:null;
function duration(analysis){
 const quick=analysis.quick?.status==='ready'?0:seconds(analysis.quick),deep=['ready','limited'].includes(analysis.deep?.status)?0:seconds(analysis.deep);
 return quick===null||deep===null?null:quick+deep;
}
function finish(job,analysis){
 if(analysis.deep?.status==='running'){
  const start=time(analysis.deep.startedAt),length=seconds(analysis.deep);
  return Number.isFinite(start)&&length!==null?[start+length*.8*1000,start+length*1.25*1000]:[Infinity,Infinity];
 }
 if(analysis.quick?.status==='running'){
  const start=time(analysis.quick.startedAt),length=duration(analysis);
  return Number.isFinite(start)&&length!==null?[start+length*.8*1000,start+length*1.25*1000]:[Infinity,Infinity];
 }
 const start=time(job.startedAt),length=duration(analysis);
 return Number.isFinite(start)&&start>0&&length!==null?[start+(90+length*.8)*1000,start+(180+length*1.25)*1000]:[Infinity,Infinity];
}
// Ranges stay anchored to Batch submission / actual worker timestamps. Never
// calculate a queued completion as "now + duration". Regional capacity remains
// uncertain, even when the configured number of worker slots is available.
export function estimateQueue({target,jobs,analyses=new Map(),slots=1,now=Date.now(),complete=true}){
 const active=jobs.filter(j=>['STARTING','RUNNING'].includes(j.status)&&j.jobId!==target.jobId);
 const ahead=jobs.filter(j=>['SUBMITTED','PENDING','RUNNABLE'].includes(j.status)&&j.jobId!==target.jobId&&(j.createdAt<target.createdAt||j.createdAt===target.createdAt&&j.jobId<target.jobId)).sort((a,b)=>a.createdAt-b.createdAt||a.jobId.localeCompare(b.jobId));
 const info={state:'queued',jobsAhead:ahead.length,activeJobs:active.length,checkedAt:new Date(now).toISOString(),basis:'workload',startsAt:null};
 if(target.status==='STARTING')return {...info,state:'starting'};
 if(target.status==='RUNNING'){
  const start=time(target.startedAt);return {...info,state:'setup',basis:'worker_started',startsAt:Number.isFinite(start)&&start>0?{earliest:start+90000,latest:start+180000}:null};
 }
 if(!['SUBMITTED','PENDING','RUNNABLE'].includes(target.status))return {...info,state:'updating'};
 if(!complete)return {...info,state:'unavailable'};
 if(/CAPACITY|MISCONFIGURATION/i.test(target.statusReason||''))return {...info,state:'capacity_wait'};
 const lanes=Array.from({length:Math.max(1,slots)},()=>[target.createdAt,target.createdAt]);
 // Busy workers occupy their lanes until BOTH quick and deep passes finish.
 for(const [index,job] of active.entries()){
  if(index>=lanes.length)return {...info,state:'capacity_wait'};
  lanes[index]=finish(job,analyses.get(job.jobId)||{});
  if(lanes[index][1]<now)lanes[index]=[Infinity,Infinity];
 }
 for(const job of ahead){
  lanes.sort((a,b)=>a[1]-b[1]);const length=duration(analyses.get(job.jobId)||{});
  if(length===null)lanes[0]=[Infinity,Infinity];
  else lanes[0]=[Math.max(job.createdAt,lanes[0][0])+(60+length*.8)*1000,Math.max(job.createdAt,lanes[0][1])+(180+length*1.25)*1000];
 }
 lanes.sort((a,b)=>a[1]-b[1]);const [early,late]=lanes[0];
 const startsAt={earliest:Math.max(target.createdAt,early)+60000,latest:Math.max(target.createdAt,late)+180000};
 if(!Number.isFinite(startsAt.latest)||startsAt.latest<now)return {...info,state:active.length||ahead.length?'busy_unknown':'capacity_wait'};
 return {...info,basis:active.length||ahead.length?'workload':'typical_startup',startsAt};
}
