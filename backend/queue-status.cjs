const {BatchClient,DescribeJobsCommand,ListJobsCommand}=require('@aws-sdk/client-batch');
const queueBatch=new BatchClient({maxAttempts:1,requestHandler:{connectionTimeout:1000,requestTimeout:3000}}),queueSnapshots=new Map();
async function queueSnapshot(queue){
 const cached=queueSnapshots.get(queue);if(cached&&Date.now()-cached.checkedAt<15000)return cached.promise;
 const promise=(async()=>{
  const lists=await Promise.all(['SUBMITTED','PENDING','RUNNABLE','STARTING','RUNNING'].map(jobStatus=>queueBatch.send(new ListJobsCommand({jobQueue:queue,jobStatus,maxResults:1000}))));
  const jobs=lists.flatMap(list=>list.jobSummaryList||[]),analyses=new Map();
  // Bounded by the public daily cap; skip unrelated jobs and fail open on
  // missing metadata rather than inventing their processing duration.
  await Promise.all(jobs.slice(0,50).map(async job=>{const id=/^weiqi-(\d{10,14})-a\d+-[a-f0-9]{8}$/.exec(job.jobName||'')?.[1];if(!id)return;try{const meta=JSON.parse(await libraryStore.get(gamePrefix(id)+'/metadata.json'));if(meta.analysis.jobId===job.jobId)analyses.set(job.jobId,meta.analysis);}catch{}}));
  return {jobs,analyses,complete:jobs.length<=50&&!lists.some(list=>list.nextToken)};
 })();queueSnapshots.set(queue,{checkedAt:Date.now(),promise});try{return await promise;}catch(e){queueSnapshots.delete(queue);throw e;}
}
async function attachQueueStatus(metadata){
 const analysis=metadata.analysis;if(!analysis)return;
 const pending=analysis.quick||analysis.deep?['quick','deep'].find(phase=>analysis[phase]?.status==='queued'):analysis.status==='queued'?'quick':null;
 if(!pending||analysis.status==='retry_wait'||['ready','failed','limited'].includes(analysis.status))return;
 if(pending==='deep'&&analysis.quick?.status==='running')return;
 if(pending==='deep'&&analysis.quick?.status==='ready'&&Number.isFinite(Date.parse(analysis.quick.completedAt))){const start=Date.parse(analysis.quick.completedAt);analysis.queueStatus={state:'between_passes',basis:'quick_completed',startsAt:{earliest:start,latest:start+60000}};return;}
 if(!analysis.jobId){analysis.queueStatus={state:'dispatching',startsAt:null};return;}
 try{
  const job=(await queueBatch.send(new DescribeJobsCommand({jobs:[analysis.jobId]}))).jobs?.[0];
  if(!job||!/^weiqi-\d{10,14}-a\d+-[a-f0-9]{8}$/.test(job.jobName||''))return;
  const snapshot=await queueSnapshot(job.jobQueue),slots=analysis.backend==='primary'?2:1;
  analysis.queueStatus=estimateQueue({target:job,...snapshot,slots});
 }catch(e){console.error('Queue status temporarily unavailable',{name:e.name});analysis.queueStatus={state:'unavailable',startsAt:null};}
}
