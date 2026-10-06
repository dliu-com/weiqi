import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),outdir=process.argv[2] || '/private/tmp/weiqi-fargate-spec-benchmarks';
const summary=JSON.parse(await readFile(outdir+'/summary.json','utf8'));
const aws=async args=>JSON.parse((await execute('aws',[...args,'--region','eu-west-1','--output','json'],{maxBuffer:2*1024*1024})).stdout);
const jobs=await aws(['batch','describe-jobs','--jobs',...summary.results.map(r=>r.jobId)]);
for(const r of summary.results){
 const job=jobs.jobs.find(j=>j.jobId===r.jobId);r.status=job.status;
 if(job.startedAt)r.queueAndStartSeconds=(job.startedAt-job.createdAt)/1000;
 try{
  for(const filename of ['analysis.json','timings.json'])await execute('aws',['s3','cp','s3://'+summary.bucket+'/'+r.prefix+'/'+filename,outdir+'/'+(r.label||r.cpu)+'-'+filename,'--region','eu-west-1','--only-show-errors']);
  const a=JSON.parse(await readFile(outdir+'/'+(r.label||r.cpu)+'-analysis.json','utf8')),t=JSON.parse(await readFile(outdir+'/'+(r.label||r.cpu)+'-timings.json','utf8'));
  r.timings=t.timings;r.positions=a.positions.length;r.rules=a.rules;r.modelSha256=a.modelSha256;
  r.analysisSeconds=t.timings.engineLoadAndAnalysisMs/1000;
  r.resultsReadySeconds=(Date.parse(t.completedAt)-Date.parse(t.requestedAt))/1000;
  r.completedAt=t.completedAt;
  r.setupSeconds=(t.timings.containerTotalMs-t.timings.engineLoadAndAnalysisMs-t.timings.provenanceMs-t.timings.saveResultsAndStatusMs)/1000;
  r.finalizeAndSaveSeconds=(t.timings.provenanceMs+t.timings.saveResultsAndStatusMs)/1000;
 }catch{ /* In-progress jobs have no complete output yet. */ }
 if(r.recordId&&!r.archived){
  const metaFile=outdir+'/'+r.recordId+'-metadata.json';
  await execute('aws',['s3','cp','s3://'+summary.bucket+'/games/'+r.recordId+'/metadata.json',metaFile,'--region','eu-west-1','--only-show-errors']);
  const meta=JSON.parse(await readFile(metaFile,'utf8'));
  if(r.positions){
   const a=JSON.parse(await readFile(outdir+'/'+(r.label||r.cpu)+'-analysis.json','utf8'));a.id=r.recordId;
   const file=outdir+'/'+r.recordId+'-analysis.json';await writeFile(file,JSON.stringify(a));
   await execute('aws',['s3','cp',file,'s3://'+summary.bucket+'/games/'+r.recordId+'/analysis.json','--content-type','application/json','--region','eu-west-1','--only-show-errors']);
   meta.analysis={...meta.analysis,status:'ready',completedAt:a.completedAt};
  }else meta.analysis={...meta.analysis,status:job.status==='FAILED'?'failed':job.status==='RUNNING'?'running':'queued',...(job.startedAt?{startedAt:new Date(job.startedAt).toISOString()}:{}),message:job.statusReason};
  await writeFile(metaFile,JSON.stringify(meta));await execute('aws',['s3','cp',metaFile,'s3://'+summary.bucket+'/games/'+r.recordId+'/metadata.json','--content-type','application/json','--region','eu-west-1','--only-show-errors']);
 }
 if(job.container?.taskArn){
  const parts=job.container.taskArn.split('/'),data=await aws(['ecs','describe-tasks','--cluster',parts.at(-2),'--tasks',parts.at(-1)]),task=data.tasks[0];
  if(task){
   if(task.createdAt&&task.startedAt)r.startupSeconds=(Date.parse(task.startedAt)-Date.parse(task.createdAt))/1000;
   if(task.createdAt&&r.completedAt)r.totalExcludingQueueSeconds=(Date.parse(r.completedAt)-Date.parse(task.createdAt))/1000;
   r.imagePullSeconds=(Date.parse(task.pullStoppedAt)-Date.parse(task.pullStartedAt))/1000;
   if(task.stoppedAt){
    r.billedComputeSeconds=Math.max(60,Math.ceil((Date.parse(task.stoppedAt)-Date.parse(task.pullStartedAt))/1000));
    // Official AWS Ireland Linux/x86 on-demand rates retrieved on 2026-10-05.
    r.estimatedComputeUSD=r.billedComputeSeconds/3600*(r.cpu*.04048+r.memoryGB*.004445);
    r.estimatedComputeAndIpUSD=r.estimatedComputeUSD+r.billedComputeSeconds/3600*.005;
   }
  }
 }
}
summary.pricing='USD estimates before free tier/credits, excluding API, storage, transfer and logs; public-IP cost approximate.';
await writeFile(outdir+'/summary.json',JSON.stringify(summary,null,2));
for(const r of summary.results)console.log(JSON.stringify({cpu:r.cpu,memoryGB:r.memoryGB,status:r.status,triggerSeconds:r.triggerSeconds,startupSeconds:r.startupSeconds,imagePullSeconds:r.imagePullSeconds,setupSeconds:r.setupSeconds,finalizeAndSaveSeconds:r.finalizeAndSaveSeconds,totalExcludingQueueSeconds:r.totalExcludingQueueSeconds,analysisSeconds:r.analysisSeconds,resultsReadySeconds:r.resultsReadySeconds,costUSD:r.estimatedComputeAndIpUSD,peakMemoryMB:r.timings?.containerPeakMemoryMB,enginePeakRssMB:r.timings?.enginePeakRssMB,cpuSeconds:r.timings?.engineCpuSeconds}));
