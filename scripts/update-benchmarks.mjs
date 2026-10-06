import {readFile,writeFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile),root=fileURLToPath(new URL('../',import.meta.url)),region='eu-west-1';
const bucket='weiqisite-recordlibrary34c28f86-bfnqhy6739na',catalogPath=root+'cloud/benchmark-catalog.json';
const aws=async args=>JSON.parse((await execute('aws',[...args,'--region',region,'--output','json'],{maxBuffer:12*1024*1024})).stdout);
const get=async key=>{try{return JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region',region,'--only-show-errors'],{maxBuffer:8*1024*1024})).stdout);}catch(e){if(/NoSuchKey|404|does not exist/.test(e.stderr||''))return null;throw e;}};
export async function updateBenchmarks({publish=false}={}){
 const catalog=new Map(JSON.parse(await readFile(catalogPath,'utf8')).map(r=>[r.id,r]));
 for(const dir of await readdir('/private/tmp',{withFileTypes:true})){
  if(!dir.isDirectory()||!dir.name.startsWith('weiqi-gpu-'))continue;
  let summary;try{summary=JSON.parse(await readFile('/private/tmp/'+dir.name+'/summary.json','utf8'));}catch{continue;}
  for(const r of summary.results||[]){const prior=catalog.get(r.jobId),merged={...prior,...r,id:r.jobId,moves:summary.moves,model:summary.model,backend:'gpu',runId:summary.runId,analysisThreads:r.analysisThreads||summary.analysisThreads||16,maxBatchSize:r.maxBatchSize||summary.maxBatchSize||32};if(prior?.timingVerified)for(const key of ['totalExcludingQueueSeconds','estimatedComputeUSD','coldStart','instanceId','instanceStartupSeconds','taskStartupSeconds'])merged[key]=prior[key];catalog.set(r.jobId,merged);}
 }
 const records=[...catalog.values()],jobIds=records.filter(r=>r.jobId).map(r=>r.jobId);
 const jobs=new Map();for(let n=0;n<jobIds.length;n+=100)for(const j of (await aws(['batch','describe-jobs','--jobs',...jobIds.slice(n,n+100)])).jobs)jobs.set(j.jobId,j);
 const instances=(await aws(['ec2','describe-instances','--filters','Name=tag:service,Values=weiqi-gpu-benchmark'])).Reservations.flatMap(r=>r.Instances);
 for(const r of records){
  const job=jobs.get(r.jobId);
  if(job){r.status=job.status;r.statusReason=job.statusReason;r.createdAt=new Date(job.createdAt).toISOString();if(r.productionPrefix&&r.enqueuedAt&&!r.capacityFallback)r.triggerSeconds=Math.max(0,(job.createdAt-Date.parse(r.enqueuedAt))/1000);r.startedAt=job.startedAt?new Date(job.startedAt).toISOString():null;
   const res=Object.fromEntries((job.container.resourceRequirements||[]).map(x=>[x.type,Number(x.value)]));r.cpu=res.VCPU;r.memoryGB=r.backend==='gpu'?16:res.MEMORY/1024;
   if(r.productionPrefix&&!r.sourceVerified){const meta=await get(r.productionPrefix+'/metadata.json');if(meta){r.moves=meta.moves;r.enqueuedAt=meta.analysis.enqueuedAt;r.capacityFallback=!!meta.analysis[r.phase]?.fallback&&r.backend==='fargate-cpu';const requestKey=job.container.environment.find(e=>e.name==='BENCHMARK_REQUEST_KEY')?.value;const request=requestKey?await get(requestKey):null;if(request){r.phase=request.phase;r.visits=request.query.maxVisits;r.plannedPositions=request.query.analyzeTurns.length;}}r.sourceVerified=true;}
   if(job.status==='SUCCEEDED'&&(!r.timings||!r.positions)){
    const prefix=r.productionPrefix||r.prefix;
    const a=await get(prefix+(r.phase==='quick'?'/analysis-quick.json':'/analysis.json'));
    const timing=await get(r.productionPrefix?'jobs/'+r.recordId+(r.phase?'/'+r.phase+'-timings.json':'/timings.json'):prefix+'/timings.json');
    if(a){r.positions=a.positions.length;r.engineVersion=a.engineVersion;r.model=a.model;r.modelSha256=a.modelSha256;r.completedAt=a.completedAt;r.configuration=a.configuration;}
    if(timing){r.timings=timing.timings;r.completedAt=timing.completedAt;}
   }
   if(job.container.taskArn&&['SUCCEEDED','FAILED'].includes(job.status)&&!r.timingVerified){
    const arn=job.container.taskArn,cluster=arn.split('/').at(-2),task=(await aws(['ecs','describe-tasks','--cluster',cluster,'--tasks',arn])).tasks[0];
    if(task){r.taskStartupSeconds=(Date.parse(task.startedAt)-Date.parse(task.createdAt))/1000;r.imagePullSeconds=(Date.parse(task.pullStoppedAt)-Date.parse(task.pullStartedAt))/1000;
     let begin=Date.parse(task.createdAt);
     if(r.backend==='gpu'){
      const c=(await aws(['ecs','describe-container-instances','--cluster',cluster,'--container-instances',job.container.containerInstanceArn])).containerInstances[0];
      const instance=instances.find(i=>i.InstanceId===c?.ec2InstanceId);
      if(instance){r.instanceId=instance.InstanceId;const previous=records.some(other=>other!==r&&other.instanceId===r.instanceId&&Date.parse(other.completedAt)<Date.parse(r.completedAt));r.coldStart=!previous;r.instanceStartupSeconds=previous?0:(Date.parse(task.createdAt)-Date.parse(instance.LaunchTime))/1000;if(!previous)begin=Date.parse(instance.LaunchTime);}
     }
     r.queueWaitSeconds=Math.max(0,(begin-job.createdAt)/1000);
     if(r.completedAt)r.totalExcludingQueueSeconds=(r.productionPrefix?0:r.triggerSeconds||0)+(Date.parse(r.completedAt)-begin)/1000;
     if(r.backend!=='gpu'&&task.stoppedAt){const seconds=Math.max(60,(Date.parse(task.stoppedAt)-Date.parse(task.pullStartedAt))/1000);r.estimatedComputeAndIpUSD=seconds/3600*(r.cpu*.04048+r.memoryGB*.004445+.005);}
     if(r.backend==='gpu'&&Number.isFinite(r.totalExcludingQueueSeconds))r.estimatedComputeUSD=r.totalExcludingQueueSeconds/3600*((r.instanceType==='g5.xlarge'?1.123:.587)+.005+.02);
     r.timingVerified=true;
    }
   }
  }
  if(r.productionPrefix&&r.phase==='deep'&&r.backend==='fargate-cpu'&&r.visits===96)r.capacityFallback=true;
  if(r.productionPrefix&&r.enqueuedAt&&r.createdAt&&r.completedAt&&Number.isFinite(r.queueWaitSeconds)){
   const beforeSubmit=(Date.parse(r.createdAt)-Date.parse(r.enqueuedAt))/1000;
   if(r.capacityFallback){
    if(!r.fallbackQueueTimingVerified){r.queueWaitSeconds+=beforeSubmit;r.fallbackQueueTimingVerified=true;}
    delete r.triggerSeconds;
    r.totalExcludingQueueSeconds=(Date.parse(r.completedAt)-Date.parse(r.enqueuedAt))/1000-r.queueWaitSeconds;
   }else{r.triggerSeconds=Math.max(0,beforeSubmit);r.totalExcludingQueueSeconds=(Date.parse(r.completedAt)-Date.parse(r.createdAt))/1000-r.queueWaitSeconds;}
  }
  if(r.timings){r.analysisSeconds=r.timings.engineLoadAndAnalysisMs/1000;r.setupSeconds=((r.timings.containerTotalMs??r.timings.workerTotalMs)-r.timings.engineLoadAndAnalysisMs-r.timings.provenanceMs-r.timings.saveResultsAndStatusMs)/1000;r.saveSeconds=(r.timings.provenanceMs+r.timings.saveResultsAndStatusMs)/1000;}
 }
 await writeFile(catalogPath,JSON.stringify(records,null,2)+'\n');
 const publicRecords=records.filter(r=>!['FAILED','STOPPED','CANCELLED','CANCELED','TERMINATED'].includes((r.status||'').toUpperCase())).map(r=>({id:r.id,backend:r.backend,scenario:r.scenario,capacityFallback:r.capacityFallback,cpu:r.cpu,memoryGB:r.memoryGB,gpu:r.gpuType,instanceType:r.instanceType,moves:r.moves,positions:r.positions,model:r.model,engineVersion:r.engineVersion,visits:r.visits,analysisThreads:r.analysisThreads??r.configuration?.analysisThreads,maxBatchSize:r.maxBatchSize??r.configuration?.maxBatchSize,status:r.status,statusReason:r.statusReason,createdAt:(r.createdAt??r.runId).replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/,'T$1:$2:$3.$4Z'),completedAt:r.completedAt,recordUrl:r.archived?undefined:r.recordUrl,archived:!!r.archived,totalIncludingQueueSeconds:r.completedAt&&(r.enqueuedAt||r.createdAt)?(Date.parse(r.completedAt)-Date.parse(r.enqueuedAt||r.createdAt))/1000+(r.productionPrefix?0:r.triggerSeconds||0):undefined,queueWaitSeconds:r.queueWaitSeconds,triggerSeconds:r.triggerSeconds,instanceStartupSeconds:r.instanceStartupSeconds,startupSeconds:r.taskStartupSeconds??r.startupSeconds,imagePullSeconds:r.imagePullSeconds,setupSeconds:r.setupSeconds,modelDownloadSeconds:r.timings?.downloadModelMs/1000,engineSeconds:r.analysisSeconds,saveSeconds:r.saveSeconds??r.finalizeAndSaveSeconds,totalSeconds:r.totalExcludingQueueSeconds??(r.backend==='lambda-cpu'?r.waitMs/1000:undefined),costUSD:r.estimatedComputeAndIpUSD??r.estimatedComputeUSD??r.costUSD,coldStart:r.coldStart,peakMemoryMB:r.timings?.containerPeakMemoryMB}));
 const destination=root+'src/benchmarks-data.json';
 let previous;try{previous=JSON.parse(await readFile(destination,'utf8'));}catch{}
 let quality;try{quality=JSON.parse(await readFile(root+'cloud/benchmark-quality.json','utf8'));}catch{}
 const unchanged=JSON.stringify(previous?.experiments)===JSON.stringify(publicRecords)&&JSON.stringify(previous?.quality)===JSON.stringify(quality);
 const data={updatedAt:unchanged?previous.updatedAt:new Date().toISOString(),region,quality,experiments:publicRecords};
 await writeFile(destination,JSON.stringify(data,null,2)+'\n');
 if(publish&&!unchanged){const stack=await aws(['cloudformation','describe-stacks','--stack-name','WeiqiSite']);const siteBucket=stack.Stacks[0].Outputs.find(o=>o.OutputKey==='SiteBucketName').OutputValue;await execute('aws',['s3','cp',destination,'s3://'+siteBucket+'/benchmarks-data.json','--region',region,'--content-type','application/json','--cache-control','public, max-age=0, must-revalidate','--only-show-errors']);}
 return data;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const data=await updateBenchmarks({publish:process.argv.includes('--publish')});console.log('Benchmark page updated: '+data.experiments.length+' experiments.');}
