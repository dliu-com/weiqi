import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {attachBenchmarkRecords} from './benchmark-records.mjs';
import {updateBenchmarks} from './update-benchmarks.mjs';
const execute=promisify(execFile),region='eu-west-1';
const [filename,outdir='/private/tmp/weiqi-hybrid-validation',existingId]=process.argv.slice(2);
if(existingId&&!/^[0-9]{10,14}$/.test(existingId))throw Error('Invalid existing workflow record ID.');
if(!filename)throw Error('Provide a 19 × 19 SGF file.');
await mkdir(outdir,{recursive:true});
const aws=async args=>JSON.parse((await execute('aws',[...args,'--region',region,'--output','json'],{maxBuffer:12*1024*1024})).stdout);
const outputs=Object.fromEntries((await aws(['cloudformation','describe-stacks','--stack-name','WeiqiGpuBenchmark'])).Stacks[0].Outputs.map(o=>[o.OutputKey,o.OutputValue]));
const bucket='weiqisite-recordlibrary34c28f86-bfnqhy6739na',source=await readFile(filename,'utf8');
const get=async key=>JSON.parse((await execute('aws',['s3','cp','s3://'+bucket+'/'+key,'-','--region',region,'--only-show-errors'],{maxBuffer:8*1024*1024})).stdout);
const put=async(key,value)=>{const file=outdir+'/upload.json';await writeFile(file,JSON.stringify(value));await execute('aws',['s3','cp',file,'s3://'+bucket+'/'+key,'--region',region,'--content-type','application/json','--only-show-errors']);};
const placeholder={cpu:32,memoryGB:60,visits:8,status:'SUBMITTED'};
if(!existingId)await attachBenchmarkRecords({bucket,model:'latest official model',queueKind:'hybrid-workflow',results:[placeholder]},source);
const id=existingId||placeholder.recordId,key='games/'+id+'/metadata.json',metadata=await get(key);
metadata.name='Workflow benchmark · quick 32 CPUs / 60 GB / 8 visits · deep T4 GPU / 1,000 visits';
metadata.benchmark={workflow:'hybrid',quick:{cpu:32,memoryGB:60,visits:8},deep:{gpu:'NVIDIA T4',cpu:4,memoryGB:16,visits:1000}};
if(!existingId)metadata.analysis={status:'queued',enqueuedAt:new Date().toISOString()};await put(key,metadata);
if(!existingId)await aws(['sqs','send-message','--queue-url',outputs.ProductionUploadQueueUrl,'--message-body',JSON.stringify({id})]);
const report={id,recordUrl:'https://weiqi.dliu.com/record/'+id,enqueuedAt:metadata.analysis.enqueuedAt,phases:{},completed:false};
console.log('Started full-game hybrid workflow: '+report.recordUrl);
let previous='';
for(let n=0;n<720;n++){
 const current=await get(key),state=current.analysis;
 report.enqueuedAt=state.enqueuedAt;report.analysis=state;
 const status=['quick','deep'].map(p=>p+': '+(state[p]?.status||state.status)).join(' · ');
 const statusChanged=status!==previous;
 if(statusChanged){console.log(new Date().toISOString()+' '+status);previous=status;}
 const catalog=JSON.parse(await readFile('cloud/benchmark-catalog.json','utf8'));
 let changed=false;
 for(const phase of ['quick','deep']){
  const p=state[phase];if(!p?.jobId||p.jobId.startsWith('fallback:'))continue;
  if(!catalog.some(r=>r.id===p.jobId)){
   catalog.push({id:p.jobId,jobId:p.jobId,backend:phase==='quick'||p.fallback?'fargate-cpu':'gpu',...(phase==='deep'&&!p.fallback?{gpuType:'T4',instanceType:'g4dn.xlarge'}:{}),recordId:id,recordUrl:report.recordUrl,productionPrefix:'games/'+id,phase,visits:p.visits,enqueuedAt:state.enqueuedAt,status:'SUBMITTED',runId:state.enqueuedAt,triggerSeconds:0});changed=true;
  }
  if(p.status==='ready'&&!report.phases[phase]){
   const analysis=await get('games/'+id+(phase==='quick'?'/analysis-quick.json':'/analysis.json'));
   report.phases[phase]={jobId:p.jobId,visits:analysis.visits??p.visits,totalSeconds:analysis.endToEndMs/1000,engineSeconds:(analysis.benchmark?.engineMs??analysis.elapsedMs)/1000,compute:analysis.compute,completedAt:analysis.completedAt};
   await writeFile(outdir+'/'+phase+'-analysis.json',JSON.stringify(analysis,null,2));
   console.log(phase+' result: '+JSON.stringify(report.phases[phase]));
  }
 }
 if(changed)await writeFile('cloud/benchmark-catalog.json',JSON.stringify(catalog,null,2)+'\n');
 await writeFile(outdir+'/summary.json',JSON.stringify(report,null,2));
 if(changed||statusChanged||report.phases.quick&&report.phases.deep){await updateBenchmarks({publish:true});}
 if(['ready','failed'].includes(state.deep?.status)&&['ready','failed'].includes(state.quick?.status)){report.completed=true;await writeFile(outdir+'/summary.json',JSON.stringify(report,null,2));await updateBenchmarks({publish:true});console.log('Workflow validation complete. Workers stop automatically.');break;}
 await new Promise(resolve=>setTimeout(resolve,15000));
}
if(!report.completed)throw Error('Monitoring ended; production jobs were not interrupted.');
