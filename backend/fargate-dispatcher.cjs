const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,SubmitJobCommand}=require('@aws-sdk/client-batch');
const {createHash,randomUUID}=require('node:crypto');
const {SQSClient,SendMessageCommand}=require('@aws-sdk/client-sqs');
const fallbackQueue=new SQSClient({});
const storage=new S3Client({}),jobs=new BatchClient({}),bucket=process.env.LIBRARY_BUCKET;
async function phaseJobId(key,phase,jobId){for(let n=0;n<6;n++){const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key})),meta=JSON.parse(await obj.Body.transformToString());meta.analysis[phase].jobId=jobId;try{await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(meta),ContentType:'application/json',IfMatch:obj.ETag}));return;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}}}
async function scheduleFallback(id,phase,jobId){
 if(process.env.ANALYSIS_BACKEND!=='gpu'||!process.env.FALLBACK_QUEUE)return;
 const key='games/'+id+'/metadata.json';
 const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key})),meta=JSON.parse(await obj.Body.transformToString());
 if(meta.analysis[phase]?.fallbackCheckSentAt||['ready','failed'].includes(meta.analysis[phase]?.status))return;
 const elapsed=Math.max(0,(Date.now()-Date.parse(meta.analysis.enqueuedAt))/1000);
 await fallbackQueue.send(new SendMessageCommand({QueueUrl:process.env.FALLBACK_QUEUE,DelaySeconds:Math.ceil(Math.max(0,(phase==='quick'?60:600)-elapsed)),MessageBody:JSON.stringify({id,phase,jobId})}));
 for(let n=0;n<6;n++){
  const current=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key})),value=JSON.parse(await current.Body.transformToString());
  if(value.analysis[phase]?.jobId!==jobId||value.analysis[phase].fallbackCheckSentAt)return;
  value.analysis[phase].fallbackCheckSentAt=new Date().toISOString();
  try{await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(value),ContentType:'application/json',IfMatch:current.ETag}));return;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}
 }
}
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
  for(const phase of ['quick','deep'])if(metadata.analysis[phase]?.jobId)await scheduleFallback(id,phase,metadata.analysis[phase].jobId);
  if(['ready','failed','limited'].includes(metadata.analysis.status)||metadata.analysis.jobId||metadata.analysis.quick?.jobId&&metadata.analysis.deep?.jobId)continue;
  if(metadata.analysis.dispatchId&&Date.now()-Date.parse(metadata.analysis.dispatchedAt)<300000){batchItemFailures.push({itemIdentifier:message.messageId});continue;}
  const sgfObj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:'games/'+id+'/original.sgf'})),source=await sgfObj.Body.transformToString(),record=readSgf(source);
  const gpu=process.env.ANALYSIS_BACKEND==='gpu';
  const configs=gpu?{quick:{visits:64,cpu:4,memory:10000,estimatedSeconds:Math.ceil(10+record.mainLine.length*.25)},deep:{visits:1000,cpu:4,memory:10000,estimatedSeconds:Math.ceil(20+record.mainLine.length*3)}}:{quick:{visits:10,cpu:32,memory:61440,estimatedSeconds:Math.max(30,Math.ceil(15+record.mainLine.length*.70))},deep:{visits:128,cpu:32,memory:61440,estimatedSeconds:Math.max(60,Math.ceil(15+record.mainLine.length*7.5))}};
  const model=metadata.analysis.model||await resolveLatestModel();
  const sent=Number(message.attributes?.SentTimestamp);
  if(!metadata.analysis.queueMessageId&&Number.isFinite(sent)&&sent>0)metadata.analysis.enqueuedAt=new Date(sent).toISOString();
  metadata.analysis={...metadata.analysis,enqueuedAt:metadata.analysis.enqueuedAt||new Date(Number(message.attributes?.SentTimestamp)||Date.now()).toISOString(),model,status:'queued',dispatchId:randomUUID(),dispatchedAt:new Date().toISOString()};
  metadata.analysis.queueMessageId ||= message.messageId;
  for(const phase of ['quick','deep'])metadata.analysis[phase] ||= {status:'queued',visits:configs[phase].visits,estimatedSeconds:configs[phase].estimatedSeconds};
  await storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(metadata),ContentType:'application/json',IfMatch:obj.ETag}));
  for(const phase of ['quick','deep']){
   if(metadata.analysis[phase].jobId||['ready','failed'].includes(metadata.analysis[phase].status))continue;
   const c=configs[phase],requestKey='jobs/'+id+'/'+phase+'-request.json',request={id,phase,production:true,enqueuedAt:metadata.analysis.enqueuedAt,query:kataQuery(record,id+'-'+phase,c.visits),nodeIds:record.mainLine,sgfSha256:createHash('sha256').update(source).digest('hex'),requestedAt:new Date().toISOString(),outputPrefix:'games/'+id,estimatedSeconds:c.estimatedSeconds,compute:gpu?{backend:'gpu',vCpu:4,memoryGB:16,gpu:'NVIDIA T4',gpuCount:1,gpuMemoryGB:16,instanceType:'g4dn.xlarge'}:{backend:'fargate-cpu',vCpu:c.cpu,memoryGB:c.memory/1024}};
   await storage.send(new PutObjectCommand({Bucket:bucket,Key:requestKey,Body:JSON.stringify(request),ContentType:'application/json'}));
   const environment=[{name:'BENCHMARK_REQUEST_KEY',value:requestKey},{name:'ANALYSIS_THREADS',value:gpu?process.env.GPU_ANALYSIS_THREADS||'16':String(c.cpu)},{name:'NN_THREADS',value:gpu?'1':String(c.cpu)},{name:'NN_MAX_BATCH_SIZE',value:gpu?process.env.GPU_MAX_BATCH_SIZE||'32':'1'},{name:'ANALYSIS_TIMEOUT_SECONDS',value:'14300'}];
   if(!gpu)environment.push({name:'KATAGO_DOWNLOAD_URL',value:'https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-linux-x64.zip'},{name:'KATAGO_ZIP_SHA256',value:'33e79780dbe3bf6ee859e16f64952cdfc90f7210c8f71ad978ffcba85ad20d79'});
   environment.push({name:'KATAGO_MODEL_KEY',value:model.key},{name:'KATAGO_MODEL_URL',value:model.url});
   const job=await jobs.send(new SubmitJobCommand({jobName:'weiqi-'+id+'-'+phase,jobQueue:phase==='quick'?process.env.JOB_QUEUE:process.env.DEEP_QUEUE,jobDefinition:process.env.JOB_DEFINITION,containerOverrides:{resourceRequirements:[{type:'VCPU',value:String(c.cpu)},{type:'MEMORY',value:String(c.memory)},...(gpu?[{type:'GPU',value:'1'}]:[])],environment}}));
   await phaseJobId(key,phase,job.jobId);
   await scheduleFallback(id,phase,job.jobId);
  }
 }catch(e){console.error('Job dispatch failed',{name:e.name,message:e.message});if(recordKey&&Number(message.attributes?.ApproximateReceiveCount)>=3){try{await failUnsubmittedPhases(recordKey);continue;}catch(statusError){console.error('Unable to save dispatch failure',{name:statusError.name});}}batchItemFailures.push({itemIdentifier:message.messageId});}}
 return {batchItemFailures};
};
