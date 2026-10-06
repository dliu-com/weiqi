import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,mkdtemp} from 'node:fs/promises';
const execute=promisify(execFile),region='eu-west-1',bucket='weiqisite-recordlibrary34c28f86-bfnqhy6739na';
const folder=await mkdtemp('/private/tmp/weiqi-compute-info-');
const aws=async args=>JSON.parse((await execute('aws',[...args,'--region',region,'--output','json'],{maxBuffer:8*1024*1024})).stdout);
const get=async key=>{try{return JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region',region,'--only-show-errors'],{maxBuffer:8*1024*1024})).stdout);}catch(e){if(/NoSuchKey|404|does not exist/.test(e.stderr||''))return null;throw e;}};
const put=async(key,data)=>{const file=folder+'/analysis.json';await writeFile(file,JSON.stringify(data));await execute('aws',['s3','cp',file,'s3://'+bucket+'/'+key,'--region',region,'--content-type','application/json','--only-show-errors']);};
const objects=(await aws(['s3api','list-objects-v2','--bucket',bucket,'--prefix','games/'])).Contents||[];
const jobs=new Map(),types=new Map();
for(const object of objects.filter(o=>o.Key.endsWith('/metadata.json'))){
 const metadata=await get(object.Key);
 for(const name of ['analysis-quick.json','analysis.json']){
  const key=object.Key.replace('metadata.json',name),analysis=await get(key);if(!analysis||analysis.compute)continue;
  const phase=analysis.phase||'deep',jobId=metadata.analysis?.[phase]?.jobId||metadata.benchmark?.jobId||metadata.analysis?.jobId;
  if(!jobId)continue;
  if(!jobs.has(jobId))jobs.set(jobId,(await aws(['batch','describe-jobs','--jobs',jobId])).jobs[0]);
  const job=jobs.get(jobId);if(!job)continue;
  const resources=Object.fromEntries((job.container?.resourceRequirements||[]).map(r=>[r.type,Number(r.value)]));
  const compute={backend:resources.GPU?'gpu':'fargate-cpu',vCpu:resources.VCPU,memoryGB:resources.MEMORY/1024};
  if(resources.GPU){
   const arn=job.container.containerInstanceArn;if(!arn)continue;
   const cluster=arn.split('/').at(-2),container=(await aws(['ecs','describe-container-instances','--cluster',cluster,'--container-instances',arn])).containerInstances?.[0];if(!container)continue;
   const instance=(await aws(['ec2','describe-instances','--instance-ids',container.ec2InstanceId])).Reservations?.[0]?.Instances?.[0];if(!instance)continue;
   if(!types.has(instance.InstanceType))types.set(instance.InstanceType,(await aws(['ec2','describe-instance-types','--instance-types',instance.InstanceType])).InstanceTypes[0]);
   const type=types.get(instance.InstanceType),gpu=type.GpuInfo.Gpus[0];
   Object.assign(compute,{instanceType:instance.InstanceType,vCpu:type.VCpuInfo.DefaultVCpus,memoryGB:type.MemoryInfo.SizeInMiB/1024,containerMemoryGB:resources.MEMORY/1024,gpu:gpu.Manufacturer+' '+gpu.Name,gpuCount:resources.GPU,gpuMemoryGB:gpu.MemoryInfo.SizeInMiB/1024});
  }
  analysis.compute=compute;await put(key,analysis);console.log(metadata.id+' '+name+' '+JSON.stringify(compute));
 }
}
