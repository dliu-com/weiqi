const {S3Client,GetObjectCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
const {spawn,execFile}=require('node:child_process');
const {readFile,writeFile,rename}=require('node:fs/promises');
const path=require('node:path');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const s3client=new S3Client({}),bucket=process.env.LIBRARY_BUCKET;
const readObject=async key=>{const result=await s3client.send(new GetObjectCommand({Bucket:bucket,Key:key}));return {body:await result.Body.transformToString(),etag:result.ETag};};
const writeObject=async(key,body,etag)=>s3client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:JSON.stringify(body),ContentType:'application/json',...(etag?{IfMatch:etag}:{})}));
exports.handler=async(event,context)=>{
 const batchItemFailures=[];
 for(const message of event.Records){
  let metadata,claim,prefix;
  try {
   const {id}=JSON.parse(message.body);if(!validRecordId(id))throw Error('Invalid game ID');
   prefix='games/'+id+'/';const initial=await readObject(prefix+'metadata.json');metadata=JSON.parse(initial.body);
   if(['ready','failed','limited'].includes(metadata.analysis.status))continue;
   if(metadata.analysis.status==='running'&&Date.now()-Date.parse(metadata.analysis.startedAt)<30*60*1000){batchItemFailures.push({itemIdentifier:message.messageId});continue;}
   const visits=10;metadata.analysis={status:'running',startedAt:new Date().toISOString(),visits,estimatedSeconds:Math.max(30,Math.ceil((metadata.moves+1)*Number(process.env.SECONDS_PER_POSITION || 1)))};
   claim=await writeObject(prefix+'metadata.json',metadata,initial.etag);
   const source=(await readObject(prefix+'original.sgf')).body,model='/tmp/katago-model.bin.gz';
   try{await readFile(model);}catch{const object=await s3client.send(new GetObjectCommand({Bucket:bucket,Key:process.env.KATAGO_MODEL_KEY}));await writeFile(model+'.tmp',await object.Body.transformToByteArray());await rename(model+'.tmp',model);}
   const configPath='/tmp/katago-analysis.cfg';await writeFile(configPath,'logToStderr = true\nnumAnalysisThreads = 1\nnumSearchThreadsPerAnalysisThread = 2\nmaxVisits = 10\nreportAnalysisWinratesAs = BLACK\nnnMaxBatchSize = 1\nnnCacheSizePowerOfTwo = 16\n');
   const analysis=await analyse(source,{id,model,engine:'/opt/bin/katago',visits,configPath,timeoutMs:Math.min(840000,context.getRemainingTimeInMillis()-15000)});
   analysis.model=process.env.KATAGO_MODEL_KEY.split('/').at(-1);analysis.backend='cpu';
   await writeObject(prefix+'analysis.json',analysis);
   metadata.analysis={status:'ready',visits,completedAt:analysis.completedAt};await writeObject(prefix+'metadata.json',metadata,claim.ETag);
  } catch(e) {
   console.error('CPU analysis failed',{name:e.name,message:e.message});
   if(metadata&&claim){metadata.analysis={status:'failed',message:'Analysis could not complete. The original record is preserved.'};try{await writeObject(prefix+'metadata.json',metadata,claim.ETag);}catch{batchItemFailures.push({itemIdentifier:message.messageId});}}
   else batchItemFailures.push({itemIdentifier:message.messageId});
  }
 }
 return {batchItemFailures};
};
