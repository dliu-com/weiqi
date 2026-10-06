import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import katagoModels from '../backend/katago-model.cjs';
import {readSgf,kataQuery} from '../src/sgf.js';
import {attachBenchmarkRecords} from './benchmark-records.mjs';
import {updateBenchmarks} from './update-benchmarks.mjs';
const execute=promisify(execFile),region='eu-west-1';
const [filename,outdir='/private/tmp/weiqi-gpu-comparison',types='T4,A10G',depths='128,1000',threadArgument='16',batchArgument='32']=process.argv.slice(2);
const analysisThreads=Number(threadArgument),maxBatchSize=Number(batchArgument);
if(![8,16,32].includes(analysisThreads)||![16,32,64].includes(maxBatchSize))throw Error('Unsupported GPU analysis thread or batch setting.');
if(!filename)throw Error('Provide the SGF filename.');
await mkdir(outdir,{recursive:true});
const aws=async args=>JSON.parse((await execute('aws',[...args,'--region',region,'--output','json'],{maxBuffer:8*1024*1024})).stdout);
const wait=()=>new Promise(r=>setTimeout(r,30000));
const stack=await aws(['cloudformation','describe-stacks','--stack-name','WeiqiGpuBenchmark']);
const outputs=Object.fromEntries(stack.Stacks[0].Outputs.map(o=>[o.OutputKey,o.OutputValue]));
const bucket='weiqisite-recordlibrary34c28f86-bfnqhy6739na',source=await readFile(filename,'utf8'),record=readSgf(source),model=await katagoModels.resolveLatestModel();
const prices=JSON.parse(await readFile('/private/tmp/weiqi-gpu-prices.json','utf8'));
const specs={T4:'g4dn.xlarge',A10G:'g5.xlarge',L4:'g6.xlarge'},runId=new Date().toISOString().replace(/[:.]/g,'-');
const report={runId,bucket,model:model.name,moves:record.mainLine.length-1,rules:record.rules||'japanese',analysisThreads,maxBatchSize,results:[],instances:[],pricing:prices};
const save=()=>writeFile(outdir+'/summary.json',JSON.stringify(report,null,2));
const put=async(key,body)=>{const file=outdir+'/upload.json';await writeFile(file,JSON.stringify(body));await execute('aws',['s3','cp',file,'s3://'+bucket+'/'+key,'--content-type','application/json','--region',region,'--only-show-errors']);};
const get=async key=>JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region',region,'--only-show-errors'],{maxBuffer:8*1024*1024})).stdout);
let activeJob=null,activeCompute=null;
async function gpuInstances(gpu){const response=await aws(['ec2','describe-instances','--filters',JSON.stringify([{Name:'tag:service',Values:['weiqi-gpu-benchmark']},...(gpu?[{Name:'tag:benchmarkGpu',Values:[gpu]}]:[]),{Name:'instance-state-name',Values:['pending','running','stopping','stopped','shutting-down']}])]);return response.Reservations.flatMap(r=>r.Instances);}
async function stopInstance(gpu){
 await aws(['batch','update-compute-environment','--compute-environment',outputs[gpu+'ComputeArn'],'--state','DISABLED']);
 const instances=await gpuInstances(gpu);if(instances.length)await aws(['ec2','terminate-instances','--instance-ids',...instances.map(i=>i.InstanceId),'--force','--skip-os-shutdown']);
 for(let n=0;n<20;n++){if(!(await gpuInstances(gpu)).some(i=>['pending','running'].includes(i.State.Name)))break;await wait();}
}
try{
 for(const gpu of types.split(',')){
  if(!specs[gpu])throw Error('Unsupported GPU '+gpu);
  // Never overlap GPU workers: the quota is four instance vCPUs, not four GPUs.
  if((await gpuInstances()).some(i=>['pending','running'].includes(i.State.Name)))throw Error('An earlier benchmark GPU instance remains allocated.');
  activeCompute=gpu;
  await aws(['batch','update-compute-environment','--compute-environment',outputs[gpu+'ComputeArn'],'--state','ENABLED']);
  for(const visits of depths.split(',').map(Number)){
   const label=gpu+'-'+visits+'-threads'+analysisThreads+'-batch'+maxBatchSize,id='gpu-'+runId+'-'+label,prefix='benchmarks/'+runId+'/'+label;
   const compute={backend:'gpu',vCpu:4,memoryGB:16,gpu:'NVIDIA '+gpu,gpuCount:1,gpuMemoryGB:gpu==='A10G'?24:16,instanceType:specs[gpu]};
   const request={id,query:kataQuery(record,id,visits),nodeIds:record.mainLine,sgfSha256:createHash('sha256').update(source).digest('hex'),requestedAt:new Date().toISOString(),outputPrefix:prefix,compute};
   await put(prefix+'/request.json',request);
   const triggerStart=performance.now(),submitted=await aws(['batch','submit-job','--cli-input-json',JSON.stringify({jobName:id,jobQueue:outputs[gpu+'QueueArn'],jobDefinition:outputs.JobDefinition,containerOverrides:{environment:[{name:'BENCHMARK_REQUEST_KEY',value:prefix+'/request.json'},{name:'KATAGO_MODEL_KEY',value:model.key},{name:'KATAGO_MODEL_URL',value:model.url},{name:'ANALYSIS_THREADS',value:String(analysisThreads)},{name:'NN_MAX_BATCH_SIZE',value:String(maxBatchSize)}]}})]);
   activeJob=submitted.jobId;
   const result={label,gpuType:gpu,instanceType:specs[gpu],cpu:4,memoryGB:16,visits,analysisThreads,maxBatchSize,triggerSeconds:(performance.now()-triggerStart)/1000,jobId:activeJob,prefix,status:'SUBMITTED'};report.results.push(result);
   const attach={bucket,model:model.name,queueKind:visits<1000?'quick':'deep',results:[result]};await attachBenchmarkRecords(attach,source);await save();await updateBenchmarks({publish:true});console.log('Submitted '+label+' '+result.recordUrl);
   let previous='',job;
   for(let n=0;n<140;n++){
    job=(await aws(['batch','describe-jobs','--jobs',activeJob])).jobs[0];result.status=job.status;
    const instances=await gpuInstances(gpu);
    for(const instance of instances){if(!report.instances.some(i=>i.id===instance.InstanceId))report.instances.push({id:instance.InstanceId,gpu,instanceType:instance.InstanceType,launchedAt:instance.LaunchTime,hourlyUSD:prices[instance.InstanceType].hourlyUSD});}
    const estimate=report.instances.reduce((sum,i)=>sum+((i.releasedAt?Date.parse(i.releasedAt):Date.now())-Date.parse(i.launchedAt))/3600000*(i.hourlyUSD+.005+.02),0);
    if(estimate>15)throw Error('GPU development allowance exhausted; stopping to preserve the total USD30 cap.');
    if(job.status!==previous){console.log(label+': '+job.status+' '+(job.statusReason||''));previous=job.status;const meta=await get('games/'+result.recordId+'/metadata.json');meta.analysis={...meta.analysis,status:['RUNNING','SUCCEEDED','FAILED'].includes(job.status)?'running':'queued',...(job.startedAt?{startedAt:new Date(job.startedAt).toISOString()}: {})};await put('games/'+result.recordId+'/metadata.json',meta);}
    await save();if(['SUCCEEDED','FAILED'].includes(job.status))break;await wait();
   }
   if(!['SUCCEEDED','FAILED'].includes(job.status))throw Error('GPU benchmark did not finish within its development monitoring allowance.');
   activeJob=null;
   let metadata=await get('games/'+result.recordId+'/metadata.json');
   if(job.status==='SUCCEEDED'){
    const analysis=await get(prefix+'/analysis.json'),timing=await get(prefix+'/timings.json');analysis.id=result.recordId;analysis.phase=visits<1000?'quick':'deep';analysis.compute=compute;
    result.timings=timing.timings;result.positions=analysis.positions.length;result.engineVersion=analysis.engineVersion;result.modelSha256=analysis.modelSha256;result.completedAt=timing.completedAt;
    result.analysisSeconds=timing.timings.engineLoadAndAnalysisMs/1000;result.setupSeconds=(analysis.elapsedMs-timing.timings.engineLoadAndAnalysisMs)/1000;
    await writeFile(outdir+'/'+label+'-analysis.json',JSON.stringify(analysis));await writeFile(outdir+'/'+label+'-timings.json',JSON.stringify(timing));
    await put('games/'+result.recordId+'/analysis.json',analysis);metadata.analysis={...metadata.analysis,status:'ready',completedAt:analysis.completedAt};
    if(job.container?.taskArn){const taskArn=job.container.taskArn,p=taskArn.split('/'),task=(await aws(['ecs','describe-tasks','--cluster',p.at(-2),'--tasks',taskArn])).tasks[0];
     result.taskCreatedAt=task.createdAt;result.taskStartedAt=task.startedAt;result.taskStoppedAt=task.stoppedAt;result.imagePullSeconds=(Date.parse(task.pullStoppedAt)-Date.parse(task.pullStartedAt))/1000;
     result.taskStartupSeconds=(Date.parse(task.startedAt)-Date.parse(task.createdAt))/1000;
     result.containerSetupSeconds=(Date.parse(timing.workerStartedAt)-Date.parse(task.startedAt))/1000;
     const container=(await aws(['ecs','describe-container-instances','--cluster',p.at(-2),'--container-instances',job.container.containerInstanceArn])).containerInstances[0];
     result.instanceId=container.ec2InstanceId;
     const instance=report.instances.find(i=>i.id===result.instanceId);if(!instance)throw Error('Missing actual benchmark instance allocation.');
     result.coldStart=!report.results.some(r=>r!==result&&r.instanceId===result.instanceId&&r.status==='SUCCEEDED');
     const start=result.coldStart?instance.launchedAt:task.createdAt;
     result.instanceStartupSeconds=result.coldStart?(Date.parse(task.createdAt)-Date.parse(instance.launchedAt))/1000:0;
     result.totalExcludingQueueSeconds=result.triggerSeconds+(Date.parse(timing.completedAt)-Date.parse(start))/1000;
     result.estimatedComputeUSD=(Date.parse(timing.completedAt)-Date.parse(start))/3600000*(instance.hourlyUSD+.005+.02);
    }
   }else metadata.analysis={...metadata.analysis,status:'failed',message:job.statusReason};
   await put('games/'+result.recordId+'/metadata.json',metadata);await save();await updateBenchmarks({publish:true});console.log(JSON.stringify(result));
   if(job.status==='FAILED')break;
  }
  await stopInstance(gpu);for(const instance of report.instances.filter(i=>i.gpu===gpu)){instance.releasedAt=new Date().toISOString();instance.estimatedComputeIpAndStorageUSD=(Date.parse(instance.releasedAt)-Date.parse(instance.launchedAt))/3600000*(instance.hourlyUSD+.005+.02);}activeCompute=null;await save();
 }
 console.log('GPU comparison finished. All benchmark GPU instances released.');
}catch(error){
 if(activeJob)await aws(['batch','terminate-job','--job-id',activeJob,'--reason','Development benchmark stopped: '+error.message]);
 if(activeCompute)await stopInstance(activeCompute);report.error=error.message;await save();await updateBenchmarks({publish:true});throw error;
}
