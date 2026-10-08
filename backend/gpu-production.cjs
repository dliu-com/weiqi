const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,SubmitJobCommand,DescribeJobsCommand,ListJobsCommand,CancelJobCommand}=require('@aws-sdk/client-batch');
const {SQSClient,SendMessageCommand}=require('@aws-sdk/client-sqs');
const {randomUUID,createHash}=require('node:crypto');
const storage=new S3Client({}),jobs=new BatchClient({maxAttempts:1}),control=new SQSClient({}),bucket=process.env.LIBRARY_BUCKET;
const phases=['quick','deep'],clock=()=>new Date().toISOString();
// A deep phase marked 'limited' (daily deep cap reached) is never queued, paused, failed or retried.
const open=p=>!['ready','limited'].includes(p?.status);
async function aiPaused(){if(!process.env.AI_CONTROL_KEY)return false;try{const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:process.env.AI_CONTROL_KEY}));return JSON.parse(await obj.Body.transformToString()).paused===true;}catch(e){if(e.name==='NoSuchKey')return false;throw e;}}
async function pauseAnalysis(id){return change(id,s=>{if(s.deep?.status==='ready'||['ready','limited','paused'].includes(s.status))return false;s.status='paused';s.reason='monthly_budget';delete s.retryAt;delete s.retrySentAt;for(const p of phases)if(s[p]&&open(s[p]))s[p]={...s[p],status:'paused'};});}
async function read(id){const o=await storage.send(new GetObjectCommand({Bucket:bucket,Key:gamePrefix(id)+'/metadata.json'}));return {meta:JSON.parse(await o.Body.transformToString()),etag:o.ETag};}
async function change(id,fn){for(let n=0;n<8;n++){const {meta,etag}=await read(id);if(fn(meta.analysis,meta)===false)return null;try{await storage.send(new PutObjectCommand({Bucket:bucket,Key:gamePrefix(id)+'/metadata.json',Body:JSON.stringify(meta),ContentType:'application/json',IfMatch:etag}));return meta.analysis;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===7)throw e;}}}
async function send(body,seconds){await control.send(new SendMessageCommand({QueueUrl:process.env.CONTROL_QUEUE,DelaySeconds:Math.max(0,Math.min(900,Math.ceil(seconds))),MessageBody:JSON.stringify(body)}));}
async function ensureRetry(id){const {meta}=await read(id),s=meta.analysis;if(s.status!=='retry_wait'||s.retrySentAt)return;await send({id,kind:'retry',attempt:s.attempt},(Date.parse(s.retryAt)-Date.now())/1000);await change(id,a=>{if(a.status!=='retry_wait'||a.attempt!==s.attempt)return false;a.retrySentAt=clock();});}
async function failAnalysis(id,token,message){await change(id,s=>{if(s.token!==token||s.deep?.status==='ready'||['failed','limited','paused'].includes(s.status))return false;if(s.status==='retry_wait')return false;s.error=message;s.failedAt=clock();s.retriesUsed=Math.max(0,(s.attempt||1)-1);if(s.retriesUsed<2){s.status='retry_wait';s.retryAt=new Date(Date.now()+[300,900][s.retriesUsed]*1000).toISOString();delete s.retrySentAt;for(const p of phases)if(open(s[p]))s[p]={...s[p],status:'retry_wait'};}else{s.status='failed';delete s.retryAt;for(const p of phases)if(open(s[p]))s[p]={...s[p],status:'failed'};}});await ensureRetry(id);}
// The same visits per position on every GPU; long games are capped at 322 positions' worth so a T4 job stays under one hour.
const baseDeepVisits=()=>Number(process.env.DEEP_VISITS||3000);
const deepVisitsFor=(moves,backend)=>Math.max(100,Math.min(baseDeepVisits(backend),Math.floor(baseDeepVisits(backend)*322/Math.max(1,moves+1))));
// On-Demand only; Spot is never used. Quick analysis starts at once on its own
// T4 worker. Deep tries A10G first (about 3x faster than T4 and cheaper per
// game), then T4. Whichever worker starts first claims the quick pass.
// A quick-only game (deep 'limited') sends one quick job to T4 and no separate quick job.
const gpuInfo=backend=>backend==='primary'?{backend:'gpu',vCpu:4,memoryGB:16,gpu:'NVIDIA A10G',gpuCount:1,gpuMemoryGB:24,instanceType:'g5.xlarge',purchaseOption:'On-Demand'}:{backend:'gpu',vCpu:4,memoryGB:16,gpu:'NVIDIA T4',gpuCount:1,gpuMemoryGB:16,instanceType:'g4dn.xlarge',purchaseOption:'On-Demand'};
// Measured engine time per 1,000 visits per position: A10G about 0.8 s, T4 about 2.6 s.
const deepEstimate=(positions,visits,backend)=>Math.ceil(20+positions*(backend==='primary'?1:3)*visits/1000);
const quickEstimate=positions=>Math.ceil(20+positions*.14);
const queuedPhase=p=>!['ready','running','limited'].includes(p?.status);
// A phase is running for a job only when that job's worker claimed it.
const runningFor=(a,token)=>phases.some(p=>a[p]?.status==='running'&&a[p].owner===token);
async function watchQuick(id,q){if(q.watchSentAt)return;await send({id,kind:'quick-watch',token:q.token,jobName:q.jobName,...(q.jobId?{jobId:q.jobId}:{})},60);await change(id,a=>{if(a.quickJob?.token!==q.token)return false;a.quickJob.watchSentAt=clock();});}
// Best effort: if the quick worker cannot start, the deep worker runs quick first.
async function submitQuick(id,attempt,source,record){
 try{
  let a=(await read(id)).meta.analysis;
  if(a.attempt!==attempt||!queuedPhase(a.quick)||await aiPaused())return;
  if(a.quickJob?.attempt!==attempt){a=await change(id,x=>{if(x.attempt!==attempt||x.quickJob?.attempt===attempt)return false;x.quickJob={attempt,token:randomUUID()};});if(!a)return;}
  const q=a.quickJob,queue=process.env.FALLBACK_GPU_QUEUE,jobName='weiqi-'+id+'-q'+attempt+'-'+q.token.slice(0,8);
  if(q.jobId)return watchQuick(id,q);
  if(q.submitAt){const found=await jobs.send(new ListJobsCommand({jobQueue:queue,filters:[{name:'JOB_NAME',values:[jobName]}]}));const existing=found.jobSummaryList?.find(j=>j.jobName===jobName);if(existing){await change(id,x=>{if(x.quickJob?.token!==q.token)return false;x.quickJob.jobId=existing.jobId;});await watchQuick(id,{...q,jobId:existing.jobId});}return;}
  const visits=Number(process.env.QUICK_VISITS||32),requestKey='jobs/'+id+'/'+q.token+'-request.json';
  const request={id,production:true,pipeline:true,role:'quick',token:q.token,attempt,enqueuedAt:a.enqueuedAt,query:kataQuery(record,id,visits),nodeIds:record.mainLine,sgfSha256:createHash('sha256').update(source).digest('hex'),requestedAt:clock(),outputPrefix:gamePrefix(id),compute:gpuInfo('fallback-demand'),phases:{quick:{visits,estimatedSeconds:quickEstimate(record.mainLine.length)}}};
  await storage.send(new PutObjectCommand({Bucket:bucket,Key:requestKey,Body:JSON.stringify(request),ContentType:'application/json'}));
  if(!await change(id,x=>{if(x.quickJob?.token!==q.token||x.quickJob.submitAt)return false;x.quickJob={...x.quickJob,submitAt:clock(),queue,jobName};}))return;
  // The watch goes out before SubmitJob: if a later step fails, it still finds the job by name.
  await watchQuick(id,{...q,jobName});
  let job;try{job=await jobs.send(new SubmitJobCommand({jobName,jobQueue:queue,jobDefinition:process.env.JOB_DEFINITION,containerOverrides:{environment:[{name:'BENCHMARK_REQUEST_KEY',value:requestKey},{name:'KATAGO_MODEL_KEY',value:a.model.key},{name:'KATAGO_MODEL_URL',value:a.model.url}]}}));}catch(e){const found=await jobs.send(new ListJobsCommand({jobQueue:queue,filters:[{name:'JOB_NAME',values:[jobName]}]}));job=found.jobSummaryList?.find(j=>j.jobName===jobName);if(!job)throw e;}
  await change(id,x=>{if(x.quickJob?.token!==q.token)return false;x.quickJob.jobId=job.jobId;});
 }catch(e){console.error('Quick GPU dispatch',{id,name:e.name,message:e.message});}
}
// A queued quick job is cancelled once it is no longer useful, or after 15 minutes.
async function checkQuick(id,token,jobId,jobName){
 const s=(await read(id)).meta.analysis,mine=s.quickJob?.token===token,young=mine&&Date.now()-Date.parse(s.quickJob.submitAt)<900000;
 if(!jobId&&mine)jobId=s.quickJob.jobId;
 if(!jobId&&jobName){const found=await jobs.send(new ListJobsCommand({jobQueue:process.env.FALLBACK_GPU_QUEUE,filters:[{name:'JOB_NAME',values:[jobName]}]}));jobId=found.jobSummaryList?.find(j=>j.jobName===jobName)?.jobId;if(jobId&&mine)await change(id,a=>{if(a.quickJob?.token!==token||a.quickJob.jobId)return false;a.quickJob.jobId=jobId;});}
 if(!jobId){if(young)await send({id,kind:'quick-watch',token,jobName},60);return;}
 const current=mine&&(!s.quickJob.jobId||s.quickJob.jobId===jobId);
 const job=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];if(!job){if(current)await send({id,kind:'quick-watch',token,jobName,jobId},60);return;}
 if(!['SUBMITTED','PENDING','RUNNABLE'].includes(job.status))return;
 const unneeded=!current||s.quick?.status==='ready'||s.quick?.status==='running'&&s.quick.owner!==token||s.deep?.status==='ready'||['ready','failed','limited','paused','retry_wait'].includes(s.status);
 if(unneeded||Date.now()-Date.parse(s.quickJob.submitAt)>=900000){await jobs.send(new CancelJobCommand({jobId,reason:'Quick analysis is no longer needed on this GPU'}));return;}
 await send({id,kind:'quick-watch',token,jobName,jobId},60);
}
// A failed quick worker releases its claim so the deep worker can still run quick.
async function quickFailed(id,jobId){await change(id,a=>{if(!a.quickJob||a.quickJob.jobId!==jobId||a.quick?.status!=='running'||a.quick.owner!==a.quickJob.token)return false;a.quick={...a.quick,status:'queued',startedAt:null,owner:null};if(a.status==='running'&&!phases.some(p=>a[p]?.status==='running'))a.status='queued';});}
async function watch(id,s){if(!s.watchSentAt){await send({id,kind:'watch',token:s.token,jobId:s.jobId},Number(process.env.GPU_FALLBACK_WAIT_SECONDS||180));await change(id,a=>{if(a.token!==s.token||a.jobId!==s.jobId)return false;a.watchSentAt=clock();});}}
async function submit(id,s,source,record){
 if(await aiPaused()){await pauseAnalysis(id);return;}
 const queue=s.backend==='primary'?process.env.JOB_QUEUE:process.env.FALLBACK_GPU_QUEUE,jobName='weiqi-'+id+'-a'+s.attempt+'-'+s.token.slice(0,8);
 if(s.submitAt){const found=await jobs.send(new ListJobsCommand({jobQueue:queue,filters:[{name:'JOB_NAME',values:[jobName]}]}));const existing=found.jobSummaryList?.find(j=>j.jobName===jobName);if(existing){await change(id,a=>{if(a.token!==s.token)return false;a.jobId=existing.jobId;for(const p of phases)if(queuedPhase(a[p]))a[p].jobId=existing.jobId;});return watch(id,{...s,jobId:existing.jobId});}throw Error('Submission confirmation pending');}
 const quick=Number(process.env.QUICK_VISITS||32),deep=deepVisitsFor(record.mainLine.length-1,s.backend),requestKey='jobs/'+id+'/'+s.token+'-request.json';
 const request={id,production:true,pipeline:true,token:s.token,attempt:s.attempt,enqueuedAt:s.enqueuedAt,query:kataQuery(record,id,quick),nodeIds:record.mainLine,sgfSha256:createHash('sha256').update(source).digest('hex'),requestedAt:clock(),outputPrefix:gamePrefix(id),compute:gpuInfo(s.backend),phases:{quick:{visits:quick,estimatedSeconds:quickEstimate(record.mainLine.length)},...(s.deep?.status==='limited'?{}:{deep:{visits:deep,estimatedSeconds:deepEstimate(record.mainLine.length,deep,s.backend)}})}};
 await storage.send(new PutObjectCommand({Bucket:bucket,Key:requestKey,Body:JSON.stringify(request),ContentType:'application/json'}));
 const claimed=await change(id,a=>{if(a.token!==s.token||a.submitAt)return false;a.submitAt=clock();a.queue=queue;a.jobName=jobName;a.compute=request.compute;for(const p of phases)if(queuedPhase(a[p]))a[p]={...a[p],...request.phases[p],compute:request.compute};});if(!claimed)return;
 if(await aiPaused()){await pauseAnalysis(id);return;}
 let job;try{job=await jobs.send(new SubmitJobCommand({jobName,jobQueue:queue,jobDefinition:process.env.JOB_DEFINITION,containerOverrides:{environment:[{name:'BENCHMARK_REQUEST_KEY',value:requestKey},{name:'KATAGO_MODEL_KEY',value:s.model.key},{name:'KATAGO_MODEL_URL',value:s.model.url}]}}));}catch(e){if(['ClientException','AccessDeniedException','ValidationException'].includes(e.name)){await failAnalysis(id,s.token,'The GPU analysis could not start. Your game record is safe.');return;}throw e;}
 await change(id,a=>{if(a.token!==s.token)return false;a.jobId=job.jobId;for(const p of phases)if(queuedPhase(a[p]))a[p].jobId=job.jobId;});await watch(id,{...claimed,jobId:job.jobId});
}
async function dispatch(id,retryAttempt=null){
 let {meta}=await read(id),s=meta.analysis;if(['ready','failed','limited','paused'].includes(s.status)||s.deep?.status==='ready')return;
 if(s.status==='retry_wait'){if(retryAttempt!==s.attempt){await ensureRetry(id);return;}if(Date.now()<Date.parse(s.retryAt)){await send({id,kind:'retry',attempt:s.attempt},(Date.parse(s.retryAt)-Date.now())/1000);return;}const old=s.attempt;await change(id,a=>{if(a.status!=='retry_wait'||a.attempt!==old)return false;a.attempt=old+1;a.token=randomUUID();a.backend=a.deep?.status==='limited'||a.backend==='primary'?'fallback-demand':'primary';a.status='queued';delete a.jobId;delete a.submitAt;delete a.watchSentAt;delete a.retryAt;delete a.retrySentAt;for(const p of phases)if(open(a[p]))a[p]={...a[p],status:'queued',startedAt:null,jobId:null,owner:null};});s=(await read(id)).meta.analysis;
 }else if(!s.token){await change(id,(a,m)=>{if(a.token)return false;const quickOnly=a.deep?.status==='limited';a.attempt=1;a.token=randomUUID();a.backend=quickOnly?'fallback-demand':'primary';a.enqueuedAt ||= clock();a.status='queued';a.quick={status:'queued',visits:Number(process.env.QUICK_VISITS||32),estimatedSeconds:quickEstimate(m.moves+1)};if(!quickOnly)a.deep={status:'queued',visits:deepVisitsFor(m.moves,'primary'),estimatedSeconds:deepEstimate(m.moves+1,deepVisitsFor(m.moves,'primary'),'primary')};});s=(await read(id)).meta.analysis;}
 if(s.jobId&&((s.quickJob?.attempt===s.attempt&&s.quickJob?.jobId)||!queuedPhase(s.quick)))return watch(id,s);
 try{if(!s.model){const model=await resolveAnalysisModel();await change(id,a=>{if(a.token!==s.token)return false;a.model=model;});s=(await read(id)).meta.analysis;}const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:gamePrefix(id)+'/original.sgf'})),source=await obj.Body.transformToString(),record=readSgf(source);
  if(s.deep?.status!=='limited'){await submitQuick(id,s.attempt,source,record);s=(await read(id)).meta.analysis;}if(s.jobId)return watch(id,s);await submit(id,s,source,record);}catch(e){console.error('GPU dispatch',{id,name:e.name,message:e.message});if(!s.submitAt&&(await read(id)).meta.analysis.submitAt)throw e;if(s.submitAt)throw e;await failAnalysis(id,s.token,'The analysis service is temporarily unavailable. Your game record is safe.');}
}
async function check(id,token,jobId){
 let s=(await read(id)).meta.analysis;if(s.token!==token||s.jobId!==jobId||s.deep?.status==='ready'||['failed','retry_wait','paused'].includes(s.status))return;
 const job=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];if(!job){await send({id,kind:'watch',token,jobId},60);return;}
 // A job we cancelled for capacity may only show FAILED on a later check; it
 // continues the capacity path. A worker that claimed a phase really failed.
 const cancelled=job.status==='FAILED'&&s.capacityCancelJobId===jobId&&!runningFor(s,token);
 if(job.status==='FAILED'&&!cancelled){await failAnalysis(id,token,'The GPU analysis failed. Your game record is safe.');return;}
 if(job.status==='SUCCEEDED')return;
 if(!cancelled){
  if(job.status==='RUNNING'||runningFor(s,token))return;
  if(job.status==='STARTING'){await send({id,kind:'watch',token,jobId},60);return;}
 }
 if(s.backend==='fallback-demand'){
  if(!cancelled){
   if(Date.now()-Date.parse(s.submitAt)<900000){await send({id,kind:'watch',token,jobId},60);return;}
   await change(id,a=>{if(a.token!==token)return false;a.capacityCancelJobId=jobId;});
   await jobs.send(new CancelJobCommand({jobId,reason:'GPU capacity still unavailable; schedule a later attempt'}));
   const stopped=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];
   if(stopped?.status!=='FAILED'){await send({id,kind:'watch',token,jobId},15);return;}
  }
  await failAnalysis(id,token,'GPU capacity is temporarily unavailable. Your game record is safe.');return;
 }
 // The replacement is submitted only after cancellation is confirmed. A worker
 // that starts during this race stays in place; no second paid job is launched.
 if(!cancelled){
  await change(id,a=>{if(a.token!==token)return false;a.capacityCancelJobId=jobId;});
  await jobs.send(new CancelJobCommand({jobId,reason:'Try T4 On-Demand capacity'}));
  const confirm=(await jobs.send(new DescribeJobsCommand({jobs:[jobId]}))).jobs?.[0];if(confirm?.status!=='FAILED'){await send({id,kind:'watch',token,jobId},15);return;}
 }
 const next=await change(id,a=>{if(a.token!==token||a.jobId!==jobId||runningFor(a,token))return false;a.token=randomUUID();a.backend='fallback-demand';a.capacityFallback=true;if(!phases.some(p=>a[p]?.status==='running'))a.status='queued';delete a.jobId;delete a.submitAt;delete a.watchSentAt;for(const p of phases)if(queuedPhase(a[p]))a[p]={...a[p],status:'queued',jobId:null};});if(next)await dispatch(id);
}
exports.handler=async event=>{
 if(await aiPaused()){for(const m of event.Records||[]){const b=JSON.parse(m.body);if(validRecordId(b.id))await pauseAnalysis(b.id);}return {batchItemFailures:[]};}
 if(event.detail?.status==='FAILED'){const job=event.detail,quick=/^weiqi-(\d{10,14})-q\d+-[a-f0-9]{8}$/.exec(job.jobName||'');if(quick){await quickFailed(quick[1],job.jobId);return;}const match=/^weiqi-(\d{10,14})-a\d+-[a-f0-9]{8}$/.exec(job.jobName||'');if(!match)return;const id=match[1],s=(await read(id)).meta.analysis;if(s.jobId!==job.jobId)return; // capacity cancellation is handled by the watcher, not a failed attempt
 if(s.capacityCancelJobId===job.jobId){await check(id,s.token,job.jobId);return;}
 await failAnalysis(id,s.token,'The GPU analysis failed. Your game record is safe.');return;}
 const batchItemFailures=[];for(const m of event.Records||[]){try{const b=JSON.parse(m.body);if(!validRecordId(b.id))throw Error('Invalid game ID');if(b.kind==='watch')await check(b.id,b.token,b.jobId);else if(b.kind==='quick-watch')await checkQuick(b.id,b.token,b.jobId,b.jobName);else await dispatch(b.id,b.kind==='retry'?b.attempt:null);}catch(e){console.error('GPU coordination failed',{name:e.name,message:e.message});if(Number(m.attributes?.ApproximateReceiveCount)>=3){const b=JSON.parse(m.body);if(b.kind==='quick-watch')continue;const s=(await read(b.id)).meta.analysis;if(s.token&&!runningFor(s,s.token)){await failAnalysis(b.id,s.token,'The analysis service is temporarily unavailable. Your game record is safe.');continue;}}batchItemFailures.push({itemIdentifier:m.messageId});}}return {batchItemFailures};
};
