const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,SubmitJobCommand}=require('@aws-sdk/client-batch');
const {createHash,randomUUID}=require('node:crypto');
const storage=new S3Client({}),jobs=new BatchClient({}),bucket=process.env.LIBRARY_BUCKET;
async function phaseJobId(key,phase,jobId){for(let n=0;n<6;n++){const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key})),meta=JSON.parse(await obj.Body.transformToString());meta.analysis[phase].jobId=jobId;try{await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(meta),ContentType:'application/json',IfMatch:obj.ETag}));return;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}}}
async function failUnsubmittedPhases(key){
 for(let n=0;n<6;n++){
  const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key})),meta=JSON.parse(await obj.Body.transformToString()),state=meta.analysis;
  if(['ready','failed','limited'].includes(state.status))return;
  for(const phase of ['quick','deep'])if(!state[phase]?.jobId&&!['ready','running'].includes(state[phase]?.status))state[phase]={...state[phase],status:'failed',message:'Unable to start analysis. Your game record is preserved.'};
  const active=['quick','deep'].some(p=>['queued','running'].includes(state[p]?.status));
  state.status=active?'running':state.available?'ready':'failed';
  try{await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(meta),ContentType:'application/json',IfMatch:obj.ETag}));return;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}
 }
}
exports.handler=async event=>{
 const batchItemFailures=[];
 for(const message of event.Records){let recordKey;try{
  const {id}=JSON.parse(message.body);if(!validRecordId(id))throw Error('Invalid game ID');
  const key='games/'+id+'/metadata.json';recordKey=key;const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key})),metadata=JSON.parse(await obj.Body.transformToString());
  if(['ready','failed','limited'].includes(metadata.analysis.status)||metadata.analysis.jobId||metadata.analysis.quick?.jobId&&metadata.analysis.deep?.jobId)continue;
  if(metadata.analysis.dispatchId&&Date.now()-Date.parse(metadata.analysis.dispatchedAt)<300000){batchItemFailures.push({itemIdentifier:message.messageId});continue;}
  const sgfObj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:'games/'+id+'/original.sgf'})),source=await sgfObj.Body.transformToString(),record=readSgf(source);
  const configs={quick:{visits:10,cpu:32,memory:61440,estimatedSeconds:Math.max(30,Math.ceil(15+record.mainLine.length*.70))},deep:{visits:128,cpu:32,memory:61440,estimatedSeconds:Math.max(60,Math.ceil(15+record.mainLine.length*7.5))}};
  const model=metadata.analysis.model||await resolveLatestModel();
  metadata.analysis={...metadata.analysis,model,status:'queued',dispatchId:randomUUID(),dispatchedAt:new Date().toISOString()};
  for(const phase of ['quick','deep'])metadata.analysis[phase] ||= {status:'queued',visits:configs[phase].visits,estimatedSeconds:configs[phase].estimatedSeconds};
  await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(metadata),ContentType:'application/json',IfMatch:obj.ETag}));
  for(const phase of ['quick','deep']){
   if(metadata.analysis[phase].jobId||['ready','failed'].includes(metadata.analysis[phase].status))continue;
   const c=configs[phase],requestKey='jobs/'+id+'/'+phase+'-request.json',request={id,phase,production:true,query:kataQuery(record,id+'-'+phase,c.visits),nodeIds:record.mainLine,sgfSha256:createHash('sha256').update(source).digest('hex'),requestedAt:new Date().toISOString(),outputPrefix:'games/'+id,estimatedSeconds:c.estimatedSeconds,compute:{backend:'fargate-cpu',vCpu:c.cpu,memoryGB:c.memory/1024}};
   await storage.send(new PutObjectCommand({Bucket:bucket,Key:requestKey,Body:JSON.stringify(request),ContentType:'application/json'}));
   const environment=[{name:'BENCHMARK_REQUEST_KEY',value:requestKey},{name:'ANALYSIS_THREADS',value:String(c.cpu)},{name:'NN_THREADS',value:String(c.cpu)},{name:'ANALYSIS_TIMEOUT_SECONDS',value:'14300'}];
   environment.push({name:'KATAGO_DOWNLOAD_URL',value:'https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip'},{name:'KATAGO_ZIP_SHA256',value:'33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79'},{name:'KATAGO_MODEL_KEY',value:model.key},{name:'KATAGO_MODEL_URL',value:model.url});
   const job=await jobs.send(new SubmitJobCommand({jobName:'weiqi-'+id+'-'+phase,jobQueue:phase==='quick'?process.env.JOB_QUEUE:process.env.DEEP_QUEUE,jobDefinition:process.env.JOB_DEFINITION,containerOverrides:{resourceRequirements:[{type:'VCPU',value:String(c.cpu)},{type:'MEMORY',value:String(c.memory)}],environment}}));
   await phaseJobId(key,phase,job.jobId);
  }
 }catch(e){console.error('Job dispatch failed',{name:e.name,message:e.message});if(recordKey&&Number(message.attributes?.ApproximateReceiveCount)>=3){try{await failUnsubmittedPhases(recordKey);continue;}catch(statusError){console.error('Unable to save dispatch failure',{name:statusError.name});}}batchItemFailures.push({itemIdentifier:message.messageId});}}
 return {batchItemFailures};
};
