const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {BatchClient,DescribeJobsCommand,ListJobsCommand,CancelJobCommand,SubmitJobCommand}=require('@aws-sdk/client-batch');
const storage=new S3Client({}),batch=new BatchClient({}),bucket=process.env.LIBRARY_BUCKET;
const get=async key=>{const obj=await storage.send(new GetObjectCommand({Bucket:bucket,Key:key}));return {value:JSON.parse(await obj.Body.transformToString()),etag:obj.ETag};};
const put=(key,value,etag)=>storage.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(value),ContentType:'application/json',...(etag?{IfMatch:etag}:{})}));
const describe=async id=>(await batch.send(new DescribeJobsCommand({jobs:[id]}))).jobs[0];
async function replaceId(key,phase,expected,id,patch={}){
 for(let n=0;n<6;n++){
  const {value:meta,etag}=await get(key),target=meta.analysis[phase];
  if(target.jobId!==expected)return false;
  meta.analysis[phase]={...target,...patch,jobId:id};
  if(target.status==='ready'||target.status==='running'&&patch.status==='queued')meta.analysis[phase].status=target.status;
  const state=meta.analysis,quick=state.quick?.status,deep=state.deep?.status;
  if(deep==='ready')Object.assign(state,{status:'ready',available:'deep'});
  else if(quick==='ready')Object.assign(state,{status:['queued','running'].includes(deep)?'running':'ready',available:'quick'});
  else state.status=[quick,deep].includes('running')?'running':quick===deep&&quick==='failed'?'failed':'queued';
  try{await put(key,meta,etag);return true;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}
 }
}
exports.handler=async event=>{
 const batchItemFailures=[];
 for(const message of event.Records){try{
  const {id,phase,jobId}=JSON.parse(message.body);
  if(!/^[0-9]{10,14}$/.test(id)||!['quick','deep'].includes(phase))throw Error('Invalid fallback request');
  const key='games/'+id+'/metadata.json',marker='fallback:'+jobId;
  const {value:meta}=await get(key),target=meta.analysis[phase];
  if(!target||['ready','failed'].includes(target.status)||![jobId,marker].includes(target.jobId))continue;
  let job=await describe(jobId);
  if(!job)continue;
  if(['STARTING','RUNNING','SUCCEEDED'].includes(job.status)){
   if(target.jobId===marker)await replaceId(key,phase,marker,jobId,{fallback:null});
   continue;
  }
  if(target.jobId===jobId){
   if(!['SUBMITTED','PENDING','RUNNABLE'].includes(job.status))continue;
   if(!await replaceId(key,phase,jobId,marker,{fallback:{originalJobId:jobId,reason:'GPU capacity wait',claimedAt:new Date().toISOString()}}))continue;
  }
  if(job.status!=='FAILED'){
   await batch.send(new CancelJobCommand({jobId,reason:'Use CPU fallback after waiting for GPU capacity'}));
   job=await describe(jobId);
   for(let n=0;n<10&&['SUBMITTED','PENDING','RUNNABLE'].includes(job.status);n++){
    await new Promise(resolve=>setTimeout(resolve,1000));job=await describe(jobId);
   }
   if(['STARTING','RUNNING','SUCCEEDED'].includes(job.status)){
    await replaceId(key,phase,marker,jobId,{fallback:null});continue;
   }
   // Retry after visibility timeout; do not launch paid CPU work until the
   // GPU job is confirmed stopped. Its failure event ignores our marker ID.
   if(job.status!=='FAILED'){batchItemFailures.push({itemIdentifier:message.messageId});continue;}
  }
  const {value:latest}=await get(key);
  if(latest.analysis[phase].jobId!==marker||latest.analysis[phase].status==='ready')continue;
  const queue=phase==='quick'?process.env.CPU_QUICK_QUEUE:process.env.CPU_DEEP_QUEUE;
  if(latest.analysis[phase].fallback?.submissionAttempted){
   // A lost submit response must never create a second paid analysis.
   const matches=await batch.send(new ListJobsCommand({jobQueue:queue,filters:[{name:'JOB_NAME',values:['weiqi-'+id+'-'+phase]}]}));
   const existing=matches.jobSummaryList.find(j=>j.createdAt>=Date.parse(latest.analysis[phase].fallback.submissionAttempted));
   if(existing)await replaceId(key,phase,marker,existing.jobId,{status:existing.status==='FAILED'?'failed':'queued'});
   else if(Number(message.attributes?.ApproximateReceiveCount)>=3)await replaceId(key,phase,marker,marker,{status:'failed',message:'Unable to confirm CPU fallback submission. Please retry with a new upload.'});
   else batchItemFailures.push({itemIdentifier:message.messageId});
   continue;
  }
  const requestKey='jobs/'+id+'/'+phase+'-request.json',request=(await get(requestKey)).value;
  const visits=phase==='quick'?4:96,seconds=Math.ceil(15+request.nodeIds.length*(phase==='quick'?.35:5.8));
  request.query.maxVisits=visits;request.estimatedSeconds=seconds;request.compute={backend:'fargate-cpu',vCpu:32,memoryGB:60};
  await put(requestKey,request);
  const model=latest.analysis.model;
  if(!await replaceId(key,phase,marker,marker,{fallback:{...latest.analysis[phase].fallback,submissionAttempted:new Date().toISOString()}}))continue;
  const submitted=await batch.send(new SubmitJobCommand({jobName:'weiqi-'+id+'-'+phase,jobQueue:queue,jobDefinition:process.env.CPU_JOB_DEFINITION,containerOverrides:{resourceRequirements:[{type:'VCPU',value:'32'},{type:'MEMORY',value:'61440'}],environment:[{name:'BENCHMARK_REQUEST_KEY',value:requestKey},{name:'ANALYSIS_THREADS',value:'32'},{name:'NN_THREADS',value:'32'},{name:'NN_MAX_BATCH_SIZE',value:'1'},{name:'ANALYSIS_TIMEOUT_SECONDS',value:'14300'},{name:'KATAGO_MODEL_KEY',value:model.key},{name:'KATAGO_MODEL_URL',value:model.url}]}}));
  await replaceId(key,phase,marker,submitted.jobId,{status:'queued',visits,estimatedSeconds:seconds,fallback:{originalJobId:jobId,reason:'GPU capacity wait',backend:'fargate-cpu'}});
 }catch(e){console.error('GPU fallback failed',{name:e.name,message:e.message});batchItemFailures.push({itemIdentifier:message.messageId});}}
 return {batchItemFailures};
};
