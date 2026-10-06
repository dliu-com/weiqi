const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const s3=new S3Client({});
exports.handler=async event=>{
 const job=event.detail,match=job.jobName?.match(/^weiqi-([0-9]{10,14})(?:-(quick|deep))?$/);if(job.status!=='FAILED'||!match)return;
 const [,id,phase]=match,key=gamePrefix(id)+'/metadata.json';
 for(let n=0;n<6;n++){
  const obj=await s3.send(new GetObjectCommand({Bucket:process.env.LIBRARY_BUCKET,Key:key})),meta=JSON.parse(await obj.Body.transformToString()),state=meta.analysis,target=phase?state[phase]:state;
  if(!target||target.status==='ready'||target.jobId&&target.jobId!==job.jobId)return;
  if(phase){state[phase]={...target,status:'failed',message:'Analysis job failed. Your record is preserved.',jobId:job.jobId};const active=['quick','deep'].some(p=>['queued','running'].includes(state[p]?.status));state.status=active?'running':state.available?'ready':'failed';}
  else meta.analysis={status:'failed',message:'Analysis job failed. Your record is preserved.',jobId:job.jobId};
  try{await s3.send(new PutObjectCommand({Bucket:process.env.LIBRARY_BUCKET,Key:key,Body:JSON.stringify(meta),ContentType:'application/json',IfMatch:obj.ETag}));return;}catch(e){if(![409,412].includes(e.$metadata?.httpStatusCode)||n===5)throw e;}
 }
};
