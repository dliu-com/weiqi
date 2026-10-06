import {estimatedAnalysisSeconds} from '../src/analysis-status.js';
// Temporary debugging bridge: S3/SQS in AWS, the installed KataGo engine locally.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validRecordId} from '../backend/library-service.js';
import {runLocalJob} from './analysis-worker.mjs';
const execute=promisify(execFile);
export async function processCloudJob(store,id,options) {
  if(!validRecordId(id))throw Error('Invalid queued record ID.');
  const prefix='games/'+id+'/',key=prefix+'metadata.json',initial=await store.get(key),metadata=JSON.parse(initial.body);
  if(metadata.analysis.status==='ready')return 'ready';
  if(metadata.analysis.status==='running' && Date.now()-Date.parse(metadata.analysis.startedAt)<30*60*1000)return 'busy';
  const claimId=randomUUID();metadata.analysis={status:'running',startedAt:new Date().toISOString(),claimId,visits:options.visits,estimatedSeconds:estimatedAnalysisSeconds((metadata.moves || 0)+1,options.visits)};
  let claim;try{claim=await store.put(key,JSON.stringify(metadata),initial.etag);}catch(e){if(e.conflict)return 'busy';throw e;}
  const directory=await mkdtemp(path.join(os.tmpdir(),'weiqi-cloud-analysis-')),folder=path.join(directory,'games',id);
  try {
    await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'metadata.json'),JSON.stringify(metadata));
    await writeFile(path.join(folder,'original.sgf'),(await store.get(prefix+'original.sgf')).body);
    try {await runLocalJob(directory,id,options);}catch(e){console.error('Analysis failed:',e.message);}
    const finished=JSON.parse(await readFile(path.join(folder,'metadata.json'),'utf8'));
    if(finished.analysis.status==='ready')await store.put(prefix+'analysis.json',await readFile(path.join(folder,'analysis.json'),'utf8'));
    // Publish readiness only while this worker still owns its claim.
    await store.put(key,JSON.stringify(finished),claim.etag);
    return finished.analysis.status;
  } finally {await rm(directory,{recursive:true,force:true});}
}
async function main(){
 const bucket=process.env.LIBRARY_BUCKET,queue=process.env.ANALYSIS_QUEUE,model=process.env.KATAGO_MODEL;
 if(!bucket||!queue||!model)throw Error('Set LIBRARY_BUCKET, ANALYSIS_QUEUE and KATAGO_MODEL.');
 const directory=await mkdtemp(path.join(os.tmpdir(),'weiqi-aws-'));
 const aws=async args=>JSON.parse((await execute('aws',[...args,'--output','json'],{maxBuffer:2*1024*1024})).stdout || '{}');
 const store={
   async get(key){const file=path.join(directory,randomUUID()),result=await aws(['s3api','get-object','--bucket',bucket,'--key',key,file]);const body=await readFile(file,'utf8');await rm(file);return {body,etag:result.ETag};},
   async put(key,body,etag){const file=path.join(directory,randomUUID());await writeFile(file,body);try{return {etag:(await aws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',file,'--content-type','application/json',...(etag?['--if-match',etag]:[])])).ETag};}catch(e){if(e.stderr?.includes('PreconditionFailed'))e.conflict=true;throw e;}finally{await rm(file);}}
 };
 const options={model,engine:process.env.KATAGO_BIN || 'katago',visits:Number(process.env.KATAGO_VISITS || 10),timeoutMs:Number(process.env.KATAGO_TIMEOUT_MS || 120000)};
 try {do {
   const messages=await aws(['sqs','receive-message','--queue-url',queue,'--max-number-of-messages','1','--wait-time-seconds','20','--visibility-timeout','1800']);
   for(const message of messages.Messages || []) {
     const {id}=JSON.parse(message.Body);const status=await processCloudJob(store,id,options);
     if(status==='busy')await aws(['sqs','change-message-visibility','--queue-url',queue,'--receipt-handle',message.ReceiptHandle,'--visibility-timeout','60']);
     else await aws(['sqs','delete-message','--queue-url',queue,'--receipt-handle',message.ReceiptHandle]);
     console.log(id+': '+status);
   }
 }while(process.argv.includes('--watch'));}finally{await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main().catch(e=>{console.error(e.message);process.exitCode=1;});
