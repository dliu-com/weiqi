const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,SubmitJobCommand,DescribeJobsCommand,ListJobsCommand,CancelJobCommand}=require('@aws-sdk/client-batch');
const {SQSClient,SendMessageCommand}=require('@aws-sdk/client-sqs');
const {randomUUID,createHash}=require('node:crypto');
const storage=new S3Client({}),jobs=new BatchClient({maxAttempts:1}),control=new SQSClient({}),bucket=process.env.LIBRARY_BUCKET;
const phases=['quick','deep'],clock=()=>new Date().toISOString();
async function read(id){const o=await storage.send(new GetObjectCommand({Bucket:bucket,Key:'games/'+id+'/metadata.json'}));return {meta:JSON.parse(await o.Body.transformToString()),etag:o.ETag};}
async function change(id,fn){for(let n=0;n<8;n++){const {meta,etag}=await read(id);if(fn(meta.analysis,meta)===false)return null;try{await storage.send(new PutObjectCommand({Bucket:bucket,Key:'games/'+id+'/metadata.json',Body:JSON.stringify(meta),ContentType:'application/json',IfMatch:etag}));return meta.analysis;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===7)throw e;}}}
async function send(body,seconds){await control.send(new SendMessageCommand({QueueUrl:process.env.CONTROL_QUEUE,DelaySeconds:Math.max(0,Math.min(900,Math.ceil(seconds))),MessageBody:JSON.stringify(body)}));}
async function ensureRetry(id){const {meta}=await read(id),s=meta.analysis;if(s.status!=='retry_wait'||s.retrySentAt)return;await send({id,kind:'retry',attempt:s.attempt},(Date.parse(s.retryAt)-Date.now())/1000);await change(id,a=>{if(a.status!=='retry_wait'||a.attempt!==s.attempt)return false;a.retrySentAt=clock();});}
async function failAnalysis(id,token,message){await change(id,s=>{if(s.token!==token||s.deep?.status==='ready'||['failed','limited'].includes(s.status))return false;if(s.status==='retry_wait')return false;s.error=message;s.failedAt=clock();s.retriesUsed=Math.max(0,(s.attempt||1)-1);if(s.retriesUsed<2){s.status='retry_wait';s.retryAt=new Date(Date.now()+[300,900][s.retriesUsed]*1000).toISOString();delete s.retrySentAt;for(const p of phases)if(s[p]?.status!=='ready')s[p]={...s[p],status:'retry_wait'};}else{s.status='failed';delete s.retryAt;for(const p of phases)if(s[p]?.status!=='ready')s[p]={...s[p],status:'failed'};}});await ensureRetry(id);}
const gpuInfo=backend=>backend==='fallback'?{backend:'gpu',vCpu:4,memoryGB:16,gpu:'T4 / A10G capacity pool',gpuCount:1,instanceType:'g4dn.xlarge / g5.xlarge',purchaseOption:'Spot'}:backend==='fallback-demand'?{backend:'gpu',vCpu:4,memoryGB:16,gpu:'NVIDIA A10G',gpuCount:1,gpuMemoryGB:24,instanceType:'g5.xlarge',purchaseOption:'On-Demand'}:{backend:'gpu',vCpu:4,memoryGB:16,gpu:'NVIDIA T4',gpuCount:1,gpuMemoryGB:16,instanceType:'g4dn.xlarge',purchaseOption:'On-Demand'};
async function watch(id,s){if(!s.watchSentAt){await send({id,kind:'watch',token:s.token,jobId:s.jobId},Number(process.env.GPU_FALLBACK_WAIT_SECONDS||180));await change(id,a=>{if(a.token!==s.token||a.jobId!==s.jobId)return false;a.watchSentAt=clock();});}}
async function submit(id,s,source,record){
 const queue=s.backend==='primary'?process.env.JOB_QUEUE:s.backend==='fallback-demand'?process.env.FALLBACK_GPU_QUEUE:process.env.FALLBACK_SPOT_QUEUE,jobName='weiqi-'+id+'-a'+s.attempt+'-'+s.token.slice(0,8);
 if(s.submitAt){const found=await jobs.send(new ListJobsCommand({jobQueue:queue,filters:[{name:'JOB_NAME',values:[jobName]}]}));const existing=found.jobSummaryList?.find(j=>j.jobName===jobName);if(existing){await change(id,a=>{if(a.token!==s.token)return false;a.jobId=existing.jobId;for(const p of phases)if(a[p]?.status!=='ready')a[p].jobId=existing.jobId;});return watch(id,{...s,jobId:existing.jobId});}throw Error('Submission confirmation pending');}
 const quick=Number(process.env.QUICK_VISITS||32),deep=1000,requestKey='jobs/'+id+'/'+s.token+'-request.json';
 const request={id,production:true,pipeline:true,token:s.token,attempt:s.attempt,enqueuedAt:s.enqueuedAt,query:kataQuery(record,id,quick),nodeIds:record.mainLine,sgfSha256:createHash('sha256').update(source).digest('hex'),requestedAt:clock(),outputPrefix:'games/'+id,compute:gpuInfo(s.backend),phases:{quick:{visits:quick,estimatedSeconds:Math.ceil(20+record.mainLine.length*.14)},deep:{visits:deep,estimatedSeconds:Math.ceil(20+record.mainLine.length*(s.backend==='fallback'?1.1:3))}}};
 await storage.send(new PutObjectCommand({Bucket:bucket,Key:requestKey,Body:JSON.stringify(request),ContentType:'application/json'}));
 const claimed=await change(id,a=>{if(a.token!==s.token||a.submitAt)return false;a.submitAt=clock();a.queue=queue;a.jobName=jobName;a.compute=request.compute;for(const p of phases)if(a[p]?.status!=='ready')a[p]={...a[p],...request.phases[p],compute:request.compute};});if(!claimed)return;
 let job;try{job=await jobs.send(new SubmitJobCommand({jobName,jobQueue:queue,jobDefinition:process.env.JOB_DEFINITION,containerOverrides:{environment:[{name:'BENCHMARK_REQUEST_KEY',value:requestKey},{name:'KATAGO_MODEL_KEY',value:s.model.key},{name:'KATAGO_MODEL_URL',value:s.model.url}]}}));}catch(e){if(['ClientException','AccessDeniedException','ValidationException'].includes(e.name)){await failAnalysis(id,s.token,'The GPU analysis could not start. Your game record is safe.');return;}throw e;}
 await change(id,a=>{if(a.token!==s.token)return false;a.jobId=job.jobId;for(const p of phases)if(a[p]?.status!=='ready')a[p].jobId=job.jobId;});await watch(id,{...claimed,jobId:job.jobId});
}
async function dispatch(id,retryAttempt=null){
 let {meta}=await read(id),s=meta.analysis;if(['ready','failed','limited'].includes(s.status)||s.deep?.status==='ready')return;
 if(s.status==='retry_wait'){if(retryAttempt!==s.attempt){await ensureRetry(id);return;}if(Date.now()<Date.parse(s.retryAt)){await send({id,kind:'retry',attempt:s.attempt},(Date.parse(s.retryAt)-Date.now())/1000);return;}const old=s.attempt;await change(id,a=>{if(a.status!=='retry_wait'||a.attempt!==old)return false;a.attempt=old+1;a.token=randomUUID();a.backend=a.backend==='primary'?'fallback':'primary';a.status='queued';delete a.jobId;delete a.submitAt;delete a.watchSentAt;delete a.retryAt;delete a.retrySentAt;for(const p of phases)if(a[p]?.status!=='ready')a[p]={...a[p],status:'queued',startedAt:null,jobId:null};});s=(await read(id)).meta.analysis;
 }else if(!s.token){await change(id,(a,m)=>{if(a.token)return false;a.attempt=1;a.token=randomUUID();a.backend='primary';a.enqueuedAt ||= clock();a.status='queued';a.quick={status:'queued',visits:Number(process.env.QUICK_VISITS||32),estimatedSeconds:Math.ceil(20+m.moves*.14)};a.deep={status:'queued',visits:1000,estimatedSeconds:Math.ceil(20+m.moves*3)};});s=(await read(id)).meta.analysis;}
 if(s.jobId)return watch(id,s);
 try{if(!s.model){const model=await resolveLatestModel();await change(id,a=>{if(a.token!==s.token)return false;a.model=model;});s=(await read(id)).meta.analysis;}const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:'games/'+id+'/original.sgf'})),source=await obj.Body.transformToString();await submit(id,s,source,readSgf(source));}catch(e){console.error('GPU dispatch',{id,name:e.name,message:e.message});if(!s.submitAt&&(await read(id)).meta.analysis.submitAt)throw e;if(s.submitAt)throw e;await failAnalysis(id,s.token,'The analysis service is temporarily unavailable. Your game record is safe.');}
}
async function check(id,token,jobId){
 let s=(await read(id)).meta.analysis;if(s.token!==token||s.jobId!==jobId||s.deep?.status==='ready'||['failed','retry_wait'].includes(s.status))return;
 const job=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];if(!job){await send({id,kind:'watch',token,jobId},60);return;}
 if(job.status==='FAILED'){await failAnalysis(id,token,'The GPU analysis failed. Your game record is safe.');return;}
 if(job.status==='SUCCEEDED')return;
 if(job.status==='RUNNING'||s.quick?.status==='running'||s.deep?.status==='running')return;
 if(job.status==='STARTING'){await send({id,kind:'watch',token,jobId},60);return;}
 if(s.backend==='fallback-demand'){
  if(Date.now()-Date.parse(s.submitAt)<900000){await send({id,kind:'watch',token,jobId},60);return;}
  await change(id,a=>{if(a.token!==token)return false;a.capacityCancelJobId=jobId;});
  await jobs.send(new CancelJobCommand({jobId,reason:'GPU capacity still unavailable; schedule a later attempt'}));
  const stopped=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];
  if(stopped?.status==='FAILED')await failAnalysis(id,token,'GPU capacity is temporarily unavailable. Your game record is safe.');else await send({id,kind:'watch',token,jobId},15);return;
 }
 // The replacement is submitted only after cancellation is confirmed. A worker
 // that starts during this race stays in place; no second paid job is launched.
 await change(id,a=>{if(a.token!==token)return false;a.capacityCancelJobId=jobId;});
 await jobs.send(new CancelJobCommand({jobId,reason:'Try the alternative GPU capacity pool'}));
 const confirm=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];if(confirm?.status!=='FAILED'){await send({id,kind:'watch',token,jobId},15);return;}
 const next=await change(id,a=>{if(a.token!==token||a.jobId!==jobId||a.status==='running')return false;a.token=randomUUID();a.backend=a.backend==='primary'?'fallback':'fallback-demand';a.capacityFallback=true;a.status='queued';delete a.jobId;delete a.submitAt;delete a.watchSentAt;for(const p of phases)if(a[p]?.status!=='ready')a[p]={...a[p],status:'queued',jobId:null};});if(next)await dispatch(id);
}
exports.handler=async event=>{
 if(event.detail?.status==='FAILED'){const job=event.detail;const match=/^weiqi-(\d{10,14})-a\d+-[a-f0-9]{8}$/.exec(job.jobName||'');if(!match)return;const id=match[1],s=(await read(id)).meta.analysis;if(s.jobId!==job.jobId)return; // capacity cancellation is handled by the watcher, not a failed attempt
 if(s.capacityCancelJobId===job.jobId)return;
 await failAnalysis(id,s.token,'The GPU analysis failed. Your game record is safe.');return;}
 const batchItemFailures=[];for(const m of event.Records||[]){try{const b=JSON.parse(m.body);if(!validRecordId(b.id))throw Error('Invalid game ID');if(b.kind==='watch')await check(b.id,b.token,b.jobId);else await dispatch(b.id,b.kind==='retry'?b.attempt:null);}catch(e){console.error('GPU coordination failed',{name:e.name,message:e.message});if(Number(m.attributes?.ApproximateReceiveCount)>=3){const b=JSON.parse(m.body),s=(await read(b.id)).meta.analysis;if(s.token&&s.status!=='running'){await failAnalysis(b.id,s.token,'The analysis service is temporarily unavailable. Your game record is safe.');continue;}}batchItemFailures.push({itemIdentifier:m.messageId});}}return {batchItemFailures};
};
