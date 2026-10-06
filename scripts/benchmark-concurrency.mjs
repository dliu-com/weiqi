import {gamePrefix} from '../backend/library-service.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {attachBenchmarkRecords} from './benchmark-records.mjs';
import {updateBenchmarks} from './update-benchmarks.mjs';

// Exercise the real SQS dispatcher; all resources belong to Ireland CloudFormation stacks.
const execute=promisify(execFile),region='eu-west-1';
const [filename,outdir='/private/tmp/weiqi-concurrency-validation']=process.argv.slice(2);
if(!filename)throw Error('Provide a 19 × 19 SGF file.');
await mkdir(outdir,{recursive:true});
const aws=async args=>JSON.parse((await execute('aws',[...args,'--region',region,'--output','json'],{maxBuffer:12*1024*1024})).stdout);
const outputs=Object.fromEntries((await aws(['cloudformation','describe-stacks','--stack-name','WeiqiGpuBenchmark'])).Stacks[0].Outputs.map(o=>[o.OutputKey,o.OutputValue]));
const bucket=(await readFile('cloud/deployment-config.json','utf8').then(JSON.parse)).libraryBucket;
const ledger=JSON.parse(await readFile('cloud/development-cost-ledger.json','utf8'));
if(ledger.conservativeTotalEstimateUSD>25)throw Error('Insufficient headroom within the total $30 development budget.');
const existing=await aws(['ec2','describe-instances','--filters','Name=tag:service,Values=weiqi-gpu-benchmark','Name=instance-state-name,Values=pending,running']);
if(existing.Reservations.some(r=>r.Instances.length))throw Error('Cold benchmark requires all previous GPU workers to have retired.');
const source=await readFile(filename,'utf8');
const results=[1,2].map(sequence=>({sequence,cpu:32,memoryGB:60,visits:8,status:'SUBMITTED'}));
await attachBenchmarkRecords({bucket,model:'latest official model',queueKind:'concurrent-workflow',results},source);
const get=async key=>JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region',region,'--only-show-errors'],{maxBuffer:8*1024*1024})).stdout);
const report={scenario:'Two simultaneous cold full-game workflows',region,startedAt:new Date().toISOString(),records:[],completed:false};
for(const result of results){
 const key=gamePrefix(result.recordId)+'/metadata.json',file=outdir+'/'+result.recordId+'-metadata.json';
 const original=await aws(['s3api','get-object','--bucket',bucket,'--key',key,file]);
 const metadata=JSON.parse(await readFile(file,'utf8'));
 metadata.name=`Concurrency benchmark ${result.sequence}/2 · quick 32 CPUs / 60 GB / 8 visits · deep T4 / 1,000 visits`;
 metadata.benchmark={workflow:'hybrid',scenario:'two-concurrent-cold',sequence:result.sequence,quick:{cpu:32,memoryGB:60,visits:8},deep:{gpu:'NVIDIA T4',cpu:4,memoryGB:16,visits:1000}};
 metadata.analysis={status:'queued',enqueuedAt:new Date().toISOString()};
 await writeFile(file,JSON.stringify(metadata));
 await aws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',file,'--content-type','application/json','--if-match',original.ETag]);
 report.records.push({id:result.recordId,recordUrl:result.recordUrl,phases:{}});
}
// Finish preparation first, then send both uploads together without waiting for either worker.
for(const record of report.records){await aws(['sqs','send-message','--queue-url',outputs.ProductionUploadQueueUrl,'--message-body',JSON.stringify({id:record.id})]);console.log('Submitted '+record.recordUrl);}
const save=()=>writeFile(outdir+'/summary.json',JSON.stringify(report,null,2));
const previous=new Map();
try{
 for(let attempt=0;attempt<240;attempt++){
  const catalog=JSON.parse(await readFile('cloud/benchmark-catalog.json','utf8'));
  let changed=false;
  for(const record of report.records){
   const metadata=await get(gamePrefix(record.id)+'/metadata.json'),state=metadata.analysis;
   record.enqueuedAt=state.enqueuedAt;record.analysis=state;
   const status=['quick','deep'].map(phase=>phase+': '+(state[phase]?.status||state.status)).join(' · ');
   if(previous.get(record.id)!==status){console.log(new Date().toISOString()+' '+record.id+' '+status);previous.set(record.id,status);changed=true;}
   for(const phase of ['quick','deep']){
    const stage=state[phase];
    if(!stage?.jobId||stage.jobId.startsWith('fallback:'))continue;
    if(!catalog.some(r=>r.id===stage.jobId)){
     const gpu=phase==='deep'&&!stage.fallback;
     catalog.push({id:stage.jobId,jobId:stage.jobId,backend:gpu?'gpu':'fargate-cpu',...(gpu?{gpuType:'T4',instanceType:'g4dn.xlarge'}:{}),recordId:record.id,recordUrl:record.recordUrl,productionPrefix:gamePrefix(record.id),phase,visits:stage.visits,enqueuedAt:state.enqueuedAt,status:'SUBMITTED',runId:state.enqueuedAt,scenario:report.scenario,triggerSeconds:0});changed=true;
    }
    if(stage.status==='ready'&&!record.phases[phase]){
     const analysis=await get(gamePrefix(record.id)+(phase==='quick'?'/analysis-quick.json':'/analysis.json'));
     record.phases[phase]={jobId:stage.jobId,visits:analysis.visits,totalSeconds:analysis.endToEndMs/1000,engineSeconds:analysis.benchmark.engineMs/1000,compute:analysis.compute,model:analysis.model,modelSha256:analysis.modelSha256,completedAt:analysis.completedAt};
     await writeFile(outdir+'/'+record.id+'-'+phase+'.json',JSON.stringify(analysis,null,2));
     console.log(record.id+' '+phase+' result: '+JSON.stringify(record.phases[phase]));changed=true;
    }
   }
  }
  if(changed){await writeFile('cloud/benchmark-catalog.json',JSON.stringify(catalog,null,2)+'\n');await updateBenchmarks({publish:true});}
  await save();
  if(report.records.every(r=>['ready','failed'].includes(r.analysis.quick?.status)&&['ready','failed'].includes(r.analysis.deep?.status))){report.completed=true;report.success=report.records.every(r=>r.analysis.quick.status==='ready'&&r.analysis.deep.status==='ready');report.completedAt=new Date().toISOString();await save();await updateBenchmarks({publish:true});console.log(report.success?'Both full-game workflows completed; workers retire automatically.':'Benchmark monitoring finished with failed phases; failed runs are excluded from the public results.');break;}
  await new Promise(resolve=>setTimeout(resolve,30000));
 }
 if(!report.completed)throw Error('Concurrency development benchmark exceeded its monitoring allowance.');
}catch(error){
 // Cancel only this test's jobs. Batch owns retirement; never provision or terminate EC2 manually.
 for(const record of report.records){const state=await get(gamePrefix(record.id)+'/metadata.json');for(const phase of ['quick','deep']){const stage=state.analysis[phase];if(stage?.jobId&&!stage.jobId.startsWith('fallback:')&&['queued','running'].includes(stage.status))await aws(['batch','terminate-job','--job-id',stage.jobId,'--reason','Concurrency development benchmark stopped']);}}
 report.error=error.message;await save();throw error;
}
